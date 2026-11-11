# Gemini JavaScript SDK scripts

Runnable scripts for the [`@google/genai`](https://www.npmjs.com/package/@google/genai)
JavaScript SDK, the direct Gemini API client. Unlike the
[Antigravity SDK scripts](../antigravity-sdk/README.md), nothing here shells out to
`agy`: the scripts call `generativelanguage.googleapis.com` with an API key, so
they work without OAuth, without the CLI, and without a Google Cloud project.

## Setup

```bash
./run.sh models.mjs
```

`run.sh` installs `@google/genai` into this directory on first use with
`pnpm install --ignore-workspace` (this directory is deliberately not a workspace
member), then runs the script. When `GEMINI_API_KEY` is unset it reads the key
from `~/.zshrc`, so the key never has to be copied into this directory. Set
`GOOGLE_API_KEY` instead if that is where the key lives.

## Scripts

| Script           | What it does                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `chat.mjs`       | One prompt, one answer. `--stream` prints tokens as they arrive. `--system` sets instructions.      |
| `models.mjs`     | Lists every model id the key can call, sorted, one per line.                                        |
| `openviking.mjs` | Declares OpenViking search/read/write as Gemini function calls and runs the tool loop to an answer. |

```bash
./run.sh chat.mjs --prompt "Reply with exactly: PONG"
./run.sh chat.mjs --prompt "Explain the repo layout." --stream
./run.sh chat.mjs --model gemini-4-carbon --prompt "Reply with exactly: PONG"
./run.sh chat.mjs --system "Answer in one short sentence." --prompt "What is ACP?"
./run.sh models.mjs
./run.sh openviking.mjs --prompt "What do we know about Antigravity?"
```

## Models

`models.mjs` prints what the key can actually call. The current key sees 27
models, including `gemini-3.8-flash` (the default here), `gemini-4-carbon`,
`gemini-4-argon`, the `gemini-3-pro-image` and `gemini-3.1-flash-image` image
models, `gemini-embedding-001` and `gemini-embedding-2`.

Gemini 4 Carbon and Argon are reachable **through the API key** even though the
`agy` CLI refuses them without an Ultra or Enterprise plan and Application
Default Credentials sign-in. The two paths are independent: the CLI gates on
plan and ADC, the API key gates on the key's own entitlement. If a model id is
missing from `models.mjs` output, the key cannot call it and no flag will help.

## Function calling

`openviking.mjs` is the reference for tool use. Two details matter:

- The gateway answers with an envelope, `{status, result, error, telemetry,
profile}`; the scripts unwrap `result` and throw on `error`.
- Gemini 3.x requires the `thoughtSignature` on `functionCall` parts to be echoed
  back. The script pushes the model's own `candidates[0].content` into the
  conversation instead of rebuilding `{functionCall}` objects, which preserves
  the signature. Rebuilding them fails with `Function call is missing a
thought_signature in functionCall parts`.

The loop stops after six tool rounds and exits non-zero if the model never
produces a final answer, so a runaway tool loop cannot hang a script.
