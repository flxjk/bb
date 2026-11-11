import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  DEFAULT_TIMEOUT_MS,
  OpenVikingClient,
  OpenVikingError,
  isVikingUri,
  normalizeBaseUrl,
  type OpenVikingEntry,
  type OpenVikingGrepMatch,
  type OpenVikingSearchResult,
} from "./openviking.js";
import { installLocalAgents } from "./local-agents.js";
import {
  AI_SERVICE_IDS,
  installAiServices,
  isAiServiceId,
} from "./ai-services.js";

const DEFAULT_MEMORY_ROOT = "viking://user/default/memories";
const HEALTH_POLL_MS = 30_000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const uriSchema = z
  .string()
  .min(1)
  .refine(isVikingUri, "Expected a viking:// URI");

const gatewayUrlSchema = z.string().superRefine((value, context) => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    context.addIssue({
      code: "custom",
      message: "Gateway URL must be a valid URL.",
    });
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    context.addIssue({
      code: "custom",
      message: "Gateway URL must start with http:// or https://.",
    });
  }
});

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function formatEntries(entries: readonly OpenVikingEntry[]): string {
  if (entries.length === 0) return "No entries.";
  return entries
    .map((entry) => {
      const kind = entry.isDir ? "dir " : "file";
      const abstract = entry.abstract === null ? "" : ` — ${entry.abstract}`;
      return `${kind} ${entry.uri}${abstract}`;
    })
    .join("\n");
}

function formatGrep(matches: readonly OpenVikingGrepMatch[]): string {
  if (matches.length === 0) return "No matches.";
  return matches
    .map((match) => `${match.uri}:${match.line}: ${match.content}`)
    .join("\n");
}

function formatSearch(result: OpenVikingSearchResult): string {
  if (result.entries.length > 0) {
    return result.entries
      .map((entry) => {
        const score =
          entry.score === null ? "" : ` (${entry.score.toFixed(3)})`;
        return `${entry.uri}${score}\n${entry.abstract}`;
      })
      .join("\n\n");
  }
  if (result.rendered.length > 0) return result.rendered;
  if (result.retrievalErrors.length > 0) {
    return `Semantic retrieval is unavailable:\n${result.retrievalErrors.join("\n")}`;
  }
  return "No matches.";
}

function describeError(error: unknown): string {
  if (error instanceof OpenVikingError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export default async function openvikingPlugin(bb: BbPluginApi): Promise<void> {
  const settings = bb.settings.define({
    baseUrl: {
      type: "string",
      label: "OpenViking gateway URL",
      description:
        "The OpenViking gateway bb reads and writes memories through. Blank uses the loopback default, so nothing leaves this machine unless you name a remote host.",
      experimental_schema: gatewayUrlSchema,
      default: "http://127.0.0.1:1933",
    },
    apiKey: {
      type: "string",
      label: "OpenViking API key",
      description:
        "Sent as X-API-Key on every gateway request. Leave empty for a trusted local gateway that runs in dev auth mode.",
      secret: true,
      default: "",
    },
  });

  let values = await settings.get();
  let client = buildClient(values);
  let connected = false;

  function buildClient(next: {
    baseUrl: string;
    apiKey: string;
  }): OpenVikingClient {
    return new OpenVikingClient({
      baseUrl: normalizeBaseUrl(next.baseUrl),
      apiKey: next.apiKey.length > 0 ? next.apiKey : null,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  }

  settings.onChange((next) => {
    values = next;
    client = buildClient(next);
  });

  bb.background.service("health", {
    async start(signal) {
      while (!signal.aborted) {
        try {
          const health = await client.health();
          connected = health.healthy;
        } catch {
          connected = false;
        }
        await sleep(HEALTH_POLL_MS, signal);
      }
    },
  });

  bb.agents.registerTool({
    name: "openviking_search",
    description:
      "Search the local OpenViking context database: memories, resources, and skills the user already stored.",
    instructions:
      "Search OpenViking before asking the user to repeat context they may have stored. Read a hit with openviking_read before relying on it.",
    presentation: {
      label: {
        pending: "Searching OpenViking",
        completed: "Searched OpenViking",
      },
    },
    parameters: z.object({
      query: z.string().min(1).describe("What to look for"),
      uri: uriSchema
        .optional()
        .describe("Restrict the search to this viking:// subtree"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_LIMIT)
        .optional()
        .describe("How many results to return"),
    }),
    async execute({ query, uri, limit }) {
      const scope = uri ?? DEFAULT_MEMORY_ROOT;
      const bounded = limit ?? DEFAULT_LIMIT;
      try {
        const result = await client.search(query, { limit: bounded });
        if (result.entries.length > 0) return formatSearch(result);
      } catch (error) {
        if (!(error instanceof OpenVikingError)) throw error;
      }
      const matches = await client.grep(query, scope, bounded);
      return formatGrep(matches);
    },
  });

  bb.agents.registerTool({
    name: "openviking_read",
    description:
      "Read one OpenViking file in full, or its generated abstract or overview.",
    presentation: {
      label: {
        pending: "Reading OpenViking",
        completed: "Read OpenViking",
      },
    },
    parameters: z.object({
      uri: uriSchema.describe("The viking:// file to read"),
      detail: z
        .enum(["full", "abstract", "overview"])
        .optional()
        .describe(
          "full reads the body; abstract and overview read the summaries",
        ),
    }),
    async execute({ uri, detail }) {
      if (detail === "abstract") return client.abstract(uri);
      if (detail === "overview") return client.overview(uri);
      return client.read(uri);
    },
  });

  bb.agents.registerTool({
    name: "openviking_ls",
    description: "List a directory in the local OpenViking context database.",
    presentation: {
      label: {
        pending: "Listing OpenViking",
        completed: "Listed OpenViking",
      },
    },
    parameters: z.object({
      uri: uriSchema.optional().describe("The viking:// directory to list"),
      recursive: z.boolean().optional().describe("List subdirectories too"),
      limit: z.number().int().min(1).max(500).optional(),
    }),
    async execute({ uri, recursive, limit }) {
      const entries = await client.ls(uri ?? DEFAULT_MEMORY_ROOT, {
        recursive,
        limit,
      });
      return formatEntries(entries);
    },
  });

  bb.agents.registerTool({
    name: "openviking_remember",
    description:
      "Write a durable memory into the local OpenViking context database.",
    instructions:
      "Write only verified, reusable knowledge. Prefer one focused file per fact and a descriptive path under viking://user/default/memories.",
    presentation: {
      label: {
        pending: "Saving to OpenViking",
        completed: "Saved to OpenViking",
      },
    },
    parameters: z.object({
      uri: uriSchema.describe("The viking:// file to write"),
      content: z.string().min(1).describe("Markdown content to store"),
      mode: z
        .enum(["replace", "append"])
        .optional()
        .describe("replace overwrites; append adds to the existing file"),
    }),
    async execute({ uri, content, mode }) {
      const result = await client.write(uri, content, mode ?? "replace");
      return `Wrote ${result.writtenBytes} bytes to ${result.uri} (${result.mode}).`;
    },
  });

  bb.agents.registerTool({
    name: "openviking_forget",
    description: "Delete one file from the local OpenViking context database.",
    instructions:
      "Delete only what the user asked you to forget, and name the exact viking:// file.",
    presentation: {
      label: {
        pending: "Forgetting in OpenViking",
        completed: "Forgot in OpenViking",
      },
    },
    parameters: z.object({
      uri: uriSchema.describe("The viking:// file to delete"),
    }),
    async execute({ uri }) {
      await client.remove(uri);
      return `Deleted ${uri}.`;
    },
  });

  bb.agents.registerTool({
    name: "openviking_status",
    description:
      "Report whether the local OpenViking gateway is reachable and initialized.",
    presentation: {
      label: {
        pending: "Checking OpenViking",
        completed: "Checked OpenViking",
      },
    },
    parameters: z.object({}),
    async execute() {
      const health = await client.health();
      const status = await client.status();
      return [
        `gateway: ${client.config.baseUrl}`,
        `healthy: ${health.healthy}`,
        `version: ${health.version}`,
        `auth: ${health.authMode}`,
        `initialized: ${status.initialized}`,
        `user: ${status.user}`,
      ].join("\n");
    },
  });

  bb.agents.contributeInstructions(() => {
    if (!connected) return null;
    return [
      "OpenViking is reachable on this machine and holds the user's durable context.",
      `Search it with openviking_search, read hits with openviking_read, and save verified knowledge with openviking_remember under ${DEFAULT_MEMORY_ROOT}.`,
      "Everything stays local: the gateway is a loopback address and no request leaves this host.",
    ].join(" ");
  });

  const aiServices = await installAiServices(bb);

  bb.cli.register(
    defineCli({
      name: "local-stack",
      summary:
        "Run bb on local agents and models, and keep memory in OpenViking",
      description:
        "OpenViking stores the user's durable context as a viking:// filesystem; `openviking` reads and writes it. The `models` command lists the model ids each configured AI service offers, and `ollama start` starts a local Ollama that is not answering yet.",
      commands: {
        models: cliCommand({
          summary: "List the model ids an AI service offers",
          description:
            "Reads the service's own model list: Ollama's installed models, or the catalogue its API publishes. Nothing is cached.",
          positionals: [
            {
              name: "service",
              description: "ollama, openrouter, gemini, or deepseek",
              required: true,
            },
          ],
          options: {
            json: {
              type: "boolean",
              description: "Emit machine-readable JSON",
            },
          },
          async run(input) {
            const service = input.positionals.service;
            if (!isAiServiceId(service)) {
              throw new PluginCliError(`unknown AI service: ${service}`, {
                hint: `expected one of ${AI_SERVICE_IDS.join(", ")}`,
              });
            }
            const models = await aiServices.listModels(service);
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify({ service, models }, null, 2)
                : models.length === 0
                  ? "No models."
                  : models.join("\n"),
            };
          },
        }),
        prompt: cliCommand({
          summary: "Ask one AI service one prompt and print its answer",
          description:
            "Runs the same completion bb uses for thread titles and commit messages, so a service that answers here will answer there. The answer is printed as the service returned it.",
          positionals: [
            {
              name: "service",
              description: "ollama, openrouter, gemini, or deepseek",
              required: true,
            },
            {
              name: "prompt",
              description: "What to ask",
              required: true,
              variadic: true,
            },
          ],
          async run(input, ctx) {
            const service = input.positionals.service;
            if (!isAiServiceId(service)) {
              throw new PluginCliError(`unknown AI service: ${service}`, {
                hint: `expected one of ${AI_SERVICE_IDS.join(", ")}`,
              });
            }
            const prompt = input.positionals.prompt.join(" ").trim();
            if (prompt.length === 0) {
              throw new PluginCliError("prompt requires some text");
            }
            const answer = await aiServices.complete(
              service,
              prompt,
              ctx.signal ?? AbortSignal.timeout(60_000),
              60_000,
            );
            return { exitCode: 0, stdout: answer };
          },
        }),
        "ollama start": cliCommand({
          summary: "Start a local Ollama that is not answering",
          description:
            "Starts the executable named in the plugin settings, detached and without a shell, and only when nothing answers at the configured address. bb never stops an Ollama it did not start.",
          async run() {
            const result = await aiServices.startOllama();
            return { exitCode: 0, stdout: result.detail };
          },
        }),
        "openviking status": cliCommand({
          summary: "Check the local OpenViking gateway",
          options: {
            json: {
              type: "boolean",
              description: "Emit machine-readable JSON",
            },
          },
          async run(input) {
            const health = await client.health();
            const status = await client.status();
            const payload = {
              gateway: client.config.baseUrl,
              healthy: health.healthy,
              version: health.version,
              authMode: health.authMode,
              initialized: status.initialized,
              user: status.user,
            };
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(payload, null, 2)
                : Object.entries(payload)
                    .map(([key, value]) => `${key}: ${String(value)}`)
                    .join("\n"),
            };
          },
        }),
        "openviking search": cliCommand({
          summary: "Search OpenViking memories and resources",
          positionals: [
            {
              name: "query",
              description: "Words to search for",
              required: true,
              variadic: true,
            },
          ],
          options: {
            uri: {
              type: "string",
              description: "Restrict the search to this viking:// subtree",
            },
            limit: {
              type: "integer",
              min: 1,
              max: MAX_LIMIT,
              default: DEFAULT_LIMIT,
              description: "How many results to return",
            },
            json: {
              type: "boolean",
              description: "Emit machine-readable JSON",
            },
          },
          async run(input) {
            const query = input.positionals.query.join(" ").trim();
            if (query.length === 0) {
              throw new PluginCliError("search requires a query");
            }
            const scope = input.options.uri ?? DEFAULT_MEMORY_ROOT;
            if (!isVikingUri(scope)) {
              throw new PluginCliError(`not a viking:// URI: ${scope}`);
            }
            const limit = input.options.limit;
            let result: OpenVikingSearchResult | null = null;
            try {
              result = await client.search(query, { limit });
            } catch (error) {
              if (!(error instanceof OpenVikingError)) throw error;
            }
            if (result !== null && result.entries.length > 0) {
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(result, null, 2)
                  : formatSearch(result),
              };
            }
            const matches = await client.grep(query, scope, limit);
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify({ matches }, null, 2)
                : formatGrep(matches),
            };
          },
        }),
        "openviking read": cliCommand({
          summary: "Read one OpenViking file",
          positionals: [
            {
              name: "uri",
              description: "The viking:// file to read",
              required: true,
            },
          ],
          options: {
            detail: {
              type: "enum",
              values: ["full", "abstract", "overview"],
              default: "full",
              description: "Which representation to read",
            },
          },
          async run(input) {
            const uri = input.positionals.uri;
            if (!isVikingUri(uri)) {
              throw new PluginCliError(`not a viking:// URI: ${uri}`);
            }
            const detail = input.options.detail;
            const content =
              detail === "abstract"
                ? await client.abstract(uri)
                : detail === "overview"
                  ? await client.overview(uri)
                  : await client.read(uri);
            return { exitCode: 0, stdout: content };
          },
        }),
        "openviking ls": cliCommand({
          summary: "List an OpenViking directory",
          positionals: [
            {
              name: "uri",
              description: "The viking:// directory to list",
              required: false,
            },
          ],
          options: {
            recursive: {
              type: "boolean",
              description: "List subdirectories too",
            },
            limit: {
              type: "integer",
              min: 1,
              max: 500,
              description: "How many entries to list",
            },
          },
          async run(input) {
            const uri = input.positionals.uri ?? DEFAULT_MEMORY_ROOT;
            if (!isVikingUri(uri)) {
              throw new PluginCliError(`not a viking:// URI: ${uri}`);
            }
            const entries = await client.ls(uri, {
              recursive: input.options.recursive,
              limit: input.options.limit,
            });
            return { exitCode: 0, stdout: formatEntries(entries) };
          },
        }),
        "openviking remember": cliCommand({
          summary: "Write a durable memory into OpenViking",
          positionals: [
            {
              name: "uri",
              description: "The viking:// file to write",
              required: true,
            },
            {
              name: "content",
              description: "Markdown content to store",
              required: true,
              variadic: true,
            },
          ],
          options: {
            mode: {
              type: "enum",
              values: ["replace", "append"],
              default: "replace",
              description: "replace overwrites; append adds to the file",
            },
          },
          async run(input) {
            const uri = input.positionals.uri;
            if (!isVikingUri(uri)) {
              throw new PluginCliError(`not a viking:// URI: ${uri}`);
            }
            const content = input.positionals.content.join(" ");
            if (content.trim().length === 0) {
              throw new PluginCliError("remember requires content");
            }
            const result = await client.write(uri, content, input.options.mode);
            return {
              exitCode: 0,
              stdout: `Wrote ${result.writtenBytes} bytes to ${result.uri} (${result.mode}).`,
            };
          },
        }),
        "openviking forget": cliCommand({
          summary: "Delete one OpenViking file",
          positionals: [
            {
              name: "uri",
              description: "The viking:// file to delete",
              required: true,
            },
          ],
          async run(input) {
            const uri = input.positionals.uri;
            if (!isVikingUri(uri)) {
              throw new PluginCliError(`not a viking:// URI: ${uri}`);
            }
            await client.remove(uri);
            return { exitCode: 0, stdout: `Deleted ${uri}.` };
          },
        }),
      },
    }),
  );

  await installLocalAgents(bb);

  bb.log.info(
    `Local Stack plugin loaded; OpenViking gateway ${values.baseUrl}; ${AI_SERVICE_IDS.length} AI services and every agent stay on hosts you configure`,
  );

  bb.onDispose(() => {
    connected = false;
  });
}
