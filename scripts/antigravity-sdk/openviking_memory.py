"""Run an Antigravity agent with the OpenViking memory server attached.

The agent reaches OpenViking over MCP, so it can search, read, write, and
forget memories while it answers. The gateway is the local one.

    ./run.sh openviking_memory.py --prompt "What do we know about antigravity?"
    ./run.sh openviking_memory.py --prompt "Remember that the SDK is installed." --yolo
"""

from __future__ import annotations

import argparse
import asyncio

from google.antigravity import Agent, LocalAgentConfig
from google.antigravity.hooks import policy
from google.antigravity.types import McpStreamableHttpServer

DEFAULT_GATEWAY = "http://127.0.0.1:1933/mcp"
DEFAULT_PROMPT = (
    "Use the openviking tools to search memory for anything about Antigravity, "
    "then answer in one line with what you found and the tool names you called."
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompt", default=DEFAULT_PROMPT, help="Prompt for the agent.")
    parser.add_argument("--gateway", default=DEFAULT_GATEWAY, help="OpenViking MCP URL.")
    parser.add_argument("--model", default=None, help="Model id, for example gemini-3.8-flash.")
    parser.add_argument(
        "--yolo",
        action="store_true",
        help="Allow every tool without asking. Without it, tool calls need approval.",
    )
    return parser.parse_args()


def build_config(args: argparse.Namespace) -> LocalAgentConfig:
    openviking = McpStreamableHttpServer(name="openviking", url=args.gateway)
    policies = (
        [policy.allow_all()]
        if args.yolo
        else [
            policy.allow("view_file"),
            policy.allow("list_directory"),
            policy.allow(openviking),
            policy.deny("*"),
        ]
    )
    return LocalAgentConfig(
        mcp_servers=[openviking],
        policies=policies,
        model=args.model,
        system_instructions=(
            "You are a memory assistant. OpenViking holds the user's durable context: "
            "search it before answering questions about past work, and write back only "
            "facts the user confirmed."
        ),
    )


async def main() -> None:
    args = parse_args()
    async with Agent(build_config(args)) as agent:
        response = await agent.chat(args.prompt)
        print(await response.text())


if __name__ == "__main__":
    asyncio.run(main())
