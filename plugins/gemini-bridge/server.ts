import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  GEMINI_API_KEY_ENV,
  GEMINI_DEFAULT_MODEL,
  GEMINI_MODEL_ENV,
  GEMINI_PROVIDER_DISPLAY_NAME,
  GEMINI_PROVIDER_ID,
  GEMINI_REASONING_LEVELS,
} from "./src/vocabulary.js";

const GEMINI_FALLBACK_MODELS = [
  "gemini-4-carbon",
  "gemini-4-argon",
  "gemini-pro-latest",
  "gemini-3.8-flash",
  "gemini-3.1-flash-lite",
] as const;

export default function geminiBridgePlugin(bb: BbPluginApi): void {
  const settings = bb.settings.define({
    apiKey: {
      type: "string",
      label: "Gemini API key",
      description:
        "An AI Studio key. It is stored as a plugin secret and handed to the bridge as an environment value on each thread command; it is never written into the plugin bundle.",
      secret: true,
      default: "",
    },
    model: {
      type: "string",
      label: "Default Gemini model",
      description:
        "The model a new thread starts on when the picker has no choice yet, for example gemini-3.8-flash. The model list comes from the live Gemini API.",
      default: GEMINI_DEFAULT_MODEL,
    },
    reasoningLevel: {
      type: "select",
      label: "Default reasoning level",
      description:
        "Maps to the Gemini thinking budget: none disables thinking, low is 2k tokens, medium 8k, high 24k, and max lets the model decide.",
      options: ["none", "low", "medium", "high", "max"],
      experimental_optionLabels: {
        none: "None",
        low: "Low",
        medium: "Medium",
        high: "High",
        max: "Max (model decides)",
      },
      default: "medium",
    },
  });

  let values = {
    apiKey: "",
    model: GEMINI_DEFAULT_MODEL,
    reasoningLevel: "medium",
  };

  const apply = (next: Record<string, unknown>): void => {
    values = {
      apiKey: typeof next.apiKey === "string" ? next.apiKey.trim() : "",
      model:
        typeof next.model === "string" && next.model.trim().length > 0
          ? next.model.trim()
          : GEMINI_DEFAULT_MODEL,
      reasoningLevel:
        typeof next.reasoningLevel === "string" &&
        next.reasoningLevel.trim().length > 0
          ? next.reasoningLevel.trim()
          : "medium",
    };
  };

  void settings
    .get()
    .then((stored) => {
      apply(stored);
    })
    .catch(() => undefined);
  settings.onChange((next) => {
    apply(next);
  });

  bb.providers.register({
    id: GEMINI_PROVIDER_ID,
    displayName: GEMINI_PROVIDER_DISPLAY_NAME,
    icon: "Sparkles",
    strings: {
      signInHint:
        "Set the Gemini API key in this plugin's settings; it is an AI Studio key.",
      expiredHint:
        "Gemini rejected the API key. Set a current key in this plugin's settings, then retry.",
      installUrl: "https://aistudio.google.com/apikey",
      planModeCopy:
        "Gemini will answer with a plan instead of calling tools; the bridge passes the plan instruction through the system instruction.",
      iconTint: { light: "#1a73e8", dark: "#8ab4f8" },
    },
    maintenance: { health: true, usage: false, installation: false },
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      supportsManualCompaction: false,
      supportsThreadArchive: true,
      supportsThreadRename: true,
      fork: "none",
      permissionModes: ["accept-edits", "auto", "full"],
      reasoningLevels: [...GEMINI_REASONING_LEVELS],
    },
    reasoningLevels: [
      { id: "none", label: "None", description: "Thinking off." },
      { id: "low", label: "Low", description: "A 2048-token thinking budget." },
      {
        id: "medium",
        label: "Medium",
        description: "An 8192-token thinking budget.",
      },
      {
        id: "high",
        label: "High",
        description: "A 24576-token thinking budget.",
      },
      {
        id: "max",
        label: "Max",
        description: "The model chooses its own thinking budget.",
      },
    ],
    composerActions: [],
    extensionKinds: {},
    models: {
      scope: "host",
      fallback: GEMINI_FALLBACK_MODELS.map((model, index) => ({
        id: model,
        model,
        displayName: model,
        description: `${model} through the Gemini API.`,
        reasoningDiscovery: "unknown" as const,
        supportedReasoningEfforts: GEMINI_REASONING_LEVELS.map((level) => ({
          reasoningEffort: level,
          description: `${level} thinking budget.`,
        })),
        defaultReasoningEffort: "medium",
        isDefault: index === 3,
      })),
    },
    deriveProviderOptions(context) {
      return {
        model: values.model,
        reasoningLevel:
          context.settings.reasoningLevel ?? values.reasoningLevel,
      };
    },
  });

  bb.providers.experimental_contributeEnv(GEMINI_PROVIDER_ID, () => [
    {
      name: GEMINI_API_KEY_ENV,
      value: values.apiKey,
      reason: "Gemini API key from this plugin's settings",
    },
    {
      name: GEMINI_MODEL_ENV,
      value: values.model,
      reason: "Default Gemini model from this plugin's settings",
    },
  ]);
}
