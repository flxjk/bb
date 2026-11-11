import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  AI_SERVICE_IDS,
  installAiServices,
  isAiServiceId,
} from "./ai-services.js";

async function loadAiServices(settings: Record<string, string> = {}) {
  const host = createFakePluginHost({
    pluginId: "bb--local-stack",
    settings,
  });
  const commands = await installAiServices(host.bb);
  return { host, commands };
}

function serviceOf(
  host: Awaited<ReturnType<typeof loadAiServices>>["host"],
  id: string,
) {
  const service =
    host.harness.inspection.registrations.aiServiceRegistrations.find(
      (candidate) => candidate.id === id,
    );
  if (service === undefined) throw new Error(`no AI service ${id}`);
  return service;
}

describe("isAiServiceId", () => {
  it("accepts the four services and nothing else", () => {
    for (const id of AI_SERVICE_IDS) expect(isAiServiceId(id)).toBe(true);
    expect(isAiServiceId("openai")).toBe(false);
    expect(isAiServiceId("")).toBe(false);
  });
});

describe("installAiServices", () => {
  it("registers one service per provider, each with its own display name", async () => {
    const { host } = await loadAiServices();
    const services =
      host.harness.inspection.registrations.aiServiceRegistrations;

    expect(services.map((service) => service.id)).toEqual([
      "ollama",
      "openrouter",
      "gemini",
      "deepseek",
    ]);
    expect(services.map((service) => service.displayName)).toEqual([
      "Ollama (local)",
      "OpenRouter",
      "Google Gemini",
      "DeepSeek",
    ]);
  });

  it("declares the settings each service needs, with the keys secret", async () => {
    const { host } = await loadAiServices();
    const descriptors =
      host.harness.inspection.registrations.settingsDescriptors;

    expect(Object.keys(descriptors).sort()).toEqual([
      "deepseekApiKey",
      "deepseekModel",
      "geminiApiKey",
      "geminiModel",
      "ollamaBaseUrl",
      "ollamaExecutable",
      "ollamaModel",
      "openrouterApiKey",
      "openrouterModel",
    ]);
    for (const key of ["openrouterApiKey", "geminiApiKey", "deepseekApiKey"]) {
      const descriptor = descriptors[key];
      expect(descriptor?.type).toBe("string");
      expect(
        descriptor?.type === "string" ? descriptor.secret : undefined,
      ).toBe(true);
    }
    expect(descriptors["ollamaBaseUrl"]?.default).toBe(
      "http://127.0.0.1:11434",
    );
  });

  it("asks for a model before it asks for a key", async () => {
    const { host } = await loadAiServices();

    for (const id of ["openrouter", "gemini", "deepseek"]) {
      const status = await serviceOf(host, id).status?.();
      expect(status?.ready).toBe(false);
      expect(status).toMatchObject({
        message: expect.stringContaining("model"),
      });
    }
  });

  it("asks for a key once a model is set", async () => {
    const { host } = await loadAiServices({
      openrouterModel: "some/model",
      geminiModel: "some-model",
      deepseekModel: "deepseek-chat",
    });

    for (const id of ["openrouter", "gemini", "deepseek"]) {
      const status = await serviceOf(host, id).status?.();
      expect(status?.ready).toBe(false);
      expect(status).toMatchObject({
        message: expect.stringContaining("API key"),
      });
    }
  });

  it("is ready once a cloud service has both a model and a key", async () => {
    const { host } = await loadAiServices({
      openrouterModel: "some/model",
      openrouterApiKey: "sk-test",
      geminiModel: "some-model",
      geminiApiKey: "sk-test",
      deepseekModel: "deepseek-chat",
      deepseekApiKey: "sk-test",
    });

    for (const id of ["openrouter", "gemini", "deepseek"]) {
      expect(await serviceOf(host, id).status?.()).toEqual({ ready: true });
    }
  });

  it("refuses to complete on a cloud service with no model configured", async () => {
    const { host } = await loadAiServices({ deepseekApiKey: "sk-test" });

    await expect(
      serviceOf(host, "deepseek").complete?.("hi", {
        signal: AbortSignal.timeout(1_000),
      }),
    ).rejects.toThrow(/No DeepSeek model is configured/u);
  });

  it("asks for an Ollama model before it looks for a machine", async () => {
    const { host } = await loadAiServices();

    const status = await serviceOf(host, "ollama").status?.();
    expect(status).toMatchObject({
      ready: false,
      message: expect.stringContaining("Ollama model"),
    });
    await expect(
      serviceOf(host, "ollama").complete?.("hi", {
        signal: AbortSignal.timeout(1_000),
      }),
    ).rejects.toThrow(/No Ollama model is configured/u);
  });

  it("refuses to start Ollama until an executable is named", async () => {
    const { commands } = await loadAiServices();

    await expect(commands.startOllama()).rejects.toThrow(/executable path/u);
  });
});
