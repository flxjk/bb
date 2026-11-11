import OpenAI from "openai";
import { OpenRouter } from "@openrouter/sdk";

const DEFAULT_TIMEOUT_MS = 60_000;

const CASES = [
  {
    name: "exact",
    prompt: "Reply with exactly: PONG",
    check: (text) =>
      text.trim() === "PONG"
        ? null
        : `expected PONG, got ${JSON.stringify(text.trim())}`,
  },
  {
    name: "arithmetic",
    prompt: "What is 17 * 23? Reply with only the number.",
    check: (text) => {
      const digits = text.replace(/[^0-9]/gu, "");
      return digits === "391"
        ? null
        : `expected 391, got ${JSON.stringify(text.trim())}`;
    },
  },
  {
    name: "json",
    prompt:
      'Reply with only a JSON object with the keys "city" and "country" for Tallinn, Estonia.',
    check: (text) => {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start === -1 || end <= start) return "no JSON object in the reply";
      let parsed;
      try {
        parsed = JSON.parse(text.slice(start, end + 1));
      } catch (error) {
        return `invalid JSON: ${error.message}`;
      }
      if (parsed.city !== "Tallinn")
        return `city is ${JSON.stringify(parsed.city)}`;
      if (parsed.country !== "Estonia")
        return `country is ${JSON.stringify(parsed.country)}`;
      return null;
    },
  },
  {
    name: "count",
    prompt: "Reply with only the number of letters in the word strawberry.",
    check: (text) => {
      const digits = text.replace(/[^0-9]/gu, "");
      return digits === "10"
        ? null
        : `expected 10, got ${JSON.stringify(text.trim())}`;
    },
  },
];

function parseArgs(argv) {
  const args = {
    providers: [],
    models: [],
    cases: [],
    baseUrl: process.env.OPENAI_BASE_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") args.json = true;
    else if (flag === "--provider") args.providers.push(argv[++index]);
    else if (flag === "--model") args.models.push(argv[++index]);
    else if (flag === "--case") args.cases.push(argv[++index]);
    else if (flag === "--base-url") args.baseUrl = argv[++index];
    else if (flag === "--timeout-ms") args.timeoutMs = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (args.providers.length === 0) args.providers = ["openai", "openrouter"];
  return args;
}

function openAiTarget(args) {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY;
  if (!apiKey && !args.baseUrl) {
    return { note: "no OPENAI_API_KEY and no OPENAI_BASE_URL" };
  }
  const client = new OpenAI({
    apiKey: apiKey ?? "not-needed",
    ...(args.baseUrl === undefined ? {} : { baseURL: args.baseUrl }),
  });
  return {
    note: null,
    defaultModel: "gpt-5-mini",
    async run(model, prompt, timeoutMs) {
      const response = await client.chat.completions.create(
        { model, messages: [{ role: "user", content: prompt }] },
        { timeout: timeoutMs },
      );
      return {
        text: response.choices[0]?.message?.content ?? "",
        tokens: response.usage?.total_tokens ?? null,
      };
    },
  };
}

function openRouterTarget() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { note: "no OPENROUTER_API_KEY" };
  const openRouter = new OpenRouter({ apiKey });
  return {
    note: null,
    defaultModel: "openai/gpt-5-mini",
    async run(model, prompt, timeoutMs) {
      const result = await openRouter.chat.send(
        {
          chatRequest: {
            model,
            messages: [{ role: "user", content: prompt }],
            stream: false,
          },
        },
        { timeoutMs },
      );
      return {
        text: result.choices?.[0]?.message?.content ?? "",
        tokens: result.usage?.totalTokens ?? null,
      };
    },
  };
}

function pad(value, width) {
  return String(value).padEnd(width);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cases =
    args.cases.length === 0
      ? CASES
      : CASES.filter((entry) => args.cases.includes(entry.name));
  if (cases.length === 0) throw new Error("No eval cases selected.");

  const builders = { openai: openAiTarget, openrouter: openRouterTarget };
  const rows = [];
  const skips = [];

  for (const provider of args.providers) {
    const builder = builders[provider];
    if (!builder) throw new Error(`Unknown provider: ${provider}`);
    const target = builder(args);
    if (target.note) {
      skips.push({ provider, note: target.note });
      continue;
    }
    const models = args.models.length > 0 ? args.models : [target.defaultModel];
    for (const model of models) {
      for (const evalCase of cases) {
        const startedAt = Date.now();
        let row;
        try {
          const answer = await target.run(
            model,
            evalCase.prompt,
            args.timeoutMs,
          );
          const failure = evalCase.check(answer.text);
          row = {
            provider,
            model,
            case: evalCase.name,
            result: failure === null ? "pass" : "fail",
            detail: failure,
            ms: Date.now() - startedAt,
            tokens: answer.tokens,
            text: answer.text.trim().slice(0, 200),
          };
        } catch (error) {
          row = {
            provider,
            model,
            case: evalCase.name,
            result: "error",
            detail: error instanceof Error ? error.message : String(error),
            ms: Date.now() - startedAt,
            tokens: null,
            text: "",
          };
        }
        rows.push(row);
        if (!args.json) {
          const mark = row.result === "pass" ? "pass" : row.result;
          console.log(
            `${pad(provider, 11)} ${pad(model, 20)} ${pad(evalCase.name, 11)} ${pad(mark, 6)} ${pad(`${row.ms}ms`, 8)} ${row.tokens ?? "-"}`,
          );
          if (row.detail) console.log(`  ${row.result}: ${row.detail}`);
        }
      }
    }
  }

  const passed = rows.filter((row) => row.result === "pass").length;
  const failed = rows.filter((row) => row.result === "fail").length;
  const errored = rows.filter((row) => row.result === "error").length;

  if (args.json) {
    console.log(
      JSON.stringify({ rows, skips, passed, failed, errored }, null, 2),
    );
  } else {
    for (const skip of skips)
      console.log(`${skip.provider}: skipped (${skip.note})`);
    console.log(
      `\n${passed} passed, ${failed} failed, ${errored} errored, ${skips.length} skipped`,
    );
  }

  if (failed > 0 || errored > 0) process.exit(1);
}

await main();
