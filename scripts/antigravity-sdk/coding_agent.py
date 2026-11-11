"""Run an Antigravity agent that can edit files and run commands in a workspace.

Without --yolo every write and every shell command asks for approval in the
terminal, which is the safe default for a real repository.

    ./run.sh coding_agent.py --workspace ~/git/bb --prompt "List the top-level packages."
    ./run.sh coding_agent.py --workspace ~/git/bb --yolo --prompt "Add a README badge."
"""

from __future__ import annotations

import argparse
import asyncio
import os

from google.antigravity import Agent, LocalAgentConfig
from google.antigravity.hooks import policy
from google.antigravity.utils import interactive
from google.antigravity.utils.interactive import run_interactive_loop


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompt", default=None, help="One-shot prompt; omit for a chat loop.")
    parser.add_argument("--workspace", default=os.getcwd(), help="Directory the agent works in.")
    parser.add_argument("--model", default=None, help="Model id, for example gemini-3.8-flash.")
    parser.add_argument(
        "--yolo",
        action="store_true",
        help="Allow every tool without asking. Only for a throwaway workspace.",
    )
    return parser.parse_args()


def build_config(args: argparse.Namespace) -> LocalAgentConfig:
    policies = (
        [policy.allow_all()]
        if args.yolo
        else policy.safe_defaults(handler=interactive.ask_user_handler)
    )
    return LocalAgentConfig(
        workspaces=[os.path.abspath(args.workspace)],
        policies=policies,
        model=args.model,
        system_instructions=(
            "You are a coding agent working in the user's repository. Read before you "
            "write, keep changes minimal, and run the project's own checks."
        ),
    )


async def main() -> None:
    args = parse_args()
    config = build_config(args)
    if args.prompt is None:
        await run_interactive_loop(config)
        return
    async with Agent(config) as agent:
        response = await agent.chat(args.prompt)
        print(await response.text())


if __name__ == "__main__":
    asyncio.run(main())
