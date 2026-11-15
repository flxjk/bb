# Gemini (native API bridge)

Runs bb threads on Gemini through the official `@google/genai` SDK. This is a
provider bridge, not an AI service and not a CLI wrapper: nothing is spawned, the
bridge speaks the provider-bridge JSON-RPC protocol directly, and model discovery
comes from the API key itself.

Use it when you want the API-key catalogue — `gemini-4-carbon`, `gemini-4-argon`,
`gemini-3.8-flash` — as ordinary models in the composer picker. The `agy` CLI gates
Carbon and Argon behind plan and ADC sign-in; the API key does not.

## Settings

| Setting          | Meaning                                                                             |
| ---------------- | ----------------------------------------------------------------------------------- |
| `apiKey`         | AI Studio API key. Secret: stored under the plugin data dir, never sent to the app. |
| `model`          | Default model id for new threads on this provider.                                  |
| `reasoningLevel` | Default thinking budget the bridge asks for.                                        |

## Install

```bash
bb plugin build .
bb plugin install .
bb plugin config gemini-bridge set apiKey "<AI Studio key>"
```

## Verified

- The shipped conformance kit passes all 17 canonical protocol scenarios
  (`pnpm exec vitest run --config vitest.config.ts`, needs `GEMINI_API_KEY` or
  `GEMINI_BRIDGE_API_KEY` in the environment; without a key the suite skips itself).
- Live catalogue: 35 models discovered from the key, including `gemini-4-carbon`,
  `gemini-4-argon` and `gemini-3.8-flash`.
- Live threads: a `gemini-3.8-flash` turn answered `ok`, and a `gemini-4-carbon` turn
  answered through the same bridge.

## Known gap

`providerHealth` in `src/provider-bridge.ts` calls its health helper with `undefined`
instead of the parsed params, so a maintenance probe that carries `envVars` cannot
see the configured key. Thread execution is unaffected; the health line can read
`not_installed` on a fresh install.
