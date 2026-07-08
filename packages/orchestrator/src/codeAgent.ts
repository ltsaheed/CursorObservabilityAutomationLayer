import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Agent, CursorAgentError } from "@cursor/sdk";

import {
  loadInstrumentReport,
  REPORT_RELATIVE_PATH,
} from "./reportLoader.js";
import type {
  ICoverageAssessment,
  ICodeAgentResult,
  IInstrumentReport,
  IProgressReporter,
} from "./types.js";
import { instrumentReportSchema } from "./types.js";
import type { IGitHubCommentContext } from "./github.js";
import { parseRepoSlug } from "./github.js";

export interface ICodeAgentOptions {
  prUrl?: string;
  workspaceRoot: string;
  assessment: ICoverageAssessment;
  dryRun: boolean;
  skipCodeAgent: boolean;
  reporter: IProgressReporter;
  github?: IGitHubCommentContext;
}

const PROMPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "prompts",
  "codeAgent.md",
);

const extractRepoUrlFromPrUrl = (prUrl: string): string => {
  const match = prUrl.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)/);

  if (!match?.[1]) {
    throw new Error(`Could not derive repository URL from prUrl: ${prUrl}`);
  }

  return match[1];
};

const loadPrompt = (): string => {
  return readFileSync(PROMPT_PATH, "utf8");
};

const buildCheckoutRetryDryRunReport = (
  assessment: ICoverageAssessment,
): IInstrumentReport => {
  const checkoutRetryGap = assessment.gaps.find(
    (gap) => gap.pageName === "CheckoutRetryPage" || gap.file.includes("CheckoutRetryPage"),
  );
  const targetFile = checkoutRetryGap?.file ?? "src/pages/CheckoutRetryPage.tsx";

  return instrumentReportSchema.parse({
    version: "1",
    prSummary:
      "Instrumented CheckoutRetryPage with page view and navigation click tracking.",
    pages: [
      {
        name: "CheckoutRetryPage",
        file: targetFile,
        events: [
          {
            name: "checkout_retry_viewed",
            properties: { page: "checkout_retry", step: "retry" },
            trigger: "trackPageView on mount",
            line: 8,
            justification:
              "ADR-031 requires a page view on mount. Reused `trackPageView` instead of duplicating a raw `track('checkout_retry_viewed')` block.",
          },
          {
            name: "checkout_retry_back_clicked",
            properties: {
              page: "checkout_retry",
              step: "retry",
              cta: "back_to_checkout",
            },
            trigger: "trackAction on Link onClick",
            line: 18,
            justification:
              "The back link is a funnel exit point. `trackAction` captures the CTA with `step` for retry funnel analysis.",
          },
        ],
      },
    ],
    newEvents: ["checkout_retry_viewed", "checkout_retry_back_clicked"],
    helpersUsed: ["trackPageView", "trackAction"],
    helpersCreated: [],
    deduplicationDecisions: [
      {
        choice: "reuse",
        helper: "trackPageView",
        reason: "Page mount uses shared helper instead of duplicating useEffect+track",
      },
      {
        choice: "reuse",
        helper: "trackAction",
        reason: "Link click uses shared action helper",
      },
    ],
    filesChanged: [targetFile, `${targetFile.replace(/\.tsx$/, ".test.tsx")}`],
    changeBlocks: [
      {
        file: targetFile,
        startLine: 8,
        endLine: 8,
        justification:
          "Page mount block: ADR-031 requires a page view on mount. Reused `trackPageView` instead of duplicating raw `track()`.",
        events: ["checkout_retry_viewed"],
      },
      {
        file: targetFile,
        startLine: 18,
        endLine: 18,
        justification:
          "Navigation block: the back link is a funnel exit point. `trackAction` captures the CTA with `step` for retry funnel analysis.",
        events: ["checkout_retry_back_clicked"],
      },
    ],
  });
};

export const runCodeAgent = async (
  options: ICodeAgentOptions,
): Promise<ICodeAgentResult | null> => {
  const { reporter, assessment, dryRun, skipCodeAgent, workspaceRoot, prUrl, github } =
    options;

  reporter.phaseStart("code-agent");

  if (skipCodeAgent) {
    reporter.decision("code-agent", "Skipped", "skipCodeAgent flag enabled");
    reporter.phaseComplete("code-agent", "skipped");

    return null;
  }

  if (dryRun || !process.env.CURSOR_API_KEY) {
    const reason = dryRun ? "dry-run mode" : "CURSOR_API_KEY not set";
    reporter.decision("code-agent", "Dry run", `Generating mock report (${reason})`);
    const report = buildCheckoutRetryDryRunReport(assessment);
    reporter.setReport(report);
    reporter.phaseComplete("code-agent", "complete");

    return { report, agentId: undefined };
  }

  if (!prUrl) {
    reporter.log("code-agent", "prUrl is required for cloud code agent", "error");
    reporter.phaseComplete("code-agent", "failed");

    return null;
  }

  const apiKey = process.env.CURSOR_API_KEY;
  const prompt = `${loadPrompt()}\n\n## Pre-scan assessment\n\n${JSON.stringify(assessment, null, 2)}\n\n## Required output\n\nYou MUST write valid JSON to \`${REPORT_RELATIVE_PATH}\` and commit it to the PR branch before finishing.`;

  try {
    await using agent = await Agent.create({
      apiKey,
      model: { id: "composer-2.5" },
      cloud: {
        repos: [{ url: extractRepoUrlFromPrUrl(prUrl), prUrl }],
        workOnCurrentBranch: true,
        skipReviewerRequest: true,
      },
    });

    const run = await agent.send(prompt);
    reporter.log("code-agent", `Started Cursor Cloud Agent run ${run.id}`);

    for await (const event of run.stream()) {
      reporter.streamEvent("code-agent", event);
    }

    const result = await run.wait();

    if (result.status === "error") {
      reporter.log("code-agent", `Agent run failed: ${result.id}`, "error");
      reporter.phaseComplete("code-agent", "failed");

      return null;
    }

    const loaded = await loadInstrumentReport({
      workspaceRoot,
      agentResultText: result.result,
      github,
    });

    if (!loaded.report) {
      reporter.log(
        "code-agent",
        `Could not parse ${REPORT_RELATIVE_PATH} after agent completion (${loaded.errors.join("; ")})`,
        "error",
      );
      reporter.phaseComplete("code-agent", "failed");

      return null;
    }

    reporter.decision(
      "code-agent",
      "Report loaded",
      `Source: ${loaded.source ?? "unknown"}`,
    );
    reporter.setReport(loaded.report);
    reporter.phaseComplete("code-agent", "complete");

    return { report: loaded.report, agentId: agent.agentId };
  } catch (error) {
    const message =
      error instanceof CursorAgentError
        ? `Cursor agent startup failed: ${error.message}`
        : error instanceof Error
          ? error.message
          : "Unknown code agent error";

    reporter.log("code-agent", message, "error");
    reporter.phaseComplete("code-agent", "failed");

    return null;
  }
};

export const buildGithubContextFromRunOptions = (options: {
  repo?: string;
  prNumber?: number;
}): IGitHubCommentContext | undefined => {
  if (!options.repo || !options.prNumber || !process.env.GITHUB_TOKEN) {
    return undefined;
  }

  return {
    token: process.env.GITHUB_TOKEN,
    repo: parseRepoSlug(options.repo),
    prNumber: options.prNumber,
  };
};
