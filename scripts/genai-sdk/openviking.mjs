import { GoogleGenAI } from "@google/genai";

const DEFAULT_MODEL = "gemini-3.8-flash";
const DEFAULT_GATEWAY = "http://127.0.0.1:1933";
const DEFAULT_PROMPT =
  "Search OpenViking memory for anything about Antigravity, then answer in one line with what you found and which tools you called.";
const MAX_ROUNDS = 6;

function parseArgs(argv) {
  const args = {
    prompt: DEFAULT_PROMPT,
    model: DEFAULT_MODEL,
    gateway: DEFAULT_GATEWAY,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--prompt") args.prompt = argv[++index];
    else if (flag === "--model") args.model = argv[++index];
    else if (flag === "--gateway") args.gateway = argv[++index];
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return args;
}

async function callGateway(gateway, path, init) {
  const response = await fetch(`${gateway}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json();
  if (body.error) {
    throw new Error(
      `${body.error.code ?? "error"}: ${body.error.message ?? "gateway error"}`,
    );
  }
  return body.result;
}

const tools = {
  openviking_search: async (gateway, args) => {
    const result = await callGateway(gateway, "/api/v1/search/search", {
      method: "POST",
      body: JSON.stringify({
        query: String(args.query ?? ""),
        limit: Number(args.limit ?? 10),
      }),
    });
    return result;
  },
  openviking_read: async (gateway, args) => {
    const uri = encodeURIComponent(String(args.uri ?? ""));
    return callGateway(gateway, `/api/v1/content/read?uri=${uri}`, {
      method: "GET",
    });
  },
  openviking_remember: async (gateway, args) => {
    return callGateway(gateway, "/api/v1/content/write", {
      method: "POST",
      body: JSON.stringify({
        uri: String(args.uri ?? ""),
        content: String(args.content ?? ""),
        mode: "replace",
      }),
    });
  },
};

const functionDeclarations = [
  {
    name: "openviking_search",
    description:
      "Search the user's OpenViking memory by meaning and return matching entries.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for." },
        limit: {
          type: "number",
          description: "Maximum entries to return, default 10.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "openviking_read",
    description: "Read one OpenViking file in full by its viking:// URI.",
    parameters: {
      type: "object",
      properties: { uri: { type: "string", description: "A viking:// URI." } },
      required: ["uri"],
    },
  },
  {
    name: "openviking_remember",
    description:
      "Write a confirmed fact back into OpenViking memory at a viking:// URI.",
    parameters: {
      type: "object",
      properties: {
        uri: {
          type: "string",
          description: "A viking:// URI under the user's memories.",
        },
        content: { type: "string", description: "Markdown content to store." },
      },
      required: ["uri", "content"],
    },
  },
];

const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error("Set GEMINI_API_KEY (or run through ./run.sh).");
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const ai = new GoogleGenAI({ apiKey });
const contents = [{ role: "user", parts: [{ text: args.prompt }] }];
const config = {
  tools: [{ functionDeclarations }],
  systemInstruction:
    "You are a memory assistant. OpenViking holds the user's durable context: search it before answering questions about past work, and write back only facts the user confirmed.",
};

for (let round = 0; round < MAX_ROUNDS; round += 1) {
  const response = await ai.models.generateContent({
    model: args.model,
    contents,
    config,
  });
  const calls = response.functionCalls ?? [];
  if (calls.length === 0) {
    const value = response.text;
    console.log(typeof value === "function" ? value.call(response) : value);
    process.exit(0);
  }
  const modelContent = response.candidates?.[0]?.content;
  contents.push(
    modelContent ?? {
      role: "model",
      parts: calls.map((call) => ({ functionCall: call })),
    },
  );
  const parts = [];
  for (const call of calls) {
    const handler = tools[call.name];
    let payload;
    try {
      if (!handler) throw new Error(`Unknown tool: ${call.name}`);
      payload = { result: await handler(args.gateway, call.args ?? {}) };
    } catch (error) {
      payload = {
        error: String(error instanceof Error ? error.message : error),
      };
    }
    console.error(`[tool] ${call.name}(${JSON.stringify(call.args ?? {})})`);
    parts.push({ functionResponse: { name: call.name, response: payload } });
  }
  contents.push({ role: "user", parts });
}

console.error(
  `Stopped after ${MAX_ROUNDS} tool rounds without a final answer.`,
);
process.exit(1);
