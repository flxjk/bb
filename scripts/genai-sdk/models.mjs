import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error("Set GEMINI_API_KEY (or run through ./run.sh).");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const pager = await ai.models.list();
const ids = [];
for await (const model of pager) {
  const name = String(model.name ?? "").replace(/^models\//u, "");
  if (name.length > 0) ids.push(name);
}
ids.sort();
for (const id of ids) console.log(id);
console.error(`[${ids.length} models]`);
