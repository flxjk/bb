import { describe, expect, it } from "vitest";
import { createSetupGuideExperiment } from "../../src/services/system/setup-guide-experiment.js";

describe("setup guide experiment", () => {
  it("defaults to the control variant when no override is configured", async () => {
    const experiment = await createSetupGuideExperiment({});

    await expect(experiment.resolve()).resolves.toEqual({
      guide: { variant: "control", source: "default" },
    });
  });

  it("treats a null override as the default", async () => {
    const experiment = await createSetupGuideExperiment({ override: null });

    await expect(experiment.resolve()).resolves.toEqual({
      guide: { variant: "control", source: "default" },
    });
  });

  it("resolves the configured override variant", async () => {
    const experiment = await createSetupGuideExperiment({ override: "new" });

    await expect(experiment.resolve()).resolves.toEqual({
      guide: { variant: "new", source: "override" },
    });
  });

  it("resolves the assignment once", async () => {
    const experiment = await createSetupGuideExperiment({ override: "new" });

    const [first, second] = await Promise.all([
      experiment.resolve(),
      experiment.resolve(),
    ]);

    expect(second).toBe(first);
  });
});
