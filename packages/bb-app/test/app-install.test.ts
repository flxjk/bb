import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resolveAppInstall } from "../src/app-install.js";
import { runCommand } from "../src/app-update/run-command.js";
import {
  createGitCheckout,
  git,
  type GitCheckoutFixture,
} from "./app-update-git-fixture.js";

const fixtures: GitCheckoutFixture[] = [];
const tempDirs: string[] = [];
let template: GitCheckoutFixture;

beforeAll(async () => {
  template = await createGitCheckout();
});

afterAll(() => {
  template?.cleanup();
});

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, {
      force: true,
      recursive: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});

describe("app install resolution", { timeout: 30_000 }, () => {
  it("reports the kind of desktop, npm, and source installs", async () => {
    const fixture = await createGitCheckout(template);
    fixtures.push(fixture);

    expect(
      await resolveAppInstall({
        desktop: true,
        runner: runCommand,
        sourceRoot: fixture.checkout,
      }),
    ).toEqual({ kind: "desktop" });
    expect(
      await resolveAppInstall({
        desktop: false,
        runner: runCommand,
        sourceRoot: null,
      }),
    ).toEqual({ kind: "npm" });
    expect(
      await resolveAppInstall({
        desktop: false,
        runner: runCommand,
        sourceRoot: fixture.checkout,
      }),
    ).toEqual({
      commit: await git(fixture.checkout, "rev-parse", "HEAD"),
      kind: "source",
    });
  });

  it("reports no commit for a source checkout without git metadata", async () => {
    const notGit = mkdtempSync(join(tmpdir(), "bb-app-install-"));
    tempDirs.push(notGit);

    expect(
      await resolveAppInstall({
        desktop: false,
        runner: runCommand,
        sourceRoot: notGit,
      }),
    ).toEqual({ commit: null, kind: "source" });
  });
});
