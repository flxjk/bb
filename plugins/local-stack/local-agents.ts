import {
  type BbPluginApi,
  type PluginProviderCapabilities,
  type PluginProviderDeclaration,
} from "@get-bb/plugin-sdk";
import { z } from "zod";

const LOCAL_FAMILY = "local";

const DEFAULT_REASONIX_LAUNCH = JSON.stringify({
  command: "reasonix",
  args: ["acp"],
});

const DEFAULT_GEMINI_LAUNCH = JSON.stringify({
  command: "gemini",
  args: ["--acp"],
});

const DEFAULT_ANTIGRAVITY_LAUNCH = JSON.stringify({
  command: "agy",
  args: ["acp", "--disable-telemetry"],
});

const ANTIGRAVITY_ICON = "bb--local-stack/antigravity";

const DEFAULT_DEEPSEEK_HARNESS_LAUNCH = JSON.stringify({
  command: "node",
  args: [
    "/Users/gj/git/deepseek-harness/apps/cli/lib/bin.js",
    "--profile",
    "acp",
  ],
});

const launchSpecSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
  })
  .strict();

type LocalAgentLaunchSpec = z.infer<typeof launchSpecSchema>;

const LOCAL_AGENT_CAPABILITIES: PluginProviderCapabilities = {
  supportsServiceTier: false,
  supportsNativeUserQuestion: false,
  supportsManualCompaction: false,
  supportsThreadArchive: false,
  supportsThreadRename: false,
  fork: "none",
  permissionModes: ["accept-edits", "full"],
  reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
};

type LocalAgentSettingKey =
  | "reasonixLaunch"
  | "geminiLaunch"
  | "antigravityLaunch"
  | "deepseekHarnessLaunch";

interface LocalAgentDefinition {
  settingKey: LocalAgentSettingKey;
  settingLabel: string;
  settingDescription: string;
  defaultLaunch: string;
  id: string;
  displayName: string;
  icon: string;
  signInHint: string;
  expiredHint: string;
}

const LOCAL_AGENTS: readonly LocalAgentDefinition[] = [
  {
    settingKey: "reasonixLaunch",
    settingLabel: "Reasonix launch spec",
    settingDescription:
      'JSON with the command and args bb starts Reasonix with. Defaults to {"command":"reasonix","args":["acp"]}.',
    defaultLaunch: DEFAULT_REASONIX_LAUNCH,
    id: "reasonix",
    displayName: "Reasonix",
    icon: "Toolbox",
    signInHint:
      "Reasonix reads its model configuration from reasonix.toml and ~/.reasonix. Run `reasonix doctor` on this machine to check it.",
    expiredHint:
      "Reasonix could not reach its model. Run `reasonix doctor` on this machine, then reload.",
  },
  {
    settingKey: "geminiLaunch",
    settingLabel: "Gemini CLI launch spec",
    settingDescription:
      'JSON with the command and args bb starts the Gemini CLI with. Defaults to {"command":"gemini","args":["--acp"]}; use `npx -y @google/gemini-cli --acp` to run it without a global install.',
    defaultLaunch: DEFAULT_GEMINI_LAUNCH,
    id: "gemini",
    displayName: "Gemini",
    icon: "AiContentGenerator01",
    signInHint:
      "Install the Gemini CLI (`npm install -g @google/gemini-cli`) and sign in on this machine, or point the launch spec at `npx -y @google/gemini-cli --acp`.",
    expiredHint:
      "Your Gemini session expired. Run `gemini` on this machine to sign in, then reload.",
  },
  {
    settingKey: "antigravityLaunch",
    settingLabel: "Antigravity CLI launch spec",
    settingDescription:
      'JSON with the command and args bb starts the Antigravity CLI with. Defaults to {"command":"agy","args":["acp","--disable-telemetry"]}, which runs the ACP server with Antigravity\'s own telemetry off; sign in once on this machine with `agy acp --login`.',
    defaultLaunch: DEFAULT_ANTIGRAVITY_LAUNCH,
    id: "antigravity",
    displayName: "Antigravity",
    icon: ANTIGRAVITY_ICON,
    signInHint:
      "Install the Antigravity CLI (`curl -fsSL https://antigravity.google/cli/install.sh | bash`) and sign in once on this machine with `agy acp --login`, then reload.",
    expiredHint:
      "Your Antigravity session expired. Run `agy acp --login` on this machine to sign in, then reload.",
  },
  {
    settingKey: "deepseekHarnessLaunch",
    settingLabel: "DeepSeek Harness launch spec",
    settingDescription:
      "JSON with the command and args bb starts DeepSeek Harness with. The default runs this checkout's dsh entry point with --profile acp.",
    defaultLaunch: DEFAULT_DEEPSEEK_HARNESS_LAUNCH,
    id: "deepseek-harness",
    displayName: "DeepSeek Harness",
    icon: "AiBrain01",
    signInHint:
      "DeepSeek Harness serves its `acp` profile over stdio. Check the launch spec in this plugin's settings.",
    expiredHint:
      "DeepSeek Harness stopped serving the acp profile. Check the launch spec in this plugin's settings, then reload.",
  },
];

const ACP_DOCUMENTATION_URL = "https://agentclientprotocol.com";

function declarationFor(
  agent: LocalAgentDefinition,
  launch: LocalAgentLaunchSpec,
): PluginProviderDeclaration {
  return {
    id: agent.id,
    displayName: agent.displayName,
    family: LOCAL_FAMILY,
    icon: agent.icon,
    strings: {
      signInHint: agent.signInHint,
      expiredHint: agent.expiredHint,
      installUrl: ACP_DOCUMENTATION_URL,
    },
    experimental_visibility: "installed",
    experimental_bridgeOptions: {
      acpDialect: "acp",
      acpLaunchSpec: {
        displayName: agent.displayName,
        command: launch.command,
        args: [...launch.args],
        env: { ...launch.env },
      },
    },
    models: { scope: "host" },
    maintenance: { health: true, usage: false, installation: false },
    capabilities: {
      ...LOCAL_AGENT_CAPABILITIES,
      permissionModes: [...LOCAL_AGENT_CAPABILITIES.permissionModes],
      reasoningLevels: [...LOCAL_AGENT_CAPABILITIES.reasoningLevels],
    },
    composerActions: [],
  };
}

function launchSpecSettingSchema(fallback: string) {
  return z.string().superRefine((value, context) => {
    let raw: unknown;
    try {
      raw = JSON.parse(value.trim().length === 0 ? fallback : value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Launch spec must be valid JSON.",
      });
      return;
    }
    const parsed = launchSpecSchema.safeParse(raw);
    if (parsed.success) return;
    const issue = parsed.error.issues[0];
    context.addIssue({
      code: "custom",
      message:
        issue === undefined
          ? "Launch spec is invalid."
          : `Launch spec is invalid: ${issue.path.join(".") || "value"} ${issue.message}.`,
    });
  });
}

function parseLaunchSpec(args: {
  bb: BbPluginApi;
  agent: LocalAgentDefinition;
  value: string | undefined;
}): LocalAgentLaunchSpec | null {
  const raw = (args.value ?? "").trim();
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.length === 0 ? args.agent.defaultLaunch : raw);
  } catch {
    args.bb.log.error(
      `${args.agent.displayName} launch spec is not valid JSON; keeping the running declaration.`,
    );
    return null;
  }
  const parsed = launchSpecSchema.safeParse(parsedJson);
  if (!parsed.success) {
    args.bb.log.error(
      `${args.agent.displayName} launch spec is invalid (${parsed.error.message}); keeping the running declaration.`,
    );
    return null;
  }
  return parsed.data;
}

interface LocalAgentLaunchValues {
  reasonixLaunch: string;
  geminiLaunch: string;
  antigravityLaunch: string;
  deepseekHarnessLaunch: string;
}

function launchSetting(key: LocalAgentSettingKey) {
  const agent = LOCAL_AGENTS.find((candidate) => candidate.settingKey === key);
  if (agent === undefined) {
    throw new Error(`No local agent declares the setting "${key}".`);
  }
  return {
    type: "string" as const,
    label: agent.settingLabel,
    description: agent.settingDescription,
    experimental_multiline: true,
    experimental_schema: launchSpecSettingSchema(agent.defaultLaunch),
    default: agent.defaultLaunch,
  };
}

export async function installLocalAgents(bb: BbPluginApi): Promise<void> {
  const settings = bb.settings.define({
    reasonixLaunch: launchSetting("reasonixLaunch"),
    geminiLaunch: launchSetting("geminiLaunch"),
    antigravityLaunch: launchSetting("antigravityLaunch"),
    deepseekHarnessLaunch: launchSetting("deepseekHarnessLaunch"),
  });

  const registered = new Map<string, { key: string; dispose(): void }>();

  function apply(declarations: readonly PluginProviderDeclaration[]): void {
    const desired = new Map(declarations.map((item) => [item.id, item]));
    for (const [id, entry] of [...registered]) {
      const next = desired.get(id);
      if (next !== undefined && JSON.stringify(next) === entry.key) continue;
      entry.dispose();
      registered.delete(id);
    }
    for (const declaration of declarations) {
      if (registered.has(declaration.id)) continue;
      try {
        const { dispose } = bb.providers.register(declaration);
        registered.set(declaration.id, {
          key: JSON.stringify(declaration),
          dispose,
        });
      } catch (error) {
        bb.log.error(
          `Could not register the local agent "${declaration.id}": ${String(error)}`,
        );
      }
    }
  }

  function reconcile(values: LocalAgentLaunchValues): void {
    const declarations: PluginProviderDeclaration[] = [];
    for (const agent of LOCAL_AGENTS) {
      const launch = parseLaunchSpec({
        bb,
        agent,
        value: values[agent.settingKey],
      });
      if (launch !== null) declarations.push(declarationFor(agent, launch));
    }
    apply(declarations);
  }

  let pending: Promise<void> = Promise.resolve();

  function queueReconcile(values: LocalAgentLaunchValues): Promise<void> {
    pending = pending.catch(() => undefined).then(() => reconcile(values));
    return pending;
  }

  const initial = await settings.get();
  await queueReconcile(initial);

  settings.onChange((next) => {
    void queueReconcile(next).catch((error: unknown) => {
      bb.log.error(`Could not re-register the local agents: ${String(error)}`);
    });
  });

  bb.onDispose(() => {
    for (const [, entry] of registered) entry.dispose();
    registered.clear();
  });
}
