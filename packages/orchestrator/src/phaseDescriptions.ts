import type { IProgressPhase, IProgressSubPhase } from "./types.js";

export interface IPhaseDescription {
  title: string;
  subtitle: string;
}

export const PHASE_DESCRIPTIONS: Record<IProgressPhase, IPhaseDescription> = {
  "pre-scan": {
    title: "Pre-scan",
    subtitle: "Scan changed page files for missing analytics events (deterministic, no AI).",
  },
  "code-agent": {
    title: "Code Agent",
    subtitle: "Cursor Cloud Agent adds instrumentation and commits to the PR branch.",
  },
  "standards-review": {
    title: "Standards review",
    subtitle:
      "A separate Review Agent reads the instrumentation and checks it against your org analytics standards. If checks fail, Instrument sends fix instructions to the Code Agent and re-runs the review (up to 2 fix rounds, 3 reviews total).",
  },
  "dashboard-agent": {
    title: "Dashboard agent",
    subtitle: "Plan Mixpanel insights and funnel reports for newly instrumented events.",
  },
  "mixpanel-deploy": {
    title: "Mixpanel deploy",
    subtitle: "Create dashboard bookmarks in Mixpanel via the service account API.",
  },
  "github-comment": {
    title: "PR feedback",
    subtitle: "Post the sticky PR summary and inline review comments on the diff.",
  },
};

export const GHA_SETUP_STEP_DESCRIPTIONS = {
  checkoutApp: {
    title: "Checkout app",
    subtitle: "Load the application repository for this pull request.",
  },
  checkoutTooling: {
    title: "Checkout Instrument tooling",
    subtitle: "Load the central Instrument orchestrator from the tooling repo.",
  },
  setupNode: {
    title: "Setup Node",
    subtitle: "Install Node.js 22 to run the Instrument CLI.",
  },
  installRipgrep: {
    title: "Install ripgrep",
    subtitle: "Install ripgrep, required by Cursor SDK local agents.",
  },
  installTooling: {
    title: "Install and build tooling",
    subtitle: "Install dependencies and compile the Instrument CLI.",
  },
  collectChangedFiles: {
    title: "Collect changed files",
    subtitle: "List files changed in this PR to scope analytics scanning.",
  },
  configureCli: {
    title: "Configure Instrument CLI",
    subtitle: "Resolve config paths, PR metadata, and flags for pipeline phases.",
  },
  syncWorkspace: {
    title: "Sync workspace",
    subtitle: "Pull Code Agent commits onto this runner before later phases run.",
  },
  uploadState: {
    title: "Upload pipeline state",
    subtitle: "Save run state as a workflow artifact for debugging.",
  },
} as const satisfies Record<string, IPhaseDescription>;

export const formatGhaStepName = ({ title, subtitle }: IPhaseDescription): string =>
  `${title}: ${subtitle}`;

export const getPhaseDescription = (phase: IProgressSubPhase): IPhaseDescription => {
  const [basePhase, ...suffixParts] = phase.split("/");
  const baseDescription = PHASE_DESCRIPTIONS[basePhase as IProgressPhase];

  if (!baseDescription) {
    return {
      title: phase,
      subtitle: "Running Instrument pipeline phase.",
    };
  }

  if (suffixParts.length === 0) {
    return baseDescription;
  }

  const suffix = suffixParts.join("/");

  if (basePhase === "standards-review" && suffix.startsWith("attempt-")) {
    const attempt = suffix.replace("attempt-", "");

    return {
      title: baseDescription.title,
      subtitle: `Review attempt ${attempt}: check instrumentation against analytics standards.`,
    };
  }

  if (basePhase === "code-agent" && suffix.startsWith("resume-")) {
    const round = suffix.replace("resume-", "");

    return {
      title: "Code Agent fix",
      subtitle: `Fix round ${round}: Code Agent applies Review Agent feedback, updates the report, and pushes to the PR branch.`,
    };
  }

  const readableSuffix = suffix.replace(/-/g, " ");

  return {
    title: baseDescription.title,
    subtitle: `${baseDescription.subtitle} (${readableSuffix})`,
  };
};

export const formatPhaseStepSummary = (phase: IProgressSubPhase): string => {
  const { title, subtitle } = getPhaseDescription(phase);

  return `### ${title}\n_${subtitle}_\n`;
};
