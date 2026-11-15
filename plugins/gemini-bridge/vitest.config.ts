import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    silent: "passed-only",
    name: "bb-plugin-gemini-bridge",
    include: ["*.test.ts", "src/**/*.test.ts"],
    exclude: ["node_modules/**"],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 60_000,
  },
});
