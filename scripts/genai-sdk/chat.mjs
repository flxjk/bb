import { GoogleGenAI } from "@google/genai";

const DEFAULT_MODEL = "gemini-3.8-flash";
const DEFAULT_PROMPT = "Reply with exactly: PONG";

function parseArgs(argv) {
  const args = {
    prompt: DEFAULT_PROMPT,
    model: DEFAULT_MODEL,
    stream: false,
    system: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--stream") args.stream = true;
    else if (flag === "--prompt") args.prompt = argv[++index];
    else if (flag === "--model") args.model = argv[++index];
    else if (flag === "--system") args.system = argv[++index];
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return args;
}

function textOf(response) {
  const value = response.text;
  return typeof value === "function" ? value.call(response) : value;
}

const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error("Set GEMINI_API_KEY (or run through ./run.sh).");
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const ai = new GoogleGenAI({ apiKey });
const config =
  args.system === undefined ? {} : { systemInstruction: args.system };

if (args.stream) {
  const stream = await ai.models.generateContentStream({
    model: args.model,
    contents: args.prompt,
    config,
  });
  for await (const chunk of stream) {
    const text = textOf(chunk);
    if (text) process.stdout.write(text);
  }
  process.stdout.write("\n");
} else {
  const response = await ai.models.generateContent({
    model: args.model,
    contents: args.prompt,
    config,
  });
  console.log(textOf(response));
  const usage = response.usageMetadata;
  if (usage) {
    console.error(
      `[tokens: prompt=${usage.promptTokenCount ?? 0} total=${usage.totalTokenCount ?? 0}]`,
    );
  }
}
