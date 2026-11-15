import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  experimental_captureBridgeJsonRpcOutput as captureBridgeJsonRpcOutput,
  experimental_formatConformanceReport as formatConformanceReport,
  experimental_runBridgeConformance as runBridgeConformance,
  type CapturedBridgeJsonRpcOutput,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import { afterEach, beforeEach, expect, it } from "vitest";
import { experimental_providerBridge } from "./src/provider-bridge.js";

let output: CapturedBridgeJsonRpcOutput;
let dataDir: string;
let workspaceDir: string;

beforeEach(() => {
  if (
    (process.env.GEMINI_BRIDGE_API_KEY ?? "").trim().length === 0 &&
    (process.env.GEMINI_API_KEY ?? "").trim().length > 0
  ) {
    process.env.GEMINI_BRIDGE_API_KEY = process.env.GEMINI_API_KEY;
  }
  dataDir = mkdtempSync(join(tmpdir(), "bb-gemini-bridge-data-"));
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-gemini-bridge-work-"));
  output = captureBridgeJsonRpcOutput();
  experimental_providerBridge.start?.({
    pluginId: "gemini-bridge-test",
    dataDir,
    tempDir: dataDir,
  });
});

afterEach(() => {
  output.restore();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(workspaceDir, { recursive: true, force: true });
});

const apiKey = (
  process.env.GEMINI_BRIDGE_API_KEY ??
  process.env.GEMINI_API_KEY ??
  ""
).trim();
it.skipIf(apiKey.length === 0)(
  "passes the canonical protocol suite",
  async () => {
    const report = await runBridgeConformance({
      transport: {
        send: experimental_providerBridge.handleLine,
        takeMessages: output.takeMessages,
      },
      providerId: "gemini-bridge",
      session: {
        cwd: workspaceDir,
        promptInput: [
          { type: "text", text: "Say hello in one short line.", mentions: [] },
        ],
        zeroWorkPromptInput: [
          {
            type: "text",
            text: "Reply with the single word: ok",
            mentions: [],
          },
        ],
        options: {
          permissionMode: "full",
          permissionScope: "full",
          approvalReviewer: null,
          permissionEscalation: null,
        },
      },
      timeoutMs: 120_000,
    });

    output.restore();
    console.info(
      `gemini bridge conformance:\n${formatConformanceReport(report)}`,
    );

    const statusById = Object.fromEntries(
      report.results.map((result) => [result.id, result.status]),
    );
    expect(statusById).toEqual({
      "rpc/unknown-method": "pass",
      "rpc/invalid-params": "pass",
      "rpc/non-json-ignored": "pass",
      "rpc/response-not-request": "pass",
      "handshake/initialize": "pass",
      "session/start-identity": "pass",
      "session/start-identity-announced": "pass",
      "turn/lifecycle": "pass",
      "events/schema-valid": "pass",
      "item/opens-before-delta": "pass",
      "stop/release-not-interrupted": "pass",
      "session/resume-identity": "pass",
      "session/resume-id-uniqueness": "pass",
      "skills/configure-declared": "pass",
      "commands/list-declared": "pass",
      "recovery/session-archived": "pass",
      "turn/settles-without-activity": "pass",
    });
    expect(report.passed).toBe(true);
  },
  300_000,
);
