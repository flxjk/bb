# Local Stack

Builtin plugin for a bb that runs on your own machine: OpenViking memory for
agents, threads on local agents, and bb's helper tasks on a model you choose.

## OpenViking memory

`openviking.ts` is the gateway client: `/health`, `/api/v1/system/status`,
`/api/v1/fs` (list and delete), `/api/v1/content/{read,abstract,overview,write}`,
and `/api/v1/search/{search,grep}`. It parses the gateway's
`{ status, result, error }` envelope and turns a gateway error into an
`OpenVikingError` carrying the gateway's own code, message, and details, so a
tool failure reads as the gateway's diagnosis rather than a generic throw.

Search falls back to a literal content search when semantic retrieval is
unavailable — a local gateway with no embedding model answers `search` with a
retrieval error and no entries, and that is a usable state, not a failure.

## Local agents

`local-agents.ts` registers one provider per agent. Every one runs on the
published ACP kit, `@get-bb/plugin-sdk/provider-bridge/acp`, which this plugin's
`bb.host` entry re-exports (`host.ts`). That is the whole point of the kit: a
plugin adds an ACP agent exactly the way `provider-acp` does, with no bb-side
code and no second bridge. Each provider's launch spec is a JSON setting, so
pointing an agent at another binary needs no code change.

## AI services

`ai-services.ts` registers four services for bb's helper tasks — thread titles
and commit messages: `ollama` (local), `openrouter`, `gemini`, and `deepseek`.
Each has its own display name, its own settings, and its own readiness answer,
so the picker in Settings → AI services lists them separately and a missing key
or model is reported per service rather than as one generic failure.

`chat-completions.ts` is the one engine behind the cloud three, and the one the
Ollama host handler uses: an OpenAI-compatible `/chat/completions` call and a
`/models` list. Gemini is reached through Google's OpenAI-compatible endpoint,
so there is no second request shape to keep correct.

bb aborts a title or commit-message request after five seconds, so the engine
caps every call just under that and the completion path never streams.

### Why Ollama goes through the host

bb's server is not necessarily on the machine holding the models. `ollama.ts`
declares the small host contract — `status`, `chat`, `start` — and `host.ts`
serves it on the machine daemon, so the model is reached where it actually
runs and the daemon's own cancellation signal bounds the call.

`start` is the only thing here that runs a process, and it is deliberately
narrow: it is reachable only from the explicit `bb local-stack ollama start`
command, it requires an absolute path from the plugin settings, it spawns with
`shell: false` and a sanitized environment, it returns early when something
already answers at the configured address, and nothing ever stops an Ollama
that bb did not start. `OLLAMA_HOST` is derived from the configured address so
the started server binds where the setting says.

## Layout

- `server.ts` — the plugin's runtime: settings, OpenViking surfaces, the
  `bb local-stack` CLI, and the calls into the other modules.
- `openviking.ts` — the gateway client and its response parsing.
- `chat-completions.ts` — the OpenAI-compatible completion and model-list calls.
- `ai-services.ts` — the four AI services and their settings.
- `ollama.ts` / `ollama-host.ts` — the Ollama host contract and its handlers.
- `local-agents.ts` — the provider declarations and their launch specs.
- `host.ts` — the `bb.host` entry: the ACP bridge plus the Ollama handlers.
- `skills/openviking-memory/` — the agent skill for the memory tools.

## Commands

```
bb local-stack openviking status|search|read|ls|remember|forget
bb local-stack models ollama|openrouter|gemini|deepseek
bb local-stack prompt <service> <text>
bb local-stack ollama start
```

`models` reads the service's own catalogue, so the model settings never need a
hard-coded id: Ollama lists what is installed, the others list what the API
publishes. `prompt` runs the same completion bb uses for titles and commit
messages, with a longer budget, so it answers whether a model is fast enough
before a title silently falls back to the start of the prompt.

## Forking

Listed in `scripts/forkable-plugins.json`: the plugin imports only
`@get-bb/plugin-sdk`, `zod`, and Node builtins, so a copy of this directory
installs, typechecks, tests, and builds outside the monorepo.
