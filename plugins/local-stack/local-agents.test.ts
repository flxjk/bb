import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { installLocalAgents } from "./local-agents.js";

const REASONIX_DEFAULT = JSON.stringify({ command: "reasonix", args: ["acp"] });

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function launchSpecOf(declaration: {
  experimental_bridgeOptions?: Readonly<Record<string, unknown>>;
}): unknown {
  return declaration.experimental_bridgeOptions?.["acpLaunchSpec"];
}

async function loadLocalAgents(options: {
  settings?: Record<string, string>;
}): Promise<Awaited<ReturnType<typeof createFakePluginHost>>> {
  const host = createFakePluginHost({
    pluginId: "bb--local-stack",
    experimental_declaredIconNames: ["antigravity"],
    ...(options.settings === undefined ? {} : { settings: options.settings }),
  });
  await installLocalAgents(host.bb);
  return host;
}

describe("installLocalAgents", () => {
  it("registers one provider per local agent, grouped as a family", async () => {
    const host = await loadLocalAgents({});
    const declarations =
      host.harness.inspection.registrations.providerRegistrations;

    expect(declarations.map((declaration) => declaration.id)).toEqual([
      "reasonix",
      "gemini",
      "antigravity",
      "deepseek-harness",
    ]);
    expect(declarations.map((declaration) => declaration.family)).toEqual([
      "local",
      "local",
      "local",
      "local",
    ]);
    expect(launchSpecOf(declarations[0]!)).toEqual({
      displayName: "Reasonix",
      command: "reasonix",
      args: ["acp"],
      env: {},
    });
    expect(launchSpecOf(declarations[1]!)).toEqual({
      displayName: "Gemini",
      command: "gemini",
      args: ["--acp"],
      env: {},
    });
    expect(launchSpecOf(declarations[2]!)).toEqual({
      displayName: "Antigravity",
      command: "agy",
      args: ["acp", "--disable-telemetry"],
      env: {},
    });
    expect(declarations[2]!.icon).toBe("bb--local-stack/antigravity");
    expect(launchSpecOf(declarations[3]!)).toMatchObject({
      displayName: "DeepSeek Harness",
      command: "node",
      args: expect.arrayContaining(["--profile", "acp"]),
    });
  });

  it("lists a provider only where its command is installed, and health-checks it", async () => {
    const host = await loadLocalAgents({});

    for (const declaration of host.harness.inspection.registrations
      .providerRegistrations) {
      expect(declaration.experimental_visibility).toBe("installed");
      expect(declaration.maintenance).toEqual({
        health: true,
        usage: false,
        installation: false,
      });
      expect(declaration.models).toEqual({ scope: "host" });
    }
  });

  it("re-registers one provider from an edited launch spec, leaving the other alone", async () => {
    const host = await loadLocalAgents({});
    const registeredBefore =
      host.harness.inspection.registrations.providerRegistrations;
    const harnessBefore = registeredBefore.find(
      (declaration) => declaration.id === "deepseek-harness",
    );
    const reasonixBefore = registeredBefore.find(
      (declaration) => declaration.id === "reasonix",
    );

    await host.harness.behavior.setSettings({
      reasonixLaunch: JSON.stringify({
        command: "/opt/reasonix",
        args: ["acp", "--profile", "delivery"],
      }),
    });
    await flush();

    const after = host.harness.inspection.registrations.providerRegistrations;
    const reasonix = after.find((declaration) => declaration.id === "reasonix");
    expect(launchSpecOf(reasonix!)).toMatchObject({
      command: "/opt/reasonix",
      args: ["acp", "--profile", "delivery"],
    });
    expect(reasonix).not.toEqual(reasonixBefore);
    expect(
      after.find((declaration) => declaration.id === "deepseek-harness"),
    ).toEqual(harnessBefore);
  });

  it("validates the launch spec at the settings boundary", async () => {
    const host = await loadLocalAgents({});
    const schema =
      host.harness.inspection.registrations.settingsDescriptors[
        "reasonixLaunch"
      ]?.experimental_schema;
    if (schema === undefined) throw new Error("reasonixLaunch has no schema");

    expect(
      (await schema["~standard"].validate(REASONIX_DEFAULT)).issues,
    ).toBeUndefined();
    expect((await schema["~standard"].validate("")).issues).toBeUndefined();

    const malformed = await schema["~standard"].validate("{not json");
    expect(malformed.issues?.[0]?.message).toBe(
      "Launch spec must be valid JSON.",
    );

    const unknownField = await schema["~standard"].validate(
      JSON.stringify({ command: "reasonix", args: ["acp"], shell: true }),
    );
    expect(unknownField.issues?.[0]?.message).toContain("shell");

    await expect(
      host.harness.behavior.setSettings({ reasonixLaunch: "{not json" }),
    ).rejects.toThrow(/valid JSON/u);
  });

  it("drops a provider whose stored launch spec cannot be used, and says so", async () => {
    const host = await loadLocalAgents({
      settings: { reasonixLaunch: '{"command":""}' },
    });

    expect(
      host.harness.inspection.registrations.providerRegistrations.map(
        (declaration) => declaration.id,
      ),
    ).toEqual(["gemini", "antigravity", "deepseek-harness"]);
    expect(
      host.harness.inspection.logEntries.some(
        (entry) =>
          entry.level === "error" && entry.message.startsWith("Reasonix"),
      ),
    ).toBe(true);
  });
});
