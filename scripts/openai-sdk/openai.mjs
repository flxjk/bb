import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-5-mini";
const DEFAULT_PROMPT = "Reply with exactly: PONG";

function parseArgs(argv) {
  const args = {
    prompt: DEFAULT_PROMPT,
    model: DEFAULT_MODEL,
    system: undefined,
    baseUrl: process.env.OPENAI_BASE_URL,
    stream: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--stream") args.stream = true;
    else if (flag === "--json") args.json = true;
    else if (flag === "--prompt") args.prompt = argv[++index];
    else if (flag === "--model") args.model = argv[++index];
    else if (flag === "--system") args.system = argv[++index];
    else if (flag === "--base-url") args.baseUrl = argv[++index];
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY;
if (!apiKey && !args.baseUrl) {
  console.error(
    "Set OPENAI_API_KEY for api.openai.com, or --base-url for an OpenAI-compatible server.",
  );
  process.exit(1);
}

const client = new OpenAI({
  apiKey: apiKey ?? "not-needed",
  ...(args.baseUrl === undefined ? {} : { baseURL: args.baseUrl }),
});

const messages = [
  ...(args.system === undefined
    ? []
    : [{ role: "system", content: args.system }]),
  { role: "user", content: args.prompt },
];

async function main() {
  if (args.stream) {
    const stream = await client.chat.completions.create({
      model: args.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    });
    let usage;
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) process.stdout.write(text);
      if (chunk.usage) usage = chunk.usage;
    }
    process.stdout.write("\n");
    if (usage) {
      console.error(
        `[tokens: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens} total=${usage.total_tokens}]`,
      );
    }
    return;
  }

  const response = await client.chat.completions.create({
    model: args.model,
    messages,
  });
  const choice = response.choices[0];
  const text = choice?.message?.content ?? "";
  if (args.json) {
    console.log(
      JSON.stringify(
        {
          provider: "openai",
          model: response.model,
          text,
          finishReason: choice?.finish_reason ?? null,
          usage: response.usage ?? null,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(text);
  if (response.usage) {
    console.error(
      `[tokens: prompt=${response.usage.prompt_tokens} completion=${response.usage.completion_tokens} total=${response.usage.total_tokens}]`,
    );
  }
}

await main();
