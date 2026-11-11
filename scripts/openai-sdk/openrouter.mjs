import { OpenRouter } from "@openrouter/sdk";

const DEFAULT_MODEL = "openai/gpt-5-mini";
const DEFAULT_PROMPT = "Reply with exactly: PONG";

function parseArgs(argv) {
  const args = {
    prompt: DEFAULT_PROMPT,
    model: DEFAULT_MODEL,
    system: undefined,
    stream: false,
    json: false,
    sort: undefined,
    zdr: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--stream") args.stream = true;
    else if (flag === "--json") args.json = true;
    else if (flag === "--zdr") args.zdr = true;
    else if (flag === "--prompt") args.prompt = argv[++index];
    else if (flag === "--model") args.model = argv[++index];
    else if (flag === "--system") args.system = argv[++index];
    else if (flag === "--sort") args.sort = argv[++index];
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("Set OPENROUTER_API_KEY (or run through ./run.sh).");
  process.exit(1);
}

const openRouter = new OpenRouter({ apiKey });
const provider =
  args.sort === undefined && !args.zdr
    ? undefined
    : {
        ...(args.sort === undefined ? {} : { sort: args.sort }),
        zdr: args.zdr,
      };
const chatRequest = {
  model: args.model,
  messages: [
    ...(args.system === undefined
      ? []
      : [{ role: "system", content: args.system }]),
    { role: "user", content: args.prompt },
  ],
  ...(provider === undefined ? {} : { provider }),
};

function usageLine(usage) {
  if (!usage) return null;
  const cost =
    typeof usage.cost === "number" ? ` cost=$${usage.cost.toFixed(6)}` : "";
  return `[tokens: prompt=${usage.promptTokens} completion=${usage.completionTokens} total=${usage.totalTokens}${cost}]`;
}

async function main() {
  if (args.stream) {
    const result = await openRouter.chat.send({
      chatRequest: { ...chatRequest, stream: true },
    });
    let usage;
    for await (const chunk of result) {
      const text = chunk.choices?.[0]?.delta?.content ?? "";
      if (text) process.stdout.write(text);
      if (chunk.usage) usage = chunk.usage;
    }
    process.stdout.write("\n");
    const line = usageLine(usage);
    if (line) console.error(line);
    return;
  }

  const result = await openRouter.chat.send({
    chatRequest: { ...chatRequest, stream: false },
  });
  const choice = result.choices?.[0];
  const text = choice?.message?.content ?? "";
  if (args.json) {
    console.log(
      JSON.stringify(
        {
          provider: "openrouter",
          model: result.model,
          text,
          finishReason: choice?.finishReason ?? null,
          usage: result.usage ?? null,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(text);
  const line = usageLine(result.usage);
  if (line) console.error(line);
}

await main();
