import type { SetupGuideVariant } from "@bb/server-contract";

type SetupGuideAssignmentSource = "override" | "default";

interface SetupGuideAssignment {
  variant: SetupGuideVariant;
  source: SetupGuideAssignmentSource;
}

export interface SetupGuideAssignments {
  guide: SetupGuideAssignment;
}

export interface SetupGuideExperiment {
  resolve(): Promise<SetupGuideAssignments>;
}

interface CreateSetupGuideExperimentArgs {
  override?: SetupGuideVariant | null;
}

const DEFAULT_GUIDE: SetupGuideAssignment = {
  variant: "control",
  source: "default",
};

async function resolveAssignments(
  override: SetupGuideVariant | null | undefined,
): Promise<SetupGuideAssignments> {
  return {
    guide:
      override === null || override === undefined
        ? DEFAULT_GUIDE
        : { variant: override, source: "override" },
  };
}

export async function createSetupGuideExperiment(
  args: CreateSetupGuideExperimentArgs,
): Promise<SetupGuideExperiment> {
  let resolution: Promise<SetupGuideAssignments> | null = null;
  return {
    resolve(): Promise<SetupGuideAssignments> {
      resolution ??= resolveAssignments(args.override);
      return resolution;
    },
  };
}
