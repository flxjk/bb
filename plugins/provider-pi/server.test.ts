import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import piPlugin from "./server.js";

function registeredDeclaration() {
  const host = createFakePluginHost({ pluginId: "provider-pi" });
  piPlugin(host.bb);
  const declaration = host.harness.registrations.providerRegistrations.find(
    (entry) => entry.id === "pi",
  );
  if (declaration === undefined)
    throw new Error("expected pi to be registered");
  return declaration;
}

describe("the pi plugin's environment passthrough", () => {
  it("declares the bridge command override variables so a host-set value reaches the bridge", () => {
    expect(registeredDeclaration().env).toEqual({
      passthrough: ["BB_PI_BRIDGE_COMMAND", "BB_PI_BRIDGE_ARGS"],
    });
  });

  it("keeps the OpenAI Platform key secret and contributes it only when configured", async () => {
    const emptyHost = createFakePluginHost({ pluginId: "provider-pi" });
    piPlugin(emptyHost.bb);
    expect(
      emptyHost.harness.registrations.settingsDescriptors.openaiApiKey,
    ).toMatchObject({
      type: "string",
      secret: true,
      default: "",
    });
    await expect(
      emptyHost.harness.resolveProviderEnv("pi", {
        hostId: "host-1",
        projectId: null,
        threadId: null,
      }),
    ).resolves.toEqual([]);

    const configuredHost = createFakePluginHost({
      pluginId: "provider-pi",
      settings: { openaiApiKey: "platform-test-key" },
    });
    piPlugin(configuredHost.bb);
    await expect(
      configuredHost.harness.resolveProviderEnv("pi", {
        hostId: "host-1",
        projectId: null,
        threadId: null,
      }),
    ).resolves.toEqual([
      {
        name: "OPENAI_API_KEY",
        value: "platform-test-key",
        reason: "OpenAI Platform API key configured in Pi provider settings",
      },
    ]);
  });
});

describe("the pi plugin's skill roots", () => {
  it("declares pi's directories as recursive, walks ancestors for .agents/skills only, and resolves the rest per host", () => {
    const declaration = registeredDeclaration();
    expect(declaration.experimental_nativeSkillRoots).toMatchObject({
      user: [
        { path: ".pi/agent/skills", recursive: true },
        { path: ".agents/skills", recursive: true },
      ],
      project: [
        { path: ".pi/skills", recursive: true, ancestors: false },
        { path: ".agents/skills", recursive: true, ancestors: true },
      ],
    });
    expect(declaration.experimental_resolvesNativeRoots).toBe(true);
  });
});
