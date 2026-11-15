import type { DeltaPresentation } from "@get-bb/plugin-sdk/provider-bridge";
import {
  experimental_presentationDetail as presentationDetail,
  experimental_presentationTitle as presentationTitle,
  experimental_withTitle as withTitle,
} from "@get-bb/plugin-sdk/provider-bridge";

export const GEMINI_PROVIDER_ID = "gemini-bridge";
export const GEMINI_PROVIDER_DISPLAY_NAME = "Gemini (API bridge)";

export const GEMINI_API_KEY_ENV = "GEMINI_BRIDGE_API_KEY";
export const GEMINI_MODEL_ENV = "GEMINI_BRIDGE_MODEL";
export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";

export const GEMINI_API_VERSION = "v1beta";
export const GEMINI_SESSION_FILE = "sessions.json";
export const GEMINI_MAX_TOOL_ROUNDS = 24;
export const GEMINI_MAX_HISTORY_CONTENTS = 400;

export const GEMINI_REASONING_LEVELS = [
  "none",
  "low",
  "medium",
  "high",
  "max",
] as const;

export type GeminiReasoningLevel = (typeof GEMINI_REASONING_LEVELS)[number];

const REASONING_BUDGETS: Record<GeminiReasoningLevel, number> = {
  none: 0,
  low: 2048,
  medium: 8192,
  high: 24576,
  max: -1,
};

export function geminiThinkingBudget(level: string | undefined): number | null {
  if (level === undefined) return null;
  return Object.hasOwn(REASONING_BUDGETS, level)
    ? REASONING_BUDGETS[level as GeminiReasoningLevel]
    : null;
}

const TOOL_NAME_PATTERN = /[^a-zA-Z0-9_.:-]/gu;

export function geminiFunctionName(tool: string): string {
  const cleaned = tool.replace(TOOL_NAME_PATTERN, "_");
  return /^[a-zA-Z_]/u.test(cleaned) ? cleaned : `bb_${cleaned}`;
}

export function geminiFunctionPresentation(
  tool: string,
  args: Record<string, unknown>,
): DeltaPresentation {
  return withTitle(
    {
      label: { pending: `Running ${tool}`, completed: `Ran ${tool}` },
      icon: { glyph: "Toolbox" },
    },
    presentationTitle(summarizeArguments(args)),
  );
}

export function summarizeArguments(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  return presentationDetail(
    entries.map(([key, value]) => `${key}=${describeValue(value)}`).join(" "),
  );
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return String(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

const MODEL_DISPLAY_OVERRIDES: Record<string, string> = {
  "gemini-4-carbon": "Gemini 4 Carbon",
  "gemini-4-argon": "Gemini 4 Argon",
  "gemini-pro-latest": "Gemini Pro (latest)",
  "gemini-3.8-flash": "Gemini 3.8 Flash",
  "gemini-3.1-flash-lite": "Gemini 3.1 Flash Lite",
  "gemini-flash-latest": "Gemini Flash (latest)",
  "gemini-flash-lite-latest": "Gemini Flash Lite (latest)",
};

const NON_CHAT_MODEL_PATTERN =
  /(?:^|[-_])(?:embedding|aqa|tts|transcribe|live|native-audio|lyria|robotics|computer-use|deep-research)(?:$|[-_])/u;

const IMAGE_OUTPUT_MODEL_PATTERN = /(?:^|[-_])(?:image|nano-banana)(?:$|[-_])/u;

const PREFERRED_MODEL_ORDER = [
  "gemini-4-carbon",
  "gemini-4-argon",
  "gemini-pro-latest",
  "gemini-3.8-flash",
  "gemini-3.1-flash-lite",
];

export interface GeminiModelSummary {
  id: string;
  displayName: string;
  description: string;
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
}

export function isChatCapableModel(args: {
  id: string;
  methods: readonly string[];
}): boolean {
  if (!args.methods.includes("generateContent")) return false;
  return !NON_CHAT_MODEL_PATTERN.test(args.id);
}

export function isImageOutputModel(id: string): boolean {
  return IMAGE_OUTPUT_MODEL_PATTERN.test(id);
}

export function geminiModelDisplayName(id: string): string {
  const override = MODEL_DISPLAY_OVERRIDES[id];
  if (override !== undefined) return override;
  return id
    .split("-")
    .map((segment) =>
      segment.length === 0
        ? segment
        : `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`,
    )
    .join(" ");
}

export function orderGeminiModels(
  models: readonly GeminiModelSummary[],
): GeminiModelSummary[] {
  const rank = new Map(
    PREFERRED_MODEL_ORDER.map((id, index) => [id, index] as const),
  );
  return [...models].sort((left, right) => {
    const leftRank = rank.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.id.localeCompare(right.id);
  });
}
