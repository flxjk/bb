import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { ollamaHostContract } from "./ollama.js";
import { chatWithOllama, probeOllama, startOllama } from "./ollama-host.js";

export { experimental_acpProviderBridge as experimental_providerBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";

export default experimental_defineHostEntry({
  contract: ollamaHostContract,
  handlers: {
    status: (input, context) => probeOllama(input.baseUrl, context.signal),
    chat: async (input, context) => ({
      text: await chatWithOllama({
        baseUrl: input.baseUrl,
        model: input.model,
        prompt: input.prompt,
        timeoutMs: input.timeoutMs,
        signal: context.signal,
      }),
    }),
    start: (input) =>
      startOllama({
        executable: input.executable,
        baseUrl: input.baseUrl,
      }),
  },
});
