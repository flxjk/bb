import OpenAI from "openai";
import { OpenRouter } from "@openrouter/sdk";

const DEFAULT_LIMIT = 500;

function parseArgs(argv) {
  const args = { providers: [], json: false, filter: "", limit: DEFAULT_LIMIT };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") args.json = true;
    else if (flag === "--provider") args.providers.push(argv[++index]);
    else if (flag === "--filter") args.filter = argv[++index].toLowerCase();
    else if (flag === "--limit") args.limit = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (args.providers.length === 0) args.providers = ["openai", "openrouter"];
  return args;
}

const args = parseArgs(process.argv.slice(2));

async function openaiModels() {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY;
  const baseURL = process.env.OPENAI_BASE_URL;
  if (!apiKey && !baseURL) {
    return { models: [], note: "no OPENAI_API_KEY and no OPENAI_BASE_URL" };
  }
  const client = new OpenAI({
    apiKey: apiKey ?? "not-needed",
    ...(baseURL === undefined ? {} : { baseURL }),
  });
  const models = [];
  for await (const model of client.models.list()) {
    models.push({ id: model.id, ownedBy: model.owned_by ?? null });
    if (models.length >= args.limit) break;
  }
  return { models, note: null };
}

async function openrouterModels() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { models: [], note: "no OPENROUTER_API_KEY" };
  const openRouter = new OpenRouter({ apiKey });
  const pager = await openRouter.models.list({ limit: args.limit });
  const models = [];
  for await (const page of pager) {
    const batch = page?.result?.data ?? page?.data ?? [];
    for (const model of batch) {
      models.push({
        id: model.id,
        name: model.name ?? null,
        contextLength: model.contextLength ?? null,
      });
      if (models.length >= args.limit) break;
    }
    if (models.length >= args.limit) break;
  }
  return { models, note: null };
}

const readers = { openai: openaiModels, openrouter: openrouterModels };
const results = [];
for (const provider of args.providers) {
  const reader = readers[provider];
  if (!reader) throw new Error(`Unknown provider: ${provider}`);
  results.push({ provider, ...(await reader()) });
}

for (const result of results) {
  const models = result.models
    .filter((model) => model.id.toLowerCase().includes(args.filter))
    .sort((left, right) => left.id.localeCompare(right.id));
  result.models = models;
}

if (args.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const result of results) {
    console.log(`# ${result.provider}`);
    if (result.note) console.log(`# skipped: ${result.note}`);
    for (const model of result.models) console.log(model.id);
  }
}

const total = results.reduce((sum, result) => sum + result.models.length, 0);
console.error(`[${total} models]`);
