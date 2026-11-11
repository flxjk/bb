# Antigravity SDK scripts

Runnable scripts for the [Google Antigravity SDK](https://antigravity.google/docs/sdk/overview/),
the Python SDK that runs an Antigravity agent locally: it discovers the `agy`
binary, executes tools, applies policies, and talks to Gemini or to a local
OpenAI-compatible server.

## Setup

```bash
./setup.sh
```

`setup.sh` creates `.venv` with `uv` and installs `google-antigravity` into it.
`run.sh` runs a script with that interpreter and, when `GEMINI_API_KEY` is unset,
takes it from `~/.zshrc` so the key never has to be copied into this directory.

## Scripts

| Script                 | What it does                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `hello.py`             | One question, one answer. `--stream` prints tokens as they arrive.                                         |
| `openviking_memory.py` | Attaches the OpenViking MCP server (`http://127.0.0.1:1933/mcp`) so the agent can search and write memory. |
| `local_ollama.py`      | Runs the agent on a local OpenAI-compatible server (Ollama at `http://127.0.0.1:11434/v1`), no cloud call. |
| `coding_agent.py`      | Works in a workspace with file and shell tools; asks for approval unless `--yolo`.                         |

```bash
./run.sh hello.py --prompt "Reply with exactly: PONG"
./run.sh hello.py --prompt "Explain the repo layout." --stream
./run.sh openviking_memory.py --prompt "What do we know about antigravity?"
./run.sh local_ollama.py --list
./run.sh local_ollama.py --model qwen3.5:9b-mlx --prompt "Reply with exactly: PONG"
./run.sh coding_agent.py --workspace ~/git/bb --prompt "List the top-level packages."
./run.sh coding_agent.py --workspace ~/git/bb
```

## Models

`LocalAgentConfig(model=...)` takes a model id. The ids the installed CLI offers
come from `agy models`; the same list is what bb shows for the Antigravity
provider, because bb reads it over ACP. Gemini 4 Carbon and Argon are gated by
plan and by Application Default Credentials sign-in, so they appear only when
`agy` itself offers them.

## Policies

`coding_agent.py` uses `policy.safe_defaults`, which allows read-only tools and
asks before writes and shell commands. `--yolo` swaps in `policy.allow_all()`.
`openviking_memory.py` allows the OpenViking MCP server and read-only file tools
and denies everything else unless `--yolo` is passed.
