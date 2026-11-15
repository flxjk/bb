import {
  GoogleGenAI,
  type Content,
  type FunctionDeclaration,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";
import type {
  AvailableModel,
  ClientTurnRequestId,
  DynamicTool,
  PermissionMode,
  PromptInput,
  ProviderHealthResult,
  ProviderRecoveryHint,
  ProviderRecoveryKind,
  ThreadDelta,
  ThreadEventTokenUsageBreakdown,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  BRIDGE_INBOUND_REQUEST_METHODS,
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_NOTIFICATION_METHODS,
  BRIDGE_REQUEST_METHODS,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  THREAD_DELTA_GRAMMAR_V3,
  THREAD_DELTA_NOTIFICATION_METHOD,
  ZERO_TOKEN_USAGE,
  addTokenUsage,
  createBridgeIo,
  createPendingToolCallTracker,
  experimental_BridgeRecoveryError as BridgeRecoveryError,
  experimental_defineProviderBridge as defineProviderBridge,
  experimental_REASONING_PRESENTATION as REASONING_PRESENTATION,
  initializeParamsSchema,
  modelListParamsSchema,
  providerInteractionOutcomeSchema,
  providerMaintenanceParamsSchema,
  reasoningEffortsForLevels,
  runBridgeRequest,
  threadArchiveParamsSchema,
  threadDiscardParamsSchema,
  threadForkParamsSchema,
  threadGoalClearParamsSchema,
  threadNameSetParamsSchema,
  threadResumeParamsSchema,
  threadStartParamsSchema,
  threadStopParamsSchema,
  threadUnarchiveParamsSchema,
  turnStartParamsSchema,
  turnSteerParamsSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { GeminiSessionStore, type GeminiSession } from "./sessions.js";
import {
  GEMINI_API_KEY_ENV,
  GEMINI_API_VERSION,
  GEMINI_DEFAULT_MODEL,
  GEMINI_MAX_TOOL_ROUNDS,
  GEMINI_MODEL_ENV,
  GEMINI_REASONING_LEVELS,
  geminiFunctionName,
  geminiFunctionPresentation,
  geminiModelDisplayName,
  geminiThinkingBudget,
  isChatCapableModel,
  orderGeminiModels,
  summarizeArguments,
  type GeminiModelSummary,
} from "./vocabulary.js";

type JsonRpcId = string | number;

type OutboundMessage = { jsonrpc: "2.0" } & Record<string, unknown>;

const io = createBridgeIo<OutboundMessage>();

let store: GeminiSessionStore | null = null;
let ai: GoogleGenAI | null = null;
let apiKeyFingerprint: string | null = null;

const instanceNonce = randomUUID().replaceAll("-", "").slice(0, 10);

interface LiveTurn {
  providerTurnId: string;
  clientRequestId: ClientTurnRequestId | null;
  controller: AbortController;
}

interface LiveSession {
  session: GeminiSession;
  model: string;
  dynamicTools: readonly DynamicTool[];
  permissionMode: PermissionMode;
  active: LiveTurn | null;
  history: Content[];
  usageTotal: ThreadEventTokenUsageBreakdown;
  contextWindow: number | null;
}

const liveSessions = new Map<string, LiveSession>();

const toolCalls = createPendingToolCallTracker({
  sendToolCall: (request) => io.send(request as unknown as OutboundMessage),
});

const pendingInteractions = new Map<JsonRpcId, (value: unknown) => void>();

let outboundRequestCounter = 0;

function notify(method: string, params: Record<string, unknown>): void {
  io.send({ jsonrpc: "2.0", method, params });
}

function emitDeltas(threadId: string, deltas: ThreadDelta[]): void {
  if (deltas.length === 0) return;
  notify(THREAD_DELTA_NOTIFICATION_METHOD, { threadId, deltas });
}

function emitRecovery(args: {
  threadId: string;
  kind: ProviderRecoveryKind;
  message: string;
  retryable: boolean;
}): void {
  notify(BRIDGE_NOTIFICATION_METHODS.providerRecovery, { ...args });
}

function requestInteraction(args: {
  providerThreadId: string;
  threadId: string;
  turnId: string;
  payload: unknown;
}): Promise<unknown> {
  outboundRequestCounter += 1;
  const id = `gemini-bridge-${outboundRequestCounter}`;
  io.send({
    jsonrpc: "2.0",
    id,
    method: BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest,
    params: {
      providerThreadId: args.providerThreadId,
      threadId: args.threadId,
      turnId: args.turnId,
      payload: args.payload,
    },
  });
  return new Promise((resolve) => {
    pendingInteractions.set(id, resolve);
  });
}

const HTTP_STATUS_PATTERN = /(\d{3})/u;

interface ClassifiedFailure {
  kind: ProviderRecoveryKind;
  message: string;
  retryable: boolean;
  status: number | null;
}

function readStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const record = error as Record<string, unknown>;
  for (const key of ["status", "statusCode", "code"]) {
    const value = record[key];
    if (typeof value === "number" && value >= 100 && value <= 599) {
      return value;
    }
    if (typeof value === "string" && HTTP_STATUS_PATTERN.test(value)) {
      const parsed = Number(value);
      if (parsed >= 100 && parsed <= 599) return parsed;
    }
  }
  const match = /HTTP (\d{3})/u.exec(
    error instanceof Error ? error.message : "",
  );
  return match === null ? null : Number(match[1]);
}

const AUTH_TEXT_PATTERN =
  /API key|api_key|API_KEY|permission denied|unauthenticated|invalid credential|UNAUTHENTICATED|PERMISSION_DENIED/u;
const RATE_LIMIT_TEXT_PATTERN =
  /RESOURCE_EXHAUSTED|rate limit|quota|too many requests|overloaded/iu;
const TRANSIENT_TEXT_PATTERN =
  /fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network|UNAVAILABLE|internal error/iu;

function classifyFailure(error: unknown): ClassifiedFailure {
  const message =
    error instanceof Error && error.message.length > 0
      ? error.message
      : String(error);
  const status = readStatus(error);
  if (
    status === 401 ||
    status === 403 ||
    (status === 400 && AUTH_TEXT_PATTERN.test(message)) ||
    (status === null && AUTH_TEXT_PATTERN.test(message))
  ) {
    return { kind: "authRequired", message, retryable: false, status };
  }
  if (status === 429 || RATE_LIMIT_TEXT_PATTERN.test(message)) {
    return { kind: "rateLimited", message, retryable: true, status };
  }
  if (status !== null && status >= 500) {
    return { kind: "rateLimited", message, retryable: true, status };
  }
  if (TRANSIENT_TEXT_PATTERN.test(message)) {
    return { kind: "restartRecommended", message, retryable: true, status };
  }
  if (status === 404 || (status !== null && status >= 400 && status < 500)) {
    return {
      kind: "restartRecommended",
      message,
      retryable: false,
      status,
    };
  }
  return { kind: "restartRecommended", message, retryable: false, status };
}

function recoveryHintFor(failure: ClassifiedFailure): ProviderRecoveryHint {
  return {
    kind: failure.kind,
    message: failure.message,
    retryable: failure.retryable,
  };
}

function readApiKey(envVars: Record<string, string> | undefined): string {
  const contributed = envVars?.[GEMINI_API_KEY_ENV]?.trim() ?? "";
  if (contributed.length > 0) return contributed;
  return (process.env[GEMINI_API_KEY_ENV] ?? "").trim();
}

function requireApiKey(envVars: Record<string, string> | undefined): string {
  const apiKey = readApiKey(envVars);
  if (apiKey.length > 0) return apiKey;
  throw new BridgeRecoveryError({
    code: BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
    message:
      "No Gemini API key: set it in this plugin's settings (an AI Studio key), then retry.",
    recovery: {
      kind: "authRequired",
      message: "Gemini API key is missing.",
      retryable: false,
    },
  });
}

function clientFor(apiKey: string): GoogleGenAI {
  const fingerprint = `${apiKey.length}:${apiKey.slice(-6)}`;
  if (ai === null || apiKeyFingerprint !== fingerprint) {
    ai = new GoogleGenAI({ apiKey, apiVersion: GEMINI_API_VERSION });
    apiKeyFingerprint = fingerprint;
  }
  return ai;
}

function configuredModel(envVars: Record<string, string> | undefined): string {
  const configured =
    envVars?.[GEMINI_MODEL_ENV] ?? process.env[GEMINI_MODEL_ENV];
  return configured !== undefined && configured.trim().length > 0
    ? configured.trim()
    : GEMINI_DEFAULT_MODEL;
}

async function listModels(apiKey: string): Promise<GeminiModelSummary[]> {
  const client = clientFor(apiKey);
  const models: GeminiModelSummary[] = [];
  const pager = await client.models.list({ config: { pageSize: 200 } });
  for await (const model of pager) {
    const id = String(model.name ?? "").replace(/^models\//u, "");
    if (id.length === 0) continue;
    const methods = model.supportedActions ?? [];
    if (!isChatCapableModel({ id, methods })) continue;
    models.push({
      id,
      displayName: model.displayName ?? geminiModelDisplayName(id),
      description: model.description ?? "",
      inputTokenLimit: model.inputTokenLimit ?? null,
      outputTokenLimit: model.outputTokenLimit ?? null,
    });
  }
  return orderGeminiModels(models);
}

function toAvailableModels(
  models: readonly GeminiModelSummary[],
  selected: string,
): { models: AvailableModel[]; selectedOnlyModels: AvailableModel[] } {
  const efforts = reasoningEffortsForLevels([...GEMINI_REASONING_LEVELS]);
  const available: AvailableModel[] = models.map((model) => ({
    id: model.id,
    model: model.id,
    displayName: model.displayName,
    description:
      model.description.length > 0
        ? model.description
        : `${model.displayName} through the Gemini API.`,
    reasoningDiscovery: "known" as const,
    supportedReasoningEfforts: efforts.map((effort) => ({ ...effort })),
    defaultReasoningEffort: "medium",
    isDefault: model.id === selected,
  }));
  const selectedOnlyModels: AvailableModel[] = available.some(
    (model) => model.isDefault,
  )
    ? []
    : selected.length === 0
      ? []
      : [
          {
            id: selected,
            model: selected,
            displayName: geminiModelDisplayName(selected),
            description: `${geminiModelDisplayName(selected)} through the Gemini API.`,
            reasoningDiscovery: "known" as const,
            supportedReasoningEfforts: efforts.map((effort) => ({ ...effort })),
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ];
  return { models: available, selectedOnlyModels };
}

function promptText(input: readonly PromptInput[]): string {
  const parts: string[] = [];
  for (const item of input) {
    if (item.type === "text") {
      parts.push(item.text);
      continue;
    }
    if (item.type === "image") {
      parts.push(item.url);
      continue;
    }
    parts.push(item.path);
  }
  return parts.join("\n").trim();
}

function promptParts(input: readonly PromptInput[]): Part[] {
  const parts: Part[] = [];
  for (const item of input) {
    if (item.type === "text") {
      if (item.text.length > 0) parts.push({ text: item.text });
      continue;
    }
    if (item.type === "image") {
      parts.push({ fileData: { fileUri: item.url, mimeType: "image/*" } });
      continue;
    }
    parts.push({ text: `${item.type}: ${item.path}` });
  }
  if (parts.length === 0) parts.push({ text: "" });
  return parts;
}

function dynamicToolDeclarations(
  tools: readonly DynamicTool[],
): FunctionDeclaration[] {
  return tools.map((tool) => ({
    name: geminiFunctionName(tool.name),
    description: tool.description,
    parametersJsonSchema: normalizeJsonSchema(tool.inputSchema),
  }));
}

function normalizeJsonSchema(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { type: "object", properties: {} };
  }
  const schema = { ...(input as Record<string, unknown>) };
  delete schema.$schema;
  delete schema.$id;
  if (schema.type === undefined && schema.properties !== undefined) {
    schema.type = "object";
  }
  return schema;
}

function usageBreakdown(
  metadata: GenerateContentResponse["usageMetadata"],
): ThreadEventTokenUsageBreakdown {
  if (metadata === undefined) return { ...ZERO_TOKEN_USAGE };
  const input = metadata.promptTokenCount ?? 0;
  const output = metadata.candidatesTokenCount ?? 0;
  const cached = metadata.cachedContentTokenCount ?? 0;
  const thoughts = metadata.thoughtsTokenCount ?? 0;
  return {
    ...ZERO_TOKEN_USAGE,
    inputTokens: input,
    outputTokens: output + thoughts,
    totalTokens: metadata.totalTokenCount ?? input + output + thoughts,
    ...(cached > 0 ? { cachedInputTokens: cached } : {}),
  };
}

function messageKey(turn: LiveTurn): { channel: string; parentRef: string } {
  return {
    channel: `assistant-${turn.providerTurnId}`,
    parentRef: turn.providerTurnId,
  };
}

function reasoningKey(turn: LiveTurn): { channel: string; parentRef: string } {
  return {
    channel: `reasoning-${turn.providerTurnId}`,
    parentRef: turn.providerTurnId,
  };
}

interface StreamAccumulator {
  text: string;
  reasoning: string;
  calls: { id: string; name: string; args: Record<string, unknown> }[];
  usage: GenerateContentResponse["usageMetadata"];
}

function consumeChunk(args: {
  chunk: GenerateContentResponse;
  threadId: string;
  turn: LiveTurn;
  accumulator: StreamAccumulator;
}): void {
  const { chunk, threadId, turn, accumulator } = args;
  if (chunk.usageMetadata !== undefined)
    accumulator.usage = chunk.usageMetadata;
  const deltas: ThreadDelta[] = [];
  for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
    if (typeof part.text === "string" && part.text.length > 0) {
      if (part.thought === true) {
        if (accumulator.reasoning.length === 0) {
          deltas.push({
            kind: "item.open",
            key: reasoningKey(turn),
            item: { type: "reasoning", summary: [], content: [] },
            presentation: REASONING_PRESENTATION,
            providerTurnId: turn.providerTurnId,
          });
        }
        accumulator.reasoning += part.text;
        deltas.push({
          kind: "item.textDelta",
          key: reasoningKey(turn),
          channel: "reasoningText",
          text: part.text,
          providerTurnId: turn.providerTurnId,
        });
      } else {
        accumulator.text += part.text;
        deltas.push({
          kind: "item.textDelta",
          key: messageKey(turn),
          channel: "agentMessage",
          text: part.text,
          providerTurnId: turn.providerTurnId,
        });
      }
      continue;
    }
    const call = part.functionCall;
    if (call === undefined) continue;
    const name = call.name ?? "";
    if (name.length === 0) continue;
    accumulator.calls.push({
      id:
        call.id !== undefined && call.id.length > 0
          ? call.id
          : `${turn.providerTurnId}-call-${accumulator.calls.length}`,
      name,
      args: call.args ?? {},
    });
  }
  emitDeltas(threadId, deltas);
}

function modelContentsFrom(accumulator: StreamAccumulator): Content[] {
  const parts: Part[] = [];
  if (accumulator.text.length > 0) parts.push({ text: accumulator.text });
  for (const call of accumulator.calls) {
    parts.push({
      functionCall: { id: call.id, name: call.name, args: call.args },
    });
  }
  return parts.length === 0 ? [] : [{ role: "model", parts }];
}

function closeTextStreams(args: {
  threadId: string;
  turn: LiveTurn;
  accumulator: StreamAccumulator;
}): void {
  const deltas: ThreadDelta[] = [];
  if (args.accumulator.reasoning.length > 0) {
    deltas.push({
      kind: "item.textClose",
      key: reasoningKey(args.turn),
      channel: "reasoningText",
      text: args.accumulator.reasoning,
      providerTurnId: args.turn.providerTurnId,
    });
  }
  if (args.accumulator.text.length > 0) {
    deltas.push({
      kind: "item.textClose",
      key: messageKey(args.turn),
      channel: "agentMessage",
      text: args.accumulator.text,
      providerTurnId: args.turn.providerTurnId,
    });
  }
  emitDeltas(args.threadId, deltas);
}

function emitUsage(args: {
  live: LiveSession;
  turn: LiveTurn;
  accumulator: StreamAccumulator;
}): void {
  const last = usageBreakdown(args.accumulator.usage);
  args.live.usageTotal = addTokenUsage(args.live.usageTotal, last);
  emitDeltas(args.live.session.threadId, [
    {
      kind: "usage",
      total: args.live.usageTotal,
      last,
      modelContextWindow: args.live.contextWindow,
      providerTurnId: args.turn.providerTurnId,
    },
    {
      kind: "contextWindow",
      used: args.live.usageTotal.totalTokens,
      size: args.live.contextWindow,
      estimated: true,
      attach: "open",
      providerTurnId: args.turn.providerTurnId,
    },
  ]);
}

function settleTurn(args: {
  live: LiveSession;
  turn: LiveTurn;
  status: "completed" | "failed" | "interrupted";
  error?: string;
}): void {
  if (args.live.active === args.turn) args.live.active = null;
  emitDeltas(args.live.session.threadId, [
    {
      kind: "turn.boundary",
      status: args.status,
      providerTurnId: args.turn.providerTurnId,
      ...(args.error === undefined ? {} : { error: { message: args.error } }),
    },
  ]);
  if (args.status === "completed") args.live.session.turns += 1;
  store?.flush();
}

function toolByName(
  tools: readonly DynamicTool[],
  functionName: string,
): DynamicTool | undefined {
  return tools.find((tool) => geminiFunctionName(tool.name) === functionName);
}

async function executeFunctionCall(args: {
  live: LiveSession;
  turn: LiveTurn;
  call: { id: string; name: string; args: Record<string, unknown> };
}): Promise<Record<string, unknown>> {
  const { live, turn, call } = args;
  const threadId = live.session.threadId;
  const dynamicTool = toolByName(live.dynamicTools, call.name);
  if (dynamicTool === undefined) {
    return { error: `Tool "${call.name}" is not available in this thread.` };
  }
  const presentation =
    dynamicTool.presentation ??
    geminiFunctionPresentation(dynamicTool.name, call.args);

  const decision = await requestApprovalIfNeeded({
    live,
    turn,
    tool: dynamicTool,
    presentation,
    call,
  });
  if (decision.denied) {
    emitDeltas(threadId, [
      {
        kind: "item.open",
        key: { providerItemId: call.id, parentRef: turn.providerTurnId },
        item: {
          type: "tool",
          tool: dynamicTool.name,
          server: "bb",
          args: call.args,
        },
        presentation,
        providerTurnId: turn.providerTurnId,
      },
      {
        kind: "item.close",
        key: { providerItemId: call.id, parentRef: turn.providerTurnId },
        status: "failed",
        approvalStatus: "denied",
        item: {
          type: "tool",
          tool: dynamicTool.name,
          server: "bb",
          args: call.args,
          error: decision.message,
        },
        presentation,
        providerTurnId: turn.providerTurnId,
      },
    ]);
    return { error: decision.message };
  }

  emitDeltas(threadId, [
    {
      kind: "item.open",
      key: { providerItemId: call.id, parentRef: turn.providerTurnId },
      item: {
        type: "tool",
        tool: dynamicTool.name,
        server: "bb",
        args: call.args,
      },
      presentation,
      providerTurnId: turn.providerTurnId,
    },
  ]);

  const result = await toolCalls.forwardToolCall({
    arguments: call.args,
    providerThreadId: live.session.providerThreadId,
    scope: live,
    threadId,
    toolName: dynamicTool.name,
  });

  emitDeltas(threadId, [
    {
      kind: "item.close",
      key: { providerItemId: call.id, parentRef: turn.providerTurnId },
      status: result.isError === true ? "failed" : "completed",
      item: {
        type: "tool",
        tool: dynamicTool.name,
        server: "bb",
        args: call.args,
        ...(result.isError === true
          ? { error: result.content }
          : { result: result.content }),
      },
      presentation,
      providerTurnId: turn.providerTurnId,
    },
  ]);

  return result.isError === true
    ? { error: result.content }
    : { output: result.content };
}

async function requestApprovalIfNeeded(args: {
  live: LiveSession;
  turn: LiveTurn;
  tool: DynamicTool;
  presentation: DynamicTool["presentation"];
  call: { id: string; name: string; args: Record<string, unknown> };
}): Promise<{ denied: boolean; message: string }> {
  if (args.live.permissionMode !== "accept-edits") {
    return { denied: false, message: "" };
  }
  const raw = await requestInteraction({
    providerThreadId: args.live.session.providerThreadId,
    threadId: args.live.session.threadId,
    turnId: args.turn.providerTurnId,
    payload: {
      kind: "approval",
      subject: {
        kind: "tool_use",
        itemId: args.call.id,
        tool: args.tool.name,
        presentation:
          args.presentation ??
          geminiFunctionPresentation(args.tool.name, args.call.args),
      },
      reason: summarizeArguments(args.call.args) || null,
      availableDecisions: ["allow_once", "allow_for_session", "deny"],
    },
  });
  const parsed = providerInteractionOutcomeSchema.safeParse(raw);
  if (!parsed.success) {
    return { denied: true, message: "The permission request failed." };
  }
  const outcome = parsed.data;
  if ("decision" in outcome) {
    return outcome.decision === "deny"
      ? { denied: true, message: "The user denied this tool call." }
      : { denied: false, message: "" };
  }
  return { denied: true, message: "The tool call was not approved." };
}

interface TurnOptions {
  model?: string;
  reasoningLevel?: string;
  instructions?: string;
  envVars?: Record<string, string>;
}

async function runTurn(args: {
  live: LiveSession;
  providerTurnId: string;
  input: readonly PromptInput[];
  clientRequestId: ClientTurnRequestId | null;
  options: TurnOptions;
}): Promise<void> {
  const { live } = args;
  const threadId = live.session.threadId;
  const controller = new AbortController();
  const turn: LiveTurn = {
    providerTurnId: args.providerTurnId,
    clientRequestId: args.clientRequestId,
    controller,
  };
  live.active = turn;

  let model = live.model;
  try {
    const apiKey = requireApiKey(args.options.envVars);
    model =
      args.options.model ?? live.model ?? configuredModel(args.options.envVars);
    live.model = model;
    const client = clientFor(apiKey);

    const deltas: ThreadDelta[] = [];
    if (args.clientRequestId !== null) {
      deltas.push({
        kind: "input.accepted",
        clientRequestId: args.clientRequestId,
        providerTurnId: args.providerTurnId,
      });
    }
    deltas.push({ kind: "turn.open", providerTurnId: args.providerTurnId });
    emitDeltas(threadId, deltas);

    const userContent: Content = {
      role: "user",
      parts: promptParts(args.input),
    };
    live.history.push(userContent);
    store?.appendContent(live.session, [userContent]);

    const declarations = dynamicToolDeclarations(live.dynamicTools);
    const tools =
      declarations.length === 0
        ? undefined
        : [{ functionDeclarations: declarations }];
    const budget = geminiThinkingBudget(args.options.reasoningLevel);
    const instructions = args.options.instructions?.trim() ?? "";

    let round = 0;
    while (round < GEMINI_MAX_TOOL_ROUNDS) {
      round += 1;
      if (controller.signal.aborted) {
        settleTurn({ live, turn, status: "interrupted" });
        return;
      }
      const accumulator: StreamAccumulator = {
        text: "",
        reasoning: "",
        calls: [],
        usage: undefined,
      };
      const stream = await client.models.generateContentStream({
        model,
        contents: live.history,
        config: {
          abortSignal: controller.signal,
          ...(tools === undefined ? {} : { tools }),
          ...(instructions.length === 0
            ? {}
            : { systemInstruction: instructions }),
          ...(budget === null
            ? {}
            : {
                thinkingConfig: {
                  includeThoughts: true,
                  thinkingBudget: budget,
                },
              }),
        },
      });
      for await (const chunk of stream) {
        if (controller.signal.aborted) break;
        consumeChunk({ chunk, threadId, turn, accumulator });
      }
      live.contextWindow =
        accumulator.usage?.totalTokenCount ?? live.contextWindow;

      const modelContents = modelContentsFrom(accumulator);
      if (modelContents.length > 0) {
        live.history.push(...modelContents);
        store?.appendContent(live.session, modelContents);
      }
      closeTextStreams({ threadId, turn, accumulator });

      if (controller.signal.aborted) {
        settleTurn({ live, turn, status: "interrupted" });
        return;
      }
      if (accumulator.calls.length === 0) {
        emitUsage({ live, turn, accumulator });
        settleTurn({ live, turn, status: "completed" });
        return;
      }

      const responseParts: Part[] = [];
      for (const call of accumulator.calls) {
        const response = await executeFunctionCall({ live, turn, call });
        responseParts.push({
          functionResponse: { id: call.id, name: call.name, response },
        });
      }
      if (controller.signal.aborted) {
        settleTurn({ live, turn, status: "interrupted" });
        return;
      }
      const responseContent: Content = { role: "user", parts: responseParts };
      live.history.push(responseContent);
      store?.appendContent(live.session, [responseContent]);
    }

    settleTurn({
      live,
      turn,
      status: "failed",
      error: `Gemini kept calling tools past ${GEMINI_MAX_TOOL_ROUNDS} rounds.`,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      settleTurn({ live, turn, status: "interrupted" });
      return;
    }
    const failure = classifyFailure(error);
    if (failure.kind === "authRequired" || failure.kind === "rateLimited") {
      emitRecovery({
        threadId,
        kind: failure.kind,
        message: failure.message,
        retryable: failure.retryable,
      });
    }
    emitDeltas(threadId, [
      {
        kind: "provider.error",
        message: failure.message,
        settlesTurn: true,
        providerTurnId: turn.providerTurnId,
      },
    ]);
    settleTurn({ live, turn, status: "failed", error: failure.message });
  }
}

function openLiveSession(args: {
  session: GeminiSession;
  model: string;
  dynamicTools: readonly DynamicTool[];
  permissionMode: PermissionMode;
}): LiveSession {
  const live: LiveSession = {
    session: args.session,
    model: args.model,
    dynamicTools: args.dynamicTools,
    permissionMode: args.permissionMode,
    active: null,
    history: [...args.session.contents],
    usageTotal: { ...ZERO_TOKEN_USAGE },
    contextWindow: null,
  };
  liveSessions.set(args.session.threadId, live);
  return live;
}

function healthFor(
  envVars: Record<string, string> | undefined,
): ProviderHealthResult {
  const apiKey = readApiKey(envVars);
  if (apiKey.length > 0) {
    return {
      supported: true,
      health: {
        status: "ready",
        statusMessage: null,
        accountEmail: null,
        planLabel: null,
        installedVersion: null,
        minimumSupportedVersion: null,
        canInstall: false,
        canUpdate: false,
        loginCommand: null,
      },
    };
  }
  return {
    supported: true,
    health: {
      status: "not_installed",
      statusMessage:
        "Set the Gemini API key in this plugin's settings to run threads on Gemini.",
      accountEmail: null,
      planLabel: null,
      installedVersion: null,
      minimumSupportedVersion: null,
      canInstall: false,
      canUpdate: false,
      loginCommand: null,
    },
  };
}

type RequestHandler = (id: JsonRpcId, params: unknown) => void;

function invalidParams(id: JsonRpcId, method: string, issues: unknown): void {
  io.sendError(
    id,
    BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
    `Invalid params for ${method}`,
    { issues: issues as never },
  );
}

function requireLive(args: {
  id: JsonRpcId;
  threadId: string;
  providerThreadId: string;
}): LiveSession | null {
  const existing = liveSessions.get(args.threadId);
  if (
    existing !== undefined &&
    existing.session.providerThreadId === args.providerThreadId
  ) {
    return existing;
  }
  io.sendError(
    args.id,
    BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
    `No session for thread ${args.threadId}; send thread/start or thread/resume first`,
  );
  return null;
}

function startSession(args: {
  id: JsonRpcId;
  threadId: string;
  providerThreadId: string;
  cwd: string;
  model: string;
  dynamicTools: readonly DynamicTool[];
  permissionMode: PermissionMode;
}): LiveSession | null {
  if (store === null) {
    io.sendError(
      args.id,
      BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
      "The bridge has no plugin data directory; restart it.",
    );
    return null;
  }
  const session = store.create({
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
    cwd: args.cwd,
  });
  return openLiveSession({
    session,
    model: args.model,
    dynamicTools: args.dynamicTools,
    permissionMode: args.permissionMode,
  });
}

const handlers: Record<string, RequestHandler> = {
  [BRIDGE_REQUEST_METHODS.initialize]: (id, params) => {
    const parsed = initializeParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.initialize, parsed.error.issues);
      return;
    }
    io.sendResult(id, {
      protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
      capabilities: {
        grammarVersions: [THREAD_DELTA_GRAMMAR_V3, THREAD_DELTA_GRAMMAR_V3],
        sessionRestore: true,
        threadArchive: true,
        threadRename: true,
        threadGoalClear: false,
        fork: "none",
        approvalEnforcedBy: "runtime",
        steerMode: "queue",
        skills: { configure: false },
        commands: { list: false },
      },
    });
  },

  [BRIDGE_REQUEST_METHODS.modelList]: (id, params) => {
    const parsed = modelListParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.modelList, parsed.error.issues);
      return;
    }
    void (async () => {
      const apiKey = requireApiKey(parsed.data.envVars);
      const models = await listModels(apiKey);
      const selected =
        parsed.data.selectedModel ?? configuredModel(parsed.data.envVars);
      io.sendResult(id, toAvailableModels(models, selected));
    })().catch((error: unknown) => {
      if (error instanceof BridgeRecoveryError) {
        io.sendError(id, error.code, error.message, {
          recovery: error.recovery,
        });
        return;
      }
      const failure = classifyFailure(error);
      io.sendError(id, BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR, failure.message, {
        recovery: recoveryHintFor(failure),
      });
    });
  },

  [BRIDGE_REQUEST_METHODS.providerHealth]: (id, params) => {
    const parsed = providerMaintenanceParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(
        id,
        BRIDGE_REQUEST_METHODS.providerHealth,
        parsed.error.issues,
      );
      return;
    }
    io.sendResult(id, healthFor(undefined));
  },

  [BRIDGE_REQUEST_METHODS.threadStart]: (id, params) => {
    const parsed = threadStartParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(
        id,
        BRIDGE_REQUEST_METHODS.threadStart,
        parsed.error.issues,
      );
      return;
    }
    const providerThreadId = `gemini_${instanceNonce}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const live = startSession({
      id,
      threadId: parsed.data.threadId,
      providerThreadId,
      cwd: parsed.data.cwd,
      model:
        parsed.data.options.model ??
        configuredModel(parsed.data.options.envVars),
      dynamicTools: parsed.data.dynamicTools ?? [],
      permissionMode: parsed.data.options.permissionMode,
    });
    if (live === null) return;
    notify(BRIDGE_NOTIFICATION_METHODS.threadIdentity, {
      threadId: parsed.data.threadId,
      providerThreadId,
      sessionRestorable: true,
    });
    emitDeltas(parsed.data.threadId, [
      { kind: "session.reset" },
      { kind: "thread.started" },
    ]);
    io.sendResult(id, { providerThreadId, sessionRestorable: true });
    const input = parsed.data.input;
    if (input !== undefined && input.length > 0) {
      void runTurn({
        live,
        providerTurnId: `${providerThreadId}-t1`,
        input,
        clientRequestId: null,
        options: {
          model: live.model,
          reasoningLevel: parsed.data.options.reasoningLevel,
          instructions: parsed.data.options.instructions,
          envVars: parsed.data.options.envVars,
        },
      });
    }
  },

  [BRIDGE_REQUEST_METHODS.threadResume]: (id, params) => {
    const parsed = threadResumeParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(
        id,
        BRIDGE_REQUEST_METHODS.threadResume,
        parsed.error.issues,
      );
      return;
    }
    const session = store?.get(parsed.data.providerThreadId);
    if (session === undefined) {
      io.sendError(
        id,
        BRIDGE_JSON_RPC_ERRORS.SESSION_NOT_RESTORABLE,
        `Gemini session ${parsed.data.providerThreadId} is not restorable.`,
        {
          recovery: {
            kind: "sessionArchived",
            message: `Gemini session ${parsed.data.providerThreadId} is gone.`,
            retryable: false,
          },
        },
      );
      return;
    }
    if (session.archived) {
      io.sendError(
        id,
        BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
        `Gemini session ${parsed.data.providerThreadId} is archived.`,
        {
          recovery: {
            kind: "sessionArchived",
            message: `Gemini session ${parsed.data.providerThreadId} is archived.`,
            retryable: true,
          },
        },
      );
      return;
    }
    session.threadId = parsed.data.threadId;
    session.cwd = parsed.data.cwd;
    const live = openLiveSession({
      session,
      model:
        parsed.data.options.model ??
        configuredModel(parsed.data.options.envVars),
      dynamicTools: parsed.data.dynamicTools ?? [],
      permissionMode: parsed.data.options.permissionMode,
    });
    notify(BRIDGE_NOTIFICATION_METHODS.threadIdentity, {
      threadId: parsed.data.threadId,
      providerThreadId: session.providerThreadId,
      sessionRestorable: true,
    });
    emitDeltas(parsed.data.threadId, [{ kind: "session.reset" }]);
    io.sendResult(id, {
      providerThreadId: session.providerThreadId,
      sessionRestorable: true,
    });
    void live;
  },

  [BRIDGE_REQUEST_METHODS.threadFork]: (id, params) => {
    const parsed = threadForkParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.threadFork, parsed.error.issues);
      return;
    }
    io.sendError(
      id,
      BRIDGE_JSON_RPC_ERRORS.FORK_CHECKPOINT_UNSUPPORTED,
      "The Gemini API bridge cannot fork a session.",
    );
  },

  [BRIDGE_REQUEST_METHODS.turnStart]: (id, params) => {
    const parsed = turnStartParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.turnStart, parsed.error.issues);
      return;
    }
    const live = requireLive({
      id,
      threadId: parsed.data.threadId,
      providerThreadId: parsed.data.providerThreadId,
    });
    if (live === null) return;
    if (live.active !== null) {
      io.sendError(
        id,
        BRIDGE_JSON_RPC_ERRORS.NO_ACTIVE_TURN,
        `Thread ${parsed.data.threadId} already runs a turn.`,
      );
      return;
    }
    live.permissionMode = parsed.data.options.permissionMode;
    const providerTurnId = `${live.session.providerThreadId}-t${live.session.turns + 1}-${randomUUID().replaceAll("-", "").slice(0, 6)}`;
    io.sendResult(id, {});
    void runTurn({
      live,
      providerTurnId,
      input: parsed.data.input,
      clientRequestId: parsed.data.clientRequestId,
      options: {
        model: parsed.data.options.model ?? live.model,
        reasoningLevel: parsed.data.options.reasoningLevel,
        instructions: parsed.data.options.instructions,
        envVars: parsed.data.options.envVars,
      },
    });
  },

  [BRIDGE_REQUEST_METHODS.turnSteer]: (id, params) => {
    const parsed = turnSteerParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.turnSteer, parsed.error.issues);
      return;
    }
    const live = liveSessions.get(parsed.data.threadId);
    const turn = live?.active ?? null;
    if (
      live === undefined ||
      live === null ||
      turn === null ||
      turn.providerTurnId !== parsed.data.expectedTurnId
    ) {
      io.sendError(
        id,
        BRIDGE_JSON_RPC_ERRORS.NO_ACTIVE_TURN,
        `No active turn to steer (expected ${parsed.data.expectedTurnId})`,
        {
          recovery: {
            kind: "staleTurn",
            message: "The turn this steer targeted is gone.",
            retryable: false,
          },
        },
      );
      return;
    }
    const content: Content = {
      role: "user",
      parts: [{ text: promptText(parsed.data.input) }],
    };
    live.history.push(content);
    store?.appendContent(live.session, [content]);
    io.sendResult(id, {});
  },

  [BRIDGE_REQUEST_METHODS.threadStop]: (id, params) => {
    const parsed = threadStopParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.threadStop, parsed.error.issues);
      return;
    }
    const live = liveSessions.get(parsed.data.threadId);
    if (live === undefined) {
      io.sendResult(id, {});
      return;
    }
    const turn = live.active;
    if (parsed.data.intent === "interrupt" && turn !== null) {
      turn.controller.abort();
    }
    if (parsed.data.intent === "release") {
      live.active = null;
      liveSessions.delete(parsed.data.threadId);
    }
    store?.flush();
    io.sendResult(id, {});
  },

  [BRIDGE_REQUEST_METHODS.threadDiscard]: (id, params) => {
    const parsed = threadDiscardParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(
        id,
        BRIDGE_REQUEST_METHODS.threadDiscard,
        parsed.error.issues,
      );
      return;
    }
    const live = liveSessions.get(parsed.data.threadId);
    if (live !== undefined) {
      live.active?.controller.abort();
      liveSessions.delete(parsed.data.threadId);
    }
    store?.forget(parsed.data.providerThreadId);
    store?.flush();
    io.sendResult(id, {});
  },

  [BRIDGE_REQUEST_METHODS.threadArchive]: (id, params) => {
    const parsed = threadArchiveParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(
        id,
        BRIDGE_REQUEST_METHODS.threadArchive,
        parsed.error.issues,
      );
      return;
    }
    const session = store?.get(parsed.data.providerThreadId);
    if (session !== undefined && store !== null)
      store.setArchived(session, true);
    store?.flush();
    io.sendResult(id, {});
  },

  [BRIDGE_REQUEST_METHODS.threadUnarchive]: (id, params) => {
    const parsed = threadUnarchiveParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(
        id,
        BRIDGE_REQUEST_METHODS.threadUnarchive,
        parsed.error.issues,
      );
      return;
    }
    const session = store?.get(parsed.data.providerThreadId);
    if (session !== undefined && store !== null)
      store.setArchived(session, false);
    store?.flush();
    io.sendResult(id, {});
  },

  [BRIDGE_REQUEST_METHODS.threadNameSet]: (id, params) => {
    const parsed = threadNameSetParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(
        id,
        BRIDGE_REQUEST_METHODS.threadNameSet,
        parsed.error.issues,
      );
      return;
    }
    io.sendResult(id, {});
  },

  [BRIDGE_REQUEST_METHODS.threadGoalClear]: (id, params) => {
    const parsed = threadGoalClearParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(
        id,
        BRIDGE_REQUEST_METHODS.threadGoalClear,
        parsed.error.issues,
      );
      return;
    }
    io.sendResult(id, {});
  },
};

const responseEnvelopeSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.number(),
        message: z.string().optional(),
        data: z.unknown().optional(),
      })
      .optional(),
  })
  .passthrough();

function handleResponse(message: unknown): void {
  const decoded = responseEnvelopeSchema.safeParse(message);
  if (!decoded.success) return;
  const { id, error, result } = decoded.data;

  const resolveInteraction = pendingInteractions.get(id);
  if (resolveInteraction !== undefined) {
    pendingInteractions.delete(id);
    resolveInteraction(error === undefined ? result : undefined);
    return;
  }

  toolCalls.handleToolCallResponse({
    jsonrpc: "2.0",
    id,
    ...(error === undefined ? { result } : { error }),
  });
}

export function handleLine(line: string): void {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message)
  ) {
    return;
  }
  const { id, method, params } = message as {
    id?: unknown;
    method?: unknown;
    params?: unknown;
  };
  if (typeof method !== "string") {
    handleResponse(message);
    return;
  }
  if (typeof id !== "string" && typeof id !== "number") return;
  const handler = handlers[method];
  if (handler === undefined) {
    io.sendError(
      id,
      BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND,
      `Method not found: ${method}`,
    );
    return;
  }
  runBridgeRequest({
    request: { id, method, params },
    sendError: io.sendError,
    handleRequest: async (request) => handler(request.id, request.params),
  });
}

export const experimental_providerBridge = defineProviderBridge({
  handleLine,
  start(context) {
    store = new GeminiSessionStore(context.dataDir);
  },
  onClose() {
    for (const live of liveSessions.values()) {
      live.active?.controller.abort();
      toolCalls.resolvePendingToolCalls(live, "The Gemini bridge closed.");
    }
    liveSessions.clear();
    store?.flush();
  },
});

export const providerBridgeInternals = {
  classifyFailure,
  normalizeJsonSchema,
  usageBreakdown,
  promptText,
  promptParts,
  toAvailableModels,
  dynamicToolDeclarations,
  toolByName,
  geminiFunctionName,
};
