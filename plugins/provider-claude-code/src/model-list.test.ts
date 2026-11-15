import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { buildClaudeCodeModels } from "./model-list.js";

const EFFORT_LEVELS: ModelInfo["supportedEffortLevels"] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const DISCOVERED_MODELS: ModelInfo[] = [
  {
    value: "default",
    resolvedModel: "claude-opus-5-5[1m]",
    displayName: "Default (recommended)",
    description: "Use the default model (currently Opus 5.5 (1M context))",
    supportedEffortLevels: EFFORT_LEVELS,
  },
  {
    value: "opus[1m]",
    resolvedModel: "claude-opus-5-5[1m]",
    displayName: "Opus (1M context)",
    description: "Opus 5.5 with 1M context",
    supportedEffortLevels: EFFORT_LEVELS,
  },
  {
    value: "claude-fable-5-1[1m]",
    resolvedModel: "claude-fable-5-1",
    displayName: "Fable",
    description: "Fable 5.1",
    supportedEffortLevels: EFFORT_LEVELS,
  },
  {
    value: "sonnet",
    resolvedModel: "claude-sonnet-5",
    displayName: "Sonnet",
    description: "Sonnet 5",
    supportedEffortLevels: EFFORT_LEVELS,
  },
  {
    value: "haiku",
    resolvedModel: "claude-haiku-4-5-20251001",
    displayName: "Haiku",
    description: "Haiku 4.5",
  },
  {
    value: "claude-custom-eap[1m]",
    resolvedModel: "claude-custom-eap[1m]",
    displayName: "claude-custom-eap[1m]",
    description: "Custom model",
  },
];

describe("buildClaudeCodeModels", () => {
  it("offers exactly the models Claude Code reports, in its order", () => {
    const result = buildClaudeCodeModels(DISCOVERED_MODELS);

    expect(
      result.models.map((model) => ({
        model: model.model,
        displayName: model.displayName,
        isDefault: model.isDefault,
      })),
    ).toEqual([
      {
        model: "claude-opus-5-5[1m]",
        displayName: "Opus 5.5 (1M)",
        isDefault: true,
      },
      {
        model: "opus[1m]",
        displayName: "Opus (1M context) alias",
        isDefault: false,
      },
      { model: "claude-fable-5-1", displayName: "Fable 5.1", isDefault: false },
      {
        model: "claude-fable-5-1[1m]",
        displayName: "Fable alias",
        isDefault: false,
      },
      { model: "claude-sonnet-5", displayName: "Sonnet 5", isDefault: false },
      { model: "sonnet", displayName: "Sonnet alias", isDefault: false },
      {
        model: "claude-haiku-4-5-20251001",
        displayName: "Haiku 4.5",
        isDefault: false,
      },
      { model: "haiku", displayName: "Haiku alias", isDefault: false },
      {
        model: "claude-custom-eap[1m]",
        displayName: "claude-custom-eap[1m]",
        isDefault: false,
      },
    ]);
  });

  it("lists Claude Code aliases as models instead of a second list", () => {
    const result = buildClaudeCodeModels(DISCOVERED_MODELS);

    expect(result.selectedOnlyModels).toEqual([]);
    expect(result.models.map((model) => model.model)).toEqual(
      expect.arrayContaining(["opus[1m]", "sonnet", "haiku"]),
    );
    expect(new Set(result.models.map((model) => model.model)).size).toBe(
      result.models.length,
    );
  });

  it("keeps each alias display name distinct from the version it resolves to", () => {
    const result = buildClaudeCodeModels(DISCOVERED_MODELS);
    const displayName = (model: string) =>
      result.models.find((candidate) => candidate.model === model)?.displayName;

    expect(displayName("sonnet")).toBe("Sonnet alias");
    expect(displayName("claude-sonnet-5")).toBe("Sonnet 5");
    expect(displayName("haiku")).toBe("Haiku alias");
    expect(displayName("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
  });

  it("maps reported effort levels, adding ultracode alongside xhigh", () => {
    const result = buildClaudeCodeModels(DISCOVERED_MODELS);
    const efforts = (model: string) =>
      result.models
        .find((candidate) => candidate.model === model)
        ?.supportedReasoningEfforts.map((effort) => effort.reasoningEffort);

    expect(efforts("claude-opus-5-5[1m]")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "ultracode",
      "max",
    ]);
    expect(efforts("claude-haiku-4-5-20251001")).toEqual(["low"]);
    expect(
      result.models.find((model) => model.model === "claude-opus-5-5[1m]")
        ?.defaultReasoningEffort,
    ).toBe("high");
  });

  it("marks the first model as default when Claude Code reports no default", () => {
    const result = buildClaudeCodeModels(
      DISCOVERED_MODELS.filter((model) => model.value !== "default"),
    );

    expect(result.models.filter((model) => model.isDefault)).toEqual([
      expect.objectContaining({ model: "claude-opus-5-5[1m]" }),
    ]);
  });

  it("follows Claude Code when it changes the default model", () => {
    const result = buildClaudeCodeModels([
      {
        value: "default",
        resolvedModel: "claude-sonnet-5",
        displayName: "Default (recommended)",
        description: "Sonnet 5",
      },
      ...DISCOVERED_MODELS.filter((model) => model.value !== "default"),
    ]);

    expect(result.models.find((model) => model.isDefault)?.model).toBe(
      "claude-sonnet-5",
    );
  });
});
