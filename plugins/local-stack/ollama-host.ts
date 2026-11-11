import { spawn } from "node:child_process";
import path from "node:path";
import { completeChat } from "./chat-completions.js";

const STATUS_TIMEOUT_MS = 1_500;

const ENV_PASSTHROUGH = ["PATH", "HOME", "USER", "LANG"] as const;

export function ollamaApiBase(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, "");
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

function sanitizedEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ENV_PASSTHROUGH) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...extra };
}

function bindAddress(baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(ollamaApiBase(baseUrl));
  } catch {
    return null;
  }
  if (url.protocol !== "http:") return null;
  return `${url.hostname}:${url.port.length > 0 ? url.port : "80"}`;
}

async function tags(base: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${base}/api/tags`, {
    signal:
      signal === undefined
        ? AbortSignal.timeout(STATUS_TIMEOUT_MS)
        : AbortSignal.any([signal, AbortSignal.timeout(STATUS_TIMEOUT_MS)]),
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function modelNames(payload: unknown): string[] {
  const models =
    payload !== null && typeof payload === "object"
      ? (payload as { models?: unknown }).models
      : null;
  if (!Array.isArray(models)) return [];
  const names: string[] = [];
  for (const entry of models) {
    if (entry === null || typeof entry !== "object") continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name === "string" && name.length > 0) names.push(name);
  }
  return names.sort((left, right) => left.localeCompare(right));
}

export interface OllamaStatus {
  reachable: boolean;
  models: string[];
}

export async function probeOllama(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<OllamaStatus> {
  const base = ollamaApiBase(baseUrl);
  try {
    const payload = await tags(base, signal);
    if (payload === null) return { reachable: false, models: [] };
    return { reachable: true, models: modelNames(payload) };
  } catch {
    return { reachable: false, models: [] };
  }
}

export async function chatWithOllama(args: {
  baseUrl: string;
  model: string;
  prompt: string;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<string> {
  return completeChat({
    baseUrl: `${ollamaApiBase(args.baseUrl)}/v1`,
    apiKey: null,
    model: args.model,
    prompt: args.prompt,
    timeoutMs: args.timeoutMs,
    signal: args.signal,
  });
}

export interface OllamaStartResult {
  started: boolean;
  detail: string;
}

export async function startOllama(args: {
  executable: string;
  baseUrl: string;
}): Promise<OllamaStartResult> {
  const base = ollamaApiBase(args.baseUrl);
  if ((await probeOllama(base)).reachable) {
    return { started: false, detail: "Ollama is already answering." };
  }
  if (!path.isAbsolute(args.executable)) {
    return {
      started: false,
      detail: "The Ollama executable must be an absolute path.",
    };
  }
  const address = bindAddress(args.baseUrl);
  const child = spawn(args.executable, ["serve"], {
    shell: false,
    detached: true,
    stdio: "ignore",
    env: sanitizedEnv(address === null ? {} : { OLLAMA_HOST: address }),
  });
  const failed = await new Promise<Error | null>((resolve) => {
    child.once("error", (error: Error) => resolve(error));
    child.once("spawn", () => resolve(null));
  });
  child.unref();
  if (failed !== null || child.pid === undefined) {
    return {
      started: false,
      detail: `Could not start ${args.executable}: ${failed?.message ?? "no process id"}.`,
    };
  }
  return {
    started: true,
    detail: `Started ${args.executable} (pid ${child.pid}).`,
  };
}
