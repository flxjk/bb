import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("setup guide route", () => {
  it("serves the control variant by default without exposing its source", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/system/setup-guide");

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({ variant: "control" });
    });
  });

  it("serves the variant configured through the harness override", async () => {
    await withTestHarness(
      { setupGuideVariant: "new" },
      async (harness) => {
        const response = await harness.app.request(
          "/api/v1/system/setup-guide",
        );

        expect(response.status).toBe(200);
        await expect(readJson(response)).resolves.toEqual({ variant: "new" });
      },
    );
  });
});
