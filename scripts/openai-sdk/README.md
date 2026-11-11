# OpenAI and OpenRouter SDK scripts

Runnable scripts for the two official TypeScript SDKs —
[`openai`](https://www.npmjs.com/package/openai) (7.55.0) and
[`@openrouter/sdk`](https://www.npmjs.com/package/@openrouter/sdk) (1.5.83) — plus
the small eval harness that checks whether a model actually answers correctly.

Everything here is copy-paste: each file is self-contained, and the snippets
below are complete programs rather than fragments.

## Setup

```bash
./run.sh models.mjs
```

`run.sh` installs both SDKs into this directory on first use with
`pnpm install --ignore-workspace` (this directory is deliberately not a workspace
member), then runs the script. It fills in keys it can find, in this order: the
environment, `~/.zshrc`, then bb's own stored secrets under
`~/.bb/plugins/bb--local-stack/secrets/` (or the dev data directory that matches
`~/.bb-dev/*/`). Keys it fills in: `OPENROUTER_API_KEY`, `OPENAI_API_KEY`. An
environment variable you set yourself always wins.

## Scripts

| Script           | What it does                                                                         |
| ---------------- | ------------------------------------------------------------------------------------ |
| `openai.mjs`     | One prompt through the OpenAI SDK. `--stream`, `--json`, `--base-url`.               |
| `openrouter.mjs` | One prompt through the OpenRouter SDK. `--stream`, `--json`, `--sort`, `--zdr`.      |
| `models.mjs`     | Lists model ids from either platform. `--provider`, `--filter`, `--limit`, `--json`. |
| `evals.mjs`      | Runs four fixed cases against a model and reports pass/fail.                         |

```bash
./run.sh openrouter.mjs --prompt "Reply with exactly: PONG"
./run.sh openrouter.mjs --model google/gemini-3.1-flash-lite --stream --prompt "Count 1 to 5."
./run.sh openrouter.mjs --model openai/gpt-5-mini --sort price --zdr --prompt "One word: capital of Estonia."
./run.sh models.mjs --provider openrouter --filter gemini-3 --limit 400

./run.sh openai.mjs --prompt "Reply with exactly: PONG"
OPENAI_BASE_URL=http://127.0.0.1:11434/v1 ./run.sh openai.mjs --model lfm3:1.7b --prompt "Reply with exactly: PONG"

./run.sh evals.mjs --provider openrouter --model openai/gpt-5-mini
OPENAI_BASE_URL=http://127.0.0.1:11434/v1 ./run.sh evals.mjs --provider openai --model lfm3:1.7b
```

## Keys

`OPENROUTER_API_KEY` comes from `openrouter.ai/keys` and bills your OpenRouter
credit. `OPENAI_API_KEY` comes from `platform.openai.com/api-keys` and bills your
OpenAI organisation. The OpenAI SDK also accepts any OpenAI-compatible server:
pass `--base-url` (or set `OPENAI_BASE_URL`) and the key stops mattering, which
is how the scripts run against Ollama, vLLM, or LM Studio with no cloud call.

`models.mjs --provider openai` with no key and no base URL prints a skip note
instead of failing, and `evals.mjs` skips a provider whose credentials are
missing, so a half-configured checkout still runs the half that works.

## Copy-paste snippets

### One prompt, OpenAI

```js
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const response = await client.chat.completions.create({
  model: "gpt-5-mini",
  messages: [{ role: "user", content: "Reply with exactly: PONG" }],
});

console.log(response.choices[0].message.content);
console.log(response.usage);
```

Point it anywhere OpenAI-compatible by adding `baseURL`:

```js
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "not-needed",
  baseURL: "http://127.0.0.1:11434/v1",
});
```

### One prompt, OpenRouter

```js
import { OpenRouter } from "@openrouter/sdk";

const openRouter = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

const result = await openRouter.chat.send({
  chatRequest: {
    model: "openai/gpt-5-mini",
    messages: [{ role: "user", content: "Reply with exactly: PONG" }],
    stream: false,
  },
});

console.log(result.choices[0].message.content);
console.log(result.usage?.cost);
```

`result.usage.cost` is the charge in US dollars for that one call, which the
OpenAI SDK does not report.

### Streaming

```js
const stream = await client.chat.completions.create({
  model: "gpt-5-mini",
  messages: [{ role: "user", content: "Count 1 to 5." }],
  stream: true,
  stream_options: { include_usage: true },
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

```js
const result = await openRouter.chat.send({
  chatRequest: { model: "openai/gpt-5-mini", messages, stream: true },
});

for await (const chunk of result) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

### Timeouts and cancellation

Both SDKs take a request-scoped timeout, which is what `evals.mjs` uses:

```js
await client.chat.completions.create(body, { timeout: 60_000, signal });
await openRouter.chat.send(
  { chatRequest: body },
  { timeoutMs: 60_000, signal },
);
```

### A bb AI service on either platform

Drop this in as the `server.ts` of a plugin whose `package.json` names it under
`bb.server`, and both platforms appear in Settings → AI services next to
Automatic, Ollama, Gemini and DeepSeek:

```ts
import OpenAI from "openai";
import { OpenRouter } from "@openrouter/sdk";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function openAiServicesPlugin(
  bb: BbPluginApi,
): Promise<void> {
  const settings = bb.settings.define({
    openaiApiKey: {
      type: "string",
      label: "OpenAI API key",
      secret: true,
      default: "",
    },
    openaiModel: {
      type: "string",
      label: "OpenAI model",
      default: "gpt-5-mini",
    },
    openrouterApiKey: {
      type: "string",
      label: "OpenRouter API key",
      secret: true,
      default: "",
    },
    openrouterModel: {
      type: "string",
      label: "OpenRouter model",
      default: "openai/gpt-5-mini",
    },
  });

  let values = await settings.get();
  settings.onChange((next) => {
    values = next;
  });

  const ready = (key: string, hint: string) =>
    key.trim().length > 0
      ? { ready: true as const }
      : { ready: false as const, message: hint };

  bb.experimental_aiServices.register({
    id: "openai-api",
    displayName: "OpenAI (API)",
    status: () =>
      Promise.resolve(ready(values.openaiApiKey, "Set the OpenAI API key.")),
    async complete(prompt, options) {
      const client = new OpenAI({ apiKey: values.openaiApiKey.trim() });
      const response = await client.chat.completions.create(
        {
          model: values.openaiModel.trim(),
          messages: [{ role: "user", content: prompt }],
        },
        { signal: options.signal },
      );
      const content = response.choices[0]?.message?.content;
      return typeof content === "string" ? content.trim() : "";
    },
  });

  bb.experimental_aiServices.register({
    id: "openrouter-api",
    displayName: "OpenRouter (API)",
    status: () =>
      Promise.resolve(
        ready(values.openrouterApiKey, "Set the OpenRouter API key."),
      ),
    async complete(prompt, options) {
      const openRouter = new OpenRouter({
        apiKey: values.openrouterApiKey.trim(),
      });
      const result = await openRouter.chat.send(
        {
          chatRequest: {
            model: values.openrouterModel.trim(),
            messages: [{ role: "user", content: prompt }],
            stream: false,
          },
        },
        { signal: options.signal, timeoutMs: 5_000 },
      );
      const content = result.choices?.[0]?.message?.content;
      return typeof content === "string" ? content.trim() : "";
    },
  });
}
```

bb aborts titles and commit messages after five seconds, so a slow model fails
there even though the same model answers fine from `openrouter.mjs`.

## Evals

`evals.mjs` asks four fixed questions whose answers are checkable without a
judge model:

| Case         | Prompt                                                                                   | Passes when                         |
| ------------ | ---------------------------------------------------------------------------------------- | ----------------------------------- |
| `exact`      | `Reply with exactly: PONG`                                                               | the reply is `PONG`                 |
| `arithmetic` | `What is 17 * 23? Reply with only the number.`                                           | the digits are `391`                |
| `json`       | `Reply with only a JSON object with the keys "city" and "country" for Tallinn, Estonia.` | it parses and both fields are right |
| `count`      | `Reply with only the number of letters in the word strawberry.`                          | the digits are `10`                 |

Measured on this machine:

```
openrouter  openai/gpt-5-mini    exact       pass   3093ms   86
openrouter  openai/gpt-5-mini    arithmetic  pass   3089ms   100
openrouter  openai/gpt-5-mini    json        pass   2090ms   159
openrouter  openai/gpt-5-mini    count       pass   2028ms   127

4 passed, 0 failed, 0 errored, 0 skipped
```

```
openai      lfm3:1.7b            exact       pass   1134ms   86
openai      lfm3:1.7b            arithmetic  pass   1525ms   122
openai      lfm3:1.7b            json        pass   1622ms   136
openai      lfm3:1.7b            count       pass   6765ms   472

4 passed, 0 failed, 0 errored, 0 skipped
```

The harness is not a rubber stamp. `ggml-org/gemma-4-E4B-it-GGUF:Q8_0` answered
`11` letters for `strawberry`:

```
openai      ggml-org/gemma-4-E4B-it-GGUF:Q8_0 count       fail   3738ms   31
  fail: expected 10, got "11"

0 passed, 1 failed, 0 errored, 0 skipped
```

A failing or errored case exits non-zero, so the command works as a gate:

```bash
./run.sh evals.mjs --provider openrouter --model openai/gpt-5-mini || echo "model regressed"
```

`--case` narrows the run, `--model` may be repeated to compare models in one
pass, `--timeout-ms` raises the per-case ceiling, and `--json` prints the rows
with the full reply text for a machine to read.
