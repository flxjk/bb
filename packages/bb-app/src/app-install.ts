import type { AppInstall } from "@bb/config/app-install";
import type { RunCommand } from "./app-update/run-command.js";

async function tryGit(args: {
  gitArgs: string[];
  repoRoot: string;
  runner: RunCommand;
}): Promise<string | null> {
  const result = await args.runner({
    args: args.gitArgs,
    command: "git",
    cwd: args.repoRoot,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return result.code === 0 ? result.stdout.trim() : null;
}

export async function resolveAppInstall(args: {
  desktop: boolean;
  runner: RunCommand;
  sourceRoot: string | null;
}): Promise<AppInstall> {
  if (args.desktop) return { kind: "desktop" };
  if (args.sourceRoot === null) return { kind: "npm" };
  const commit = await tryGit({
    gitArgs: ["rev-parse", "HEAD"],
    repoRoot: args.sourceRoot,
    runner: args.runner,
  });
  return { commit: commit === "" ? null : commit, kind: "source" };
}
