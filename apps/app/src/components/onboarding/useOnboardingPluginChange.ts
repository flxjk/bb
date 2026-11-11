import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSetPluginEnabled } from "@/components/plugin/useSetPluginEnabled";
import { applyPluginInstallJob } from "@/hooks/cache-owners/plugin-cache-owner";
import { startCatalogPluginInstall } from "@/hooks/queries/plugin-install-job-queries";

type PluginOperation = "install" | "enable" | "disable";

export function useOnboardingPluginChange({
  plugin,
}: {
  plugin: {
    pluginId: string;
    entryId: string;
    marketplace: string;
    installed: boolean;
  };
}): (enabled: boolean) => Promise<string | null> {
  const queryClient = useQueryClient();
  const setPluginEnabled = useSetPluginEnabled();
  const { pluginId, entryId, marketplace, installed } = plugin;

  return useCallback(
    async (enabled: boolean) => {
      const operation: PluginOperation =
        enabled && !installed ? "install" : enabled ? "enable" : "disable";
      if (operation === "install") {
        const job = await startCatalogPluginInstall(fetch, {
          entryId,
          marketplace,
        });
        applyPluginInstallJob({ queryClient, job });
        return job.id;
      }
      await setPluginEnabled(pluginId, enabled);
      return null;
    },
    [entryId, installed, marketplace, pluginId, queryClient, setPluginEnabled],
  );
}
