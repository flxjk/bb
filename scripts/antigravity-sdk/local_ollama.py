"""Run an Antigravity agent on a local OpenAI-compatible server, with no cloud call.

Ollama serves the OpenAI API at /v1, so the agent runs entirely on this machine.

    ./run.sh local_ollama.py --model qwen3.5:9b-mlx --prompt "Reply with exactly: PONG"
    ./run.sh local_ollama.py --list
"""

from __future__ import annotations

import argparse
import asyncio
import json
import urllib.request

from google.antigravity import Agent, LocalOpenAIAgentConfig

DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1"
DEFAULT_PROMPT = "Reply with exactly: PONG"


def list_models(base_url: str) -> list[str]:
    with urllib.request.urlopen(f"{base_url}/models", timeout=10) as response:
        payload = json.load(response)
    return [entry["id"] for entry in payload.get("data", [])]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompt", default=DEFAULT_PROMPT, help="Prompt for the agent.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="OpenAI-compatible base URL.")
    parser.add_argument("--model", default=None, help="Model tag, for example qwen3.5:9b-mlx.")
    parser.add_argument("--workspace", default=None, help="Directory the agent may read and write.")
    parser.add_argument("--list", action="store_true", help="Print the models the server offers.")
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    if args.list:
        for model in list_models(args.base_url):
            print(model)
        return
    if args.model is None:
        raise SystemExit("--model is required; run with --list to see what the server offers.")
    config = LocalOpenAIAgentConfig(
        base_url=args.base_url,
        model=args.model,
        workspaces=[args.workspace] if args.workspace else None,
    )
    async with Agent(config) as agent:
        response = await agent.chat(args.prompt)
        print(await response.text())


if __name__ == "__main__":
    asyncio.run(main())
