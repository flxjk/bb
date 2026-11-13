import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { piProviderDeclaration } from "./src/declaration.js";

export default function plugin(bb: BbPluginApi): void {
  const settings = bb.settings.define({
    openaiApiKey: {
      type: "string",
      label: "OpenAI Platform API key",
      description:
        "Optional key for Pi's OpenAI Platform provider. Stored as a secret and passed to Pi as OPENAI_API_KEY. Leave empty to use Pi's existing authentication.",
      secret: true,
      default: "",
    },
  });
  const registered = bb.providers.register(piProviderDeclaration());
  bb.providers.experimental_contributeEnv("pi", async () => {
    const { openaiApiKey } = await settings.get();
    if (openaiApiKey.trim().length === 0) return [];
    return [
      {
        name: "OPENAI_API_KEY",
        value: openaiApiKey,
        reason: "OpenAI Platform API key configured in Pi provider settings",
      },
    ];
  });
  bb.onDispose(() => {
    registered.dispose();
  });
}
