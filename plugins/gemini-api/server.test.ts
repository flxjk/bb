import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import geminiApiPlugin, { describeGeminiError } from "./server.js";

async function registeredService(settings: Record<string, string> = {}) {
  const host = createFakePluginHost({ pluginId: "gemini-api", settings });
  await geminiApiPlugin(host.bb);
  const service = host.harness.registrations.aiServiceRegistrations.find(
    (entry) => entry.id === "gemini-api",
  );
  if (service === undefined) throw new Error("expected gemini-api to register");
  return service;
}

describe("the Gemini API service", () => {
  it("registers one completion service named Gemini (API)", async () => {
    const service = await registeredService();
    expect(service.displayName).toBe("Gemini (API)");
    expect(typeof service.complete).toBe("function");
    expect(typeof service.status).toBe("function");
    expect(service.transcribe).toBeUndefined();
  });

  it("keeps the API key secret and defaults the model", async () => {
    const host = createFakePluginHost({ pluginId: "gemini-api" });
    await geminiApiPlugin(host.bb);
    expect(host.harness.registrations.settingsDescriptors.apiKey).toMatchObject(
      {
        type: "string",
        secret: true,
        default: "",
      },
    );
    expect(host.harness.registrations.settingsDescriptors.model).toMatchObject({
      type: "string",
      default: "gemini-3.1-flash-lite",
    });
  });

  it("asks for the key before it will answer", async () => {
    const service = await registeredService();
    await expect(service.status?.()).resolves.toEqual({
      ready: false,
      message: "Set the Gemini API key in this plugin's settings.",
    });
  });

  it("asks for a model once the key is set and the model is blank", async () => {
    const service = await registeredService({ apiKey: "test-key", model: "" });
    await expect(service.status?.()).resolves.toEqual({
      ready: false,
      message: "Set the Gemini model in this plugin's settings.",
    });
  });

  it("is ready on the default model once the key is set", async () => {
    const service = await registeredService({ apiKey: "test-key" });
    await expect(service.status?.()).resolves.toEqual({ ready: true });
  });

  it("refuses to call Gemini without a key", async () => {
    const service = await registeredService();
    await expect(
      service.complete?.("Reply with exactly: PONG", {
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("Set the Gemini API key in this plugin's settings.");
  });

  it("names the five second abort when bb stops waiting", async () => {
    const controller = new AbortController();
    controller.abort();
    const service = await registeredService({
      apiKey: "test-key",
      model: "gemini-4-carbon",
    });
    await expect(
      service.complete?.("Reply with exactly: PONG", {
        signal: controller.signal,
      }),
    ).rejects.toThrow(
      "Gemini gemini-4-carbon did not answer within five seconds.",
    );
  });
});

describe("describing a Gemini failure", () => {
  it("carries the HTTP status the SDK attached", () => {
    const error = Object.assign(new Error("API key not valid"), {
      status: 400,
    });
    expect(describeGeminiError(error)).toBe("HTTP 400: API key not valid");
  });

  it("unwraps the cause chain a transport failure arrives in", () => {
    const inner = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    const outer = Object.assign(new Error("request failed"), {
      cause: inner,
    });
    expect(describeGeminiError(outer)).toBe(
      "request failed (cause: ECONNRESET: socket hang up)",
    );
  });

  it("falls back to the value itself when it is not an Error", () => {
    expect(describeGeminiError("overloaded")).toBe("overloaded");
  });
});
