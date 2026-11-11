// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { BbHttpError } from "@bb/sdk/browser";
import type { PluginInstallJob } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCatalogPluginInstall } from "@/hooks/queries/plugin-install-job-queries";
import { makeInstalledPlugin } from "@/test/fixtures/plugins";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useOnboardingPluginChange } from "./useOnboardingPluginChange";

const plugins = vi.hoisted(() => ({
  setEnabled: vi.fn(),
}));

vi.mock("@/components/plugin/useSetPluginEnabled", () => ({
  useSetPluginEnabled: () => plugins.setEnabled,
}));
vi.mock("@/hooks/cache-owners/plugin-cache-owner", () => ({
  applyPluginInstallJob: vi.fn(),
}));
vi.mock("@/hooks/queries/plugin-install-job-queries", async (original) => ({
  ...(await original<
    typeof import("@/hooks/queries/plugin-install-job-queries")
  >()),
  startCatalogPluginInstall: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function job(
  state: PluginInstallJob["state"],
  id = "job_1",
  entryId = "workflows",
): PluginInstallJob {
  const fields = {
    id,
    target: { kind: "catalog" as const, entryId, marketplace: "bb" },
    displayName: entryId,
  };
  switch (state) {
    case "succeeded":
      return {
        ...fields,
        state,
        plugin: makeInstalledPlugin({ id: entryId }),
      };
    case "failed":
      return { ...fields, state, error: "npm exited 1" };
    default:
      return { ...fields, state };
  }
}

function renderChange(installed: boolean) {
  const { wrapper } = createQueryClientTestHarness();
  return renderHook(
    () =>
      useOnboardingPluginChange({
        plugin: {
          pluginId: "workflows",
          entryId: "workflows",
          marketplace: "bb",
          installed,
        },
      }),
    { wrapper },
  );
}

describe("onboarding plugin changes", () => {
  it("starts a catalog install for an uninstalled plugin and returns its job id", async () => {
    vi.mocked(startCatalogPluginInstall).mockResolvedValue(job("running"));
    const view = renderChange(false);

    await act(async () => {
      await expect(view.result.current(true)).resolves.toBe("job_1");
    });
  });

  it("rethrows an install request the server refused", async () => {
    const refused = new BbHttpError({
      body: null,
      code: "plugin_not_found",
      message: "Not found",
      status: 404,
    });
    vi.mocked(startCatalogPluginInstall).mockRejectedValue(refused);
    const view = renderChange(false);

    await expect(act(() => view.result.current(true))).rejects.toBe(refused);
  });

  it.each([true, false])(
    "switches an installed plugin (%s) and rethrows failures",
    async (enabled) => {
      plugins.setEnabled.mockRejectedValueOnce(new Error("offline"));
      const view = renderChange(true);

      await expect(act(() => view.result.current(enabled))).rejects.toThrow(
        "offline",
      );
      plugins.setEnabled.mockResolvedValueOnce(undefined);
      await act(() => view.result.current(enabled));

      expect(plugins.setEnabled).toHaveBeenLastCalledWith("workflows", enabled);
    },
  );
});
