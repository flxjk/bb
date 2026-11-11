const MAX_ERROR_BODY_CHARS = 300;

export class ChatCompletionError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ChatCompletionError";
    this.status = status;
  }
}

interface ChatCompletionBase {
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly signal: AbortSignal;
}

export interface ChatCompletionRequest extends ChatCompletionBase {
  readonly model: string;
  readonly prompt: string;
  readonly timeoutMs: number;
}

function headers(apiKey: string | null): Headers {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (apiKey !== null && apiKey.length > 0) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  return headers;
}

function join(baseUrl: string, path: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, "");
  return `${trimmed}${path}`;
}

async function bodyExcerpt(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  const collapsed = text.replace(/\s+/gu, " ").trim();
  return collapsed.length > MAX_ERROR_BODY_CHARS
    ? `${collapsed.slice(0, MAX_ERROR_BODY_CHARS)}…`
    : collapsed;
}

async function failure(response: Response, what: string): Promise<never> {
  const body = await bodyExcerpt(response);
  throw new ChatCompletionError(
    body.length === 0
      ? `${what} failed with HTTP ${response.status}`
      : `${what} failed with HTTP ${response.status}: ${body}`,
    response.status,
  );
}

function textOfChoice(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const choices = (value as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (first === null || typeof first !== "object") return null;
  const message = (first as Record<string, unknown>).message;
  if (message === null || typeof message !== "object") return null;
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" && content.trim().length > 0
    ? content
    : null;
}

export async function completeChat(
  args: ChatCompletionRequest,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(join(args.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: headers(args.apiKey),
      signal: AbortSignal.any([
        args.signal,
        AbortSignal.timeout(args.timeoutMs),
      ]),
      body: JSON.stringify({
        model: args.model,
        messages: [{ role: "user", content: args.prompt }],
        stream: false,
        temperature: 0,
      }),
    });
  } catch (error) {
    throw new ChatCompletionError(
      `Could not reach ${args.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) await failure(response, "The completion request");
  const payload: unknown = await response.json().catch(() => null);
  const text = textOfChoice(payload);
  if (text === null) {
    throw new ChatCompletionError(
      "The provider answered without any message text.",
      response.status,
    );
  }
  return text;
}

function modelIdsOf(value: unknown): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const entry of data) {
    if (entry === null || typeof entry !== "object") continue;
    const id = (entry as Record<string, unknown>).id;
    if (typeof id === "string" && id.length > 0) ids.push(id);
  }
  return ids;
}

export async function listChatModels(
  args: ChatCompletionBase & { timeoutMs: number },
): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(join(args.baseUrl, "/models"), {
      headers: headers(args.apiKey),
      signal: AbortSignal.any([
        args.signal,
        AbortSignal.timeout(args.timeoutMs),
      ]),
    });
  } catch (error) {
    throw new ChatCompletionError(
      `Could not reach ${args.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) await failure(response, "The model list request");
  const payload: unknown = await response.json().catch(() => null);
  return modelIdsOf(payload).sort((left, right) => left.localeCompare(right));
}
