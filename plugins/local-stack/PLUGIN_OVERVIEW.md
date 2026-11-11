One plugin for a bb that runs on your own machine: memory in OpenViking, threads on
local agents, and helper tasks on the model you choose — local or cloud, each provider
configured separately.

## OpenViking memory

OpenViking is a local context database for agents. It stores durable knowledge as a
`viking://` filesystem, so memories, resources, and skills live in one place you can
search, read, and curate.

- `openviking_search` finds memories, resources, and skills by meaning, falling back to
  a literal search when the gateway has no embedding model configured.
- `openviking_read` opens one file in full, or its generated abstract or overview.
- `openviking_ls` lists a directory.
- `openviking_remember` writes a verified fact back under
  `viking://user/default/memories`.
- `openviking_forget` removes one file the user asked you to forget.
- `openviking_status` reports whether the gateway is reachable and initialized.

The plugin polls the gateway every 30 seconds and adds a short standing instruction to
threads only while it answers.

## Threads on local agents

Four agents are registered as bb providers, each over the Agent Client Protocol on the
machine that runs it:

- **Reasonix** — `reasonix acp`.
- **Gemini** — the Gemini CLI's ACP mode; point the launch spec at `npx` if you would
  rather not install it globally.
- **Antigravity** — `agy acp --disable-telemetry`, the ACP server in Google's Antigravity
  CLI, which is where the Gemini CLI's own free tier now points. Sign in once with
  `agy acp --login`.
- **DeepSeek Harness** — the harness `acp` profile.

Each launch command is its own JSON launch spec in the plugin settings, validated as it
is written. A provider is listed only where its command is installed.

## Helper tasks on four separate AI services

Thread titles and commit messages can run on any of these, chosen per task in
Settings → AI services:

- **Ollama (local)** — answers from the models you have pulled, reached through the
  machine daemon, so the model runs where the daemon does. The settings name the
  address, the model, and — only for the explicit `ollama start` command — an absolute
  path to the binary. bb never starts Ollama on its own, and never stops one it did not
  start.
- **OpenRouter**, **Google Gemini**, **DeepSeek** — each with its own API key and model.

`bb local-stack models <service>` prints the model ids a service actually offers, so you
never have to guess an id. Ollama's list is what is installed locally; the others come
from the provider's own catalogue.

## Commands

```
bb local-stack openviking status|search|read|ls|remember|forget
bb local-stack models ollama|openrouter|gemini|deepseek
bb local-stack prompt <service> <text>
bb local-stack ollama start
```
