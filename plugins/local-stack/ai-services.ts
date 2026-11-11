import {
  type BbPluginApi,
  type PluginAiServiceStatus,
} from "@get-bb/plugin-sdk";
import {
  ChatCompletionError,
  completeChat,
  listChatModels,
} from "./chat-completions.js";
import { DEFAULT_OLLAMA_BASE_URL, ollamaHostContract } from "./ollama.js";

const COMPLETE_TIMEOUT_MS = 4_500;
const MODEL_LIST_TIMEOUT_MS = 5_000;

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

export const AI_SERVICE_IDS = [
  "ollama",
  "openrouter",
  "gemini",
  "deepseek",
] as const;

export type AiServiceId = (typeof AI_SERVICE_IDS)[number];

export function isAiServiceId(value: string): value is AiServiceId {
  return (AI_SERVICE_IDS as readonly string[]).includes(value);
}

export interface AiServiceValues {
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaExecutable: string;
  openrouterApiKey: string;
  openrouterModel: string;
  geminiApiKey: string;
  geminiModel: string;
  deepseekApiKey: string;
  deepseekModel: string;
}

function missingModel(label: string): PluginAiServiceStatus {
  return {
    ready: false,
    message: `Set the ${label} model in the plugin settings.`,
  };
}

function missingKey(label: string): PluginAiServiceStatus {
  return {
    ready: false,
    message: `Add the ${label} API key in the plugin settings.`,
  };
}

function requiredModel(value: string, label: string): string {
  const model = value.trim();
  if (model.length === 0) {
    throw new Error(`No ${label} model is configured.`);
  }
  return model;
}

function cloudReadiness(
  apiKey: string,
  model: string,
  label: string,
): PluginAiServiceStatus {
  if (model.trim().length === 0) return missingModel(label);
  if (apiKey.trim().length === 0) return missingKey(label);
  return { ready: true };
}

interface CloudService {
  id: AiServiceId;
  displayName: string;
  label: string;
  baseUrl: string;
  apiKey: (values: AiServiceValues) => string;
  model: (values: AiServiceValues) => string;
}

const CLOUD_SERVICES: readonly CloudService[] = [
  {
    id: "openrouter",
    displayName: "OpenRouter",
    label: "OpenRouter",
    baseUrl: OPENROUTER_BASE_URL,
    apiKey: (values) => values.openrouterApiKey,
    model: (values) => values.openrouterModel,
  },
  {
    id: "gemini",
    displayName: "Google Gemini",
    label: "Gemini",
    baseUrl: GEMINI_BASE_URL,
    apiKey: (values) => values.geminiApiKey,
    model: (values) => values.geminiModel,
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    label: "DeepSeek",
    baseUrl: DEEPSEEK_BASE_URL,
    apiKey: (values) => values.deepseekApiKey,
    model: (values) => values.deepseekModel,
  },
];

function cloudBaseUrl(id: AiServiceId): string {
  const service = CLOUD_SERVICES.find((candidate) => candidate.id === id);
  if (service === undefined) throw new Error(`Unknown AI service ${id}.`);
  return service.baseUrl;
}

function cloudCredentials(
  id: AiServiceId,
  values: AiServiceValues,
): { apiKey: string; model: string } {
  const service = CLOUD_SERVICES.find((candidate) => candidate.id === id);
  if (service === undefined) throw new Error(`Unknown AI service ${id}.`);
  return { apiKey: service.apiKey(values), model: service.model(values) };
}

function describeFailure(error: unknown): Error {
  if (error instanceof ChatCompletionError) return error;
  return error instanceof Error ? error : new Error(String(error));
}

export async function installAiServices(
  bb: BbPluginApi,
): Promise<AiServiceCommands> {
  const settings = bb.settings.define({
    ollamaBaseUrl: {
      type: "string",
      label: "Ollama address",
      description:
        "Where the local Ollama server listens. bb reaches it through the machine daemon, so it must be an address that machine can open.",
      default: DEFAULT_OLLAMA_BASE_URL,
    },
    ollamaModel: {
      type: "string",
      label: "Ollama model",
      description:
        "The model tag to answer with, for example the name `ollama list` prints. Leave empty until you have pulled a model.",
      default: "",
    },
    ollamaExecutable: {
      type: "string",
      label: "Ollama executable",
      description:
        "Absolute path to the ollama binary, used only by `bb local-stack ollama start`. Nothing starts Ollama on its own.",
      default: "",
    },
    openrouterApiKey: {
      type: "string",
      label: "OpenRouter API key",
      description: "Sent as a bearer token to openrouter.ai.",
      secret: true,
      default: "",
    },
    openrouterModel: {
      type: "string",
      label: "OpenRouter model",
      description:
        "The model id to answer with, for example the ids `bb local-stack models openrouter` prints.",
      default: "",
    },
    geminiApiKey: {
      type: "string",
      label: "Gemini API key",
      description:
        "Sent as a bearer token to Google's OpenAI-compatible endpoint.",
      secret: true,
      default: "",
    },
    geminiModel: {
      type: "string",
      label: "Gemini model",
      description:
        "The model id to answer with, for example the ids `bb local-stack models gemini` prints.",
      default: "",
    },
    deepseekApiKey: {
      type: "string",
      label: "DeepSeek API key",
      description: "Sent as a bearer token to api.deepseek.com.",
      secret: true,
      default: "",
    },
    deepseekModel: {
      type: "string",
      label: "DeepSeek model",
      description:
        "The model id to answer with, for example the ids `bb local-stack models deepseek` prints.",
      default: "",
    },
  });

  let values = await settings.get();
  settings.onChange((next) => {
    values = next;
  });

  function current(): AiServiceValues {
    return values;
  }

  const host = bb.hosts.experimental_client({ contract: ollamaHostContract });

  async function connectedHostId(): Promise<string | null> {
    const hosts = await bb.sdk.hosts.list();
    return (
      hosts.find((candidate) => candidate.status === "connected")?.id ?? null
    );
  }

  async function ollamaStatus(): Promise<PluginAiServiceStatus> {
    const model = current().ollamaModel.trim();
    if (model.length === 0) return missingModel("Ollama");
    const hostId = await connectedHostId();
    if (hostId === null) {
      return {
        ready: false,
        message: "No connected machine can reach Ollama.",
      };
    }
    const answer = await host.call(
      "status",
      { baseUrl: current().ollamaBaseUrl },
      { hostId },
    );
    if (!answer.reachable) {
      return {
        ready: false,
        message: `Ollama is not answering at ${current().ollamaBaseUrl}.`,
      };
    }
    if (answer.models.length > 0 && !answer.models.includes(model)) {
      return {
        ready: false,
        message: `Ollama has no model "${model}". Pull it, or pick one of: ${answer.models.join(", ")}.`,
      };
    }
    return { ready: true };
  }

  bb.experimental_aiServices.register({
    id: "ollama",
    displayName: "Ollama (local)",
    complete: (prompt, { signal }) => completeWith("ollama", prompt, signal),
    status: ollamaStatus,
  });

  async function completeWith(
    serviceId: AiServiceId,
    prompt: string,
    signal: AbortSignal,
    timeoutMs: number = COMPLETE_TIMEOUT_MS,
  ): Promise<string> {
    try {
      if (serviceId === "ollama") {
        const model = requiredModel(current().ollamaModel, "Ollama");
        const hostId = await connectedHostId();
        if (hostId === null) {
          throw new Error("No connected machine can reach Ollama.");
        }
        const answer = await host.call(
          "chat",
          {
            baseUrl: current().ollamaBaseUrl,
            model,
            prompt,
            timeoutMs,
          },
          { hostId, signal },
        );
        return answer.text;
      }
      const service = CLOUD_SERVICES.find(
        (candidate) => candidate.id === serviceId,
      );
      if (service === undefined) {
        throw new Error(`Unknown AI service ${serviceId}.`);
      }
      const { apiKey, model } = cloudCredentials(serviceId, current());
      return await completeChat({
        baseUrl: service.baseUrl,
        apiKey: apiKey.trim().length === 0 ? null : apiKey,
        model: requiredModel(model, service.label),
        prompt,
        timeoutMs,
        signal,
      });
    } catch (error) {
      throw describeFailure(error);
    }
  }

  for (const service of CLOUD_SERVICES) {
    bb.experimental_aiServices.register({
      id: service.id,
      displayName: service.displayName,
      complete: (prompt, { signal }) =>
        completeWith(service.id, prompt, signal),
      status: () => {
        const { apiKey, model } = cloudCredentials(service.id, current());
        return Promise.resolve(cloudReadiness(apiKey, model, service.label));
      },
    });
  }

  return {
    complete: completeWith,

    async listModels(serviceId: AiServiceId): Promise<string[]> {
      if (serviceId === "ollama") {
        const hostId = await connectedHostId();
        if (hostId === null) {
          throw new Error("No connected machine can reach Ollama.");
        }
        const answer = await host.call(
          "status",
          { baseUrl: current().ollamaBaseUrl },
          { hostId },
        );
        if (!answer.reachable) {
          throw new Error(
            `Ollama is not answering at ${current().ollamaBaseUrl}.`,
          );
        }
        return answer.models;
      }
      const { apiKey } = cloudCredentials(serviceId, current());
      const listSignal = AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS);
      try {
        return await listChatModels({
          baseUrl: cloudBaseUrl(serviceId),
          apiKey: apiKey.trim().length === 0 ? null : apiKey,
          timeoutMs: MODEL_LIST_TIMEOUT_MS,
          signal: listSignal,
        });
      } catch (error) {
        throw describeFailure(error);
      }
    },

    async startOllama(): Promise<{ started: boolean; detail: string }> {
      const executable = current().ollamaExecutable.trim();
      if (executable.length === 0) {
        throw new Error(
          "Set the Ollama executable path in the plugin settings first.",
        );
      }
      const hostId = await connectedHostId();
      if (hostId === null) {
        throw new Error("No connected machine can start Ollama.");
      }
      return host.call(
        "start",
        { executable, baseUrl: current().ollamaBaseUrl },
        { hostId },
      );
    },
  };
}

export interface AiServiceCommands {
  complete(
    serviceId: AiServiceId,
    prompt: string,
    signal: AbortSignal,
    timeoutMs?: number,
  ): Promise<string>;
  listModels(serviceId: AiServiceId): Promise<string[]>;
  startOllama(): Promise<{ started: boolean; detail: string }>;
}
