const DEFAULT_BASE_URL = "http://127.0.0.1:1933";
export const DEFAULT_TIMEOUT_MS = 15_000;

export interface OpenVikingConfig {
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly timeoutMs: number;
}

interface OpenVikingErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

interface OpenVikingEnvelope<T> {
  readonly status: "ok" | "error";
  readonly result: T | null;
  readonly error: OpenVikingErrorBody | null;
}

export class OpenVikingError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "OpenVikingError";
    this.code = code;
    this.details = details;
  }
}

export interface OpenVikingHealth {
  readonly healthy: boolean;
  readonly version: string;
  readonly authMode: string;
}

export interface OpenVikingStatus {
  readonly initialized: boolean;
  readonly user: string;
}

export interface OpenVikingEntry {
  readonly uri: string;
  readonly size: number;
  readonly isDir: boolean;
  readonly modTime: string | null;
  readonly abstract: string | null;
}

export interface OpenVikingGrepMatch {
  readonly uri: string;
  readonly line: number;
  readonly content: string;
}

export interface OpenVikingSearchEntry {
  readonly uri: string;
  readonly abstract: string;
  readonly score: number | null;
}

export interface OpenVikingSearchResult {
  readonly entries: readonly OpenVikingSearchEntry[];
  readonly rendered: string;
  readonly retrievalErrors: readonly string[];
}

export interface OpenVikingWriteResult {
  readonly uri: string;
  readonly writtenBytes: number;
  readonly mode: string;
  readonly taskId: string | null;
}

export function isVikingUri(value: string): boolean {
  return value.startsWith("viking://");
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return DEFAULT_BASE_URL;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseEntries(value: unknown): OpenVikingEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: OpenVikingEntry[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (record === null) continue;
    const uri = asString(record.uri);
    if (uri === null) continue;
    entries.push({
      uri,
      size: asNumber(record.size) ?? 0,
      isDir: record.isDir === true,
      modTime: asString(record.modTime),
      abstract: asString(record.abstract),
    });
  }
  return entries;
}

function parseGrepMatches(value: unknown): OpenVikingGrepMatch[] {
  const record = asRecord(value);
  const raw = record === null ? value : record.matches;
  if (!Array.isArray(raw)) return [];
  const matches: OpenVikingGrepMatch[] = [];
  for (const item of raw) {
    const entry = asRecord(item);
    if (entry === null) continue;
    const uri = asString(entry.uri);
    const content = asString(entry.content);
    if (uri === null || content === null) continue;
    matches.push({ uri, line: asNumber(entry.line) ?? 0, content });
  }
  return matches;
}

function parseSearchResult(value: unknown): OpenVikingSearchResult {
  const record = asRecord(value);
  if (record === null) {
    return { entries: [], rendered: "", retrievalErrors: [] };
  }
  const rawEntries = Array.isArray(record.entries) ? record.entries : [];
  const entries: OpenVikingSearchEntry[] = [];
  for (const item of rawEntries) {
    const entry = asRecord(item);
    if (entry === null) continue;
    const uri = asString(entry.uri);
    if (uri === null) continue;
    entries.push({
      uri,
      abstract: asString(entry.abstract) ?? "",
      score: asNumber(entry.score),
    });
  }
  const stats = asRecord(record.stats);
  const rawErrors = stats === null ? null : stats.retrieval_errors;
  const retrievalErrors = Array.isArray(rawErrors)
    ? rawErrors.filter((item): item is string => typeof item === "string")
    : [];
  return {
    entries,
    rendered: asString(record.rendered) ?? "",
    retrievalErrors,
  };
}

export class OpenVikingClient {
  readonly config: OpenVikingConfig;

  constructor(config: OpenVikingConfig) {
    this.config = config;
  }

  private async send(path: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body !== undefined)
      headers.set("Content-Type", "application/json");
    if (this.config.apiKey !== null && this.config.apiKey.length > 0) {
      headers.set("X-API-Key", this.config.apiKey);
    }
    try {
      return await fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new OpenVikingError(
        "NETWORK",
        `OpenViking gateway is unreachable at ${this.config.baseUrl}: ${reason}`,
        error,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async envelope<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.send(path, init);
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new OpenVikingError(
        "PROTOCOL",
        `OpenViking returned a non-JSON response (HTTP ${response.status})`,
        text.slice(0, 500),
      );
    }
    const envelope = asRecord(parsed);
    if (envelope === null) {
      throw new OpenVikingError(
        "PROTOCOL",
        "OpenViking returned an unexpected payload",
        parsed,
      );
    }
    const error = asRecord(envelope.error);
    if (error !== null) {
      throw new OpenVikingError(
        asString(error.code) ?? "UNKNOWN",
        asString(error.message) ?? "OpenViking request failed",
        error.details,
      );
    }
    if (envelope.status === "error") {
      throw new OpenVikingError(
        "UNKNOWN",
        `OpenViking request failed (HTTP ${response.status})`,
        envelope,
      );
    }
    if (!response.ok) {
      throw new OpenVikingError(
        "HTTP",
        `OpenViking returned HTTP ${response.status}`,
        envelope,
      );
    }
    return envelope.result as T;
  }

  async health(): Promise<OpenVikingHealth> {
    const response = await this.send("/health");
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new OpenVikingError(
        "PROTOCOL",
        `OpenViking /health returned a non-JSON response (HTTP ${response.status})`,
        text.slice(0, 500),
      );
    }
    const body = asRecord(parsed);
    if (body === null) {
      throw new OpenVikingError(
        "PROTOCOL",
        "OpenViking /health returned an unexpected payload",
        parsed,
      );
    }
    return {
      healthy: body.healthy === true,
      version: asString(body.version) ?? "unknown",
      authMode: asString(body.auth_mode) ?? "unknown",
    };
  }

  async status(): Promise<OpenVikingStatus> {
    const result = await this.envelope<unknown>("/api/v1/system/status");
    const record = asRecord(result);
    return {
      initialized: record !== null && record.initialized === true,
      user: (record === null ? null : asString(record.user)) ?? "default",
    };
  }

  async ls(
    uri: string,
    options: { recursive?: boolean; limit?: number } = {},
  ): Promise<OpenVikingEntry[]> {
    const params = new URLSearchParams({ uri });
    if (options.recursive === true) params.set("recursive", "true");
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const result = await this.envelope<unknown>(
      `/api/v1/fs/ls?${params.toString()}`,
    );
    return parseEntries(result);
  }

  async read(uri: string): Promise<string> {
    const params = new URLSearchParams({ uri });
    const result = await this.envelope<unknown>(
      `/api/v1/content/read?${params.toString()}`,
    );
    return typeof result === "string" ? result : JSON.stringify(result);
  }

  async abstract(uri: string): Promise<string> {
    const params = new URLSearchParams({ uri });
    const result = await this.envelope<unknown>(
      `/api/v1/content/abstract?${params.toString()}`,
    );
    return typeof result === "string" ? result : JSON.stringify(result);
  }

  async overview(uri: string): Promise<string> {
    const params = new URLSearchParams({ uri });
    const result = await this.envelope<unknown>(
      `/api/v1/content/overview?${params.toString()}`,
    );
    return typeof result === "string" ? result : JSON.stringify(result);
  }

  async write(
    uri: string,
    content: string,
    mode: "replace" | "append" = "replace",
  ): Promise<OpenVikingWriteResult> {
    const result = await this.envelope<unknown>("/api/v1/content/write", {
      method: "POST",
      body: JSON.stringify({ uri, content, mode }),
    });
    const record = asRecord(result);
    return {
      uri: (record === null ? null : asString(record.uri)) ?? uri,
      writtenBytes:
        (record === null ? null : asNumber(record.written_bytes)) ??
        content.length,
      mode: (record === null ? null : asString(record.mode)) ?? mode,
      taskId: record === null ? null : asString(record.task_id),
    };
  }

  async grep(
    pattern: string,
    uri: string,
    limit = 20,
  ): Promise<OpenVikingGrepMatch[]> {
    const result = await this.envelope<unknown>("/api/v1/search/grep", {
      method: "POST",
      body: JSON.stringify({ pattern, uri, limit }),
    });
    return parseGrepMatches(result);
  }

  async search(
    query: string,
    options: { limit?: number; mode?: string } = {},
  ): Promise<OpenVikingSearchResult> {
    const body: Record<string, unknown> = {
      query,
      limit: options.limit ?? 10,
    };
    if (options.mode !== undefined) body.mode = options.mode;
    const result = await this.envelope<unknown>("/api/v1/search/search", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return parseSearchResult(result);
  }

  async remove(uri: string): Promise<void> {
    const params = new URLSearchParams({ uri });
    await this.envelope<unknown>(`/api/v1/fs?${params.toString()}`, {
      method: "DELETE",
    });
  }
}
