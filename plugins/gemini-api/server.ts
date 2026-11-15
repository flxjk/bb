import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import type { BbPluginApi, PluginAiServiceStatus } from "@get-bb/plugin-sdk";

const DEFAULT_MODEL = "gemini-3.1-flash-lite";

export default async function geminiApiPlugin(bb: BbPluginApi): Promise<void> {
  const settings = bb.settings.define({
    apiKey: {
      type: "string",
      label: "Gemini API key",
      description:
        "An AI Studio key, passed to the official @google/genai client.",
      secret: true,
      default: "",
    },
    model: {
      type: "string",
      label: "Gemini model",
      description:
        "The model id to answer with, for example gemini-3.1-flash-lite, gemini-3.8-flash or gemini-4-carbon. Titles and commit messages abort after five seconds, so a fast model keeps them working.",
      default: DEFAULT_MODEL,
    },
  });

  let values = await settings.get();
  settings.onChange((next) => {
    values = next;
  });

  function readiness(): PluginAiServiceStatus {
    if (values.apiKey.trim().length === 0) {
      return {
        ready: false,
        message: "Set the Gemini API key in this plugin's settings.",
      };
    }
    if (values.model.trim().length === 0) {
      return {
        ready: false,
        message: "Set the Gemini model in this plugin's settings.",
      };
    }
    return { ready: true };
  }

  async function complete(
    prompt: string,
    options: { signal: AbortSignal },
  ): Promise<string> {
    const apiKey = values.apiKey.trim();
    if (apiKey.length === 0) {
      throw new Error("Set the Gemini API key in this plugin's settings.");
    }
    const model =
      values.model.trim().length > 0 ? values.model.trim() : DEFAULT_MODEL;
    const client = new GoogleGenAI({ apiKey });
    let response: GenerateContentResponse;
    try {
      response = await client.models.generateContent({
        model,
        contents: prompt,
        config: { abortSignal: options.signal },
      });
    } catch (error) {
      if (options.signal.aborted) {
        throw new Error(`Gemini ${model} did not answer within five seconds.`);
      }
      throw new Error(`Gemini ${model} failed: ${describeGeminiError(error)}`);
    }
    const text = response.text?.trim() ?? "";
    if (text.length === 0) {
      throw new Error(`Gemini ${model} answered without text.`);
    }
    return text;
  }

  bb.experimental_aiServices.register({
    id: "gemini-api",
    displayName: "Gemini (API)",
    complete,
    status: () => Promise.resolve(readiness()),
  });

  bb.log.info(`Gemini API service loaded with model ${values.model}`);
}

export function describeGeminiError(error: unknown): string {
  if (error instanceof Error) {
    const status = (error as { status?: unknown }).status;
    const cause = (error as { cause?: unknown }).cause;
    const suffix = cause === undefined ? "" : ` (cause: ${causeText(cause)})`;
    return typeof status === "number"
      ? `HTTP ${status}: ${error.message}${suffix}`
      : `${error.message}${suffix}`;
  }
  return String(error);
}

function causeText(cause: unknown): string {
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    const nested = (cause as { cause?: unknown }).cause;
    const head =
      typeof code === "string" ? `${code}: ${cause.message}` : cause.message;
    return nested === undefined || nested === cause
      ? head
      : `${head} <- ${causeText(nested)}`;
  }
  return String(cause);
}
