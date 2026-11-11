import { z } from "zod";

export const APP_INSTALL_KIND_ENV_NAME = "BB_APP_INSTALL_KIND";
export const APP_SOURCE_COMMIT_ENV_NAME = "BB_APP_SOURCE_COMMIT";

export const appInstallKindSchema = z.enum(["desktop", "npm", "source"]);
export type AppInstallKind = z.infer<typeof appInstallKindSchema>;

export type AppInstall =
  | { kind: "desktop" }
  | { kind: "npm" }
  | { commit: string | null; kind: "source" };

export function appInstallEnv(install: AppInstall): Record<string, string> {
  switch (install.kind) {
    case "desktop":
    case "npm":
      return { [APP_INSTALL_KIND_ENV_NAME]: install.kind };
    case "source":
      return install.commit === null
        ? { [APP_INSTALL_KIND_ENV_NAME]: "source" }
        : {
            [APP_INSTALL_KIND_ENV_NAME]: "source",
            [APP_SOURCE_COMMIT_ENV_NAME]: install.commit,
          };
  }
}
