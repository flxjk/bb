import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

const baseUrlSchema = z.string().min(1);

export const ollamaHostContract = defineRpcContract({
  status: {
    input: z.object({ baseUrl: baseUrlSchema }).strict(),
    output: z
      .object({
        reachable: z.boolean(),
        models: z.array(z.string()),
      })
      .strict(),
  },
  chat: {
    input: z
      .object({
        baseUrl: baseUrlSchema,
        model: z.string().min(1),
        prompt: z.string().min(1),
        timeoutMs: z.number().int().min(1).max(60_000),
      })
      .strict(),
    output: z.object({ text: z.string() }).strict(),
  },
  start: {
    input: z
      .object({
        executable: z.string().min(1),
        baseUrl: baseUrlSchema,
      })
      .strict(),
    output: z.object({ started: z.boolean(), detail: z.string() }).strict(),
  },
});

export type OllamaHostContract = typeof ollamaHostContract;
