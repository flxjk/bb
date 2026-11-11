"""Ask one Antigravity agent a single question and print the answer.

    ./run.sh hello.py --prompt "What files are in the current directory?"
    ./run.sh hello.py --prompt "Explain the repo layout." --stream
"""

from __future__ import annotations

import argparse
import asyncio

from google.antigravity import Agent, LocalAgentConfig

DEFAULT_PROMPT = "Reply with exactly: PONG"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompt", default=DEFAULT_PROMPT, help="Prompt for the agent.")
    parser.add_argument("--model", default=None, help="Model id, for example gemini-3.8-flash.")
    parser.add_argument("--workspace", default=None, help="Directory the agent may read and write.")
    parser.add_argument("--instructions", default=None, help="System instructions for this run.")
    parser.add_argument("--stream", action="store_true", help="Print tokens as they arrive.")
    return parser.parse_args()


def build_config(args: argparse.Namespace) -> LocalAgentConfig:
    return LocalAgentConfig(
        **{
            "system_instructions": args.instructions,
            "model": args.model,
            "workspaces": [args.workspace] if args.workspace else None,
        }
    )


async def main() -> None:
    args = parse_args()
    async with Agent(build_config(args)) as agent:
        response = await agent.chat(args.prompt)
        if args.stream:
            async for chunk in response:
                print(chunk, end="", flush=True)
            print()
        else:
            print(await response.text())
        usage = response.usage_metadata
        if usage is not None:
            print(f"[tokens: prompt={usage.prompt_token_count} total={usage.total_token_count}]")


if __name__ == "__main__":
    asyncio.run(main())
