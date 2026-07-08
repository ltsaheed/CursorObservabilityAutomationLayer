import {
  buildDashboardUrl,
  buildMixpanelEventsUrl,
  buildMixpanelReportUrl,
} from "@instrument/mixpanel-client";
import type { IDeployDashboardPlanResult } from "@instrument/mixpanel-client";

import type {
  IDashboardPlan,
  IInstrumentEvent,
  IInstrumentReport,
  IProgressReporterState,
} from "./types.js";
import type { IGitHubCommentContext } from "./github.js";

export const REVIEW_MARKER = "<!-- instrument-review -->";

interface IPullRequestRef {
  headSha: string;
}

interface IGitHubPullRequest {
  head: { sha: string };
}

interface IGitHubReviewComment {
  id: number;
  body: string;
  path: string;
  line: number | null;
}

const GITHUB_API_BASE = "https://api.github.com";

const githubRequest = async <T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(`GitHub API ${response.status}: ${body}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

export const fetchPullRequestHeadSha = async (
  context: IGitHubCommentContext,
): Promise<string> => {
  const path = `/repos/${context.repo.owner}/${context.repo.repo}/pulls/${context.prNumber}`;
  const pullRequest = await githubRequest<IGitHubPullRequest>(context.token, path);

  return pullRequest.head.sha;
};

export interface IEventMixpanelContext {
  reportName?: string;
  reportType?: string;
  reportUrl?: string;
  dashboardUrl?: string;
  eventsUrl?: string;
  plannedOnly: boolean;
}

export const resolveEventMixpanelContext = (
  eventName: string,
  dashboardPlan?: IDashboardPlan,
  deployResult?: IDeployDashboardPlanResult,
  mixpanelProjectId?: string,
  mixpanelWorkspaceId?: string,
): IEventMixpanelContext => {
  const plannedReport = dashboardPlan?.reports.find((report) => {
    if (report.type === "insights") {
      return report.event === eventName;
    }

    return report.steps.includes(eventName);
  });

  const deployedReport = deployResult?.reports.find((entry) => {
    if (entry.plan.type === "insights") {
      return entry.plan.event === eventName;
    }

    return entry.plan.steps.includes(eventName);
  });

  const eventsUrl =
    mixpanelProjectId && mixpanelWorkspaceId
      ? buildMixpanelEventsUrl(mixpanelProjectId, mixpanelWorkspaceId, eventName)
      : undefined;

  if (deployedReport && deployResult) {
    return {
      reportName: deployedReport.plan.name,
      reportType: deployedReport.plan.type,
      reportUrl: deployedReport.reportUrl,
      dashboardUrl: deployResult.dashboardUrl,
      eventsUrl,
      plannedOnly: false,
    };
  }

  if (plannedReport) {
    return {
      reportName: plannedReport.name,
      reportType: plannedReport.type,
      reportUrl:
        deployResult && mixpanelProjectId && mixpanelWorkspaceId
          ? buildMixpanelReportUrl(
              mixpanelProjectId,
              mixpanelWorkspaceId,
              deployResult.dashboardId,
              0,
            )
          : undefined,
      dashboardUrl:
        deployResult && mixpanelProjectId && mixpanelWorkspaceId
          ? buildDashboardUrl(
              mixpanelProjectId,
              mixpanelWorkspaceId,
              deployResult.dashboardId,
            )
          : undefined,
      eventsUrl,
      plannedOnly: true,
    };
  }

  return {
    eventsUrl,
    plannedOnly: true,
  };
};

export const buildReviewCommentBody = (
  event: IInstrumentEvent,
  file: string,
  mixpanel: IEventMixpanelContext,
): string => {
  const lines: string[] = [
    REVIEW_MARKER,
    `**Instrument** · \`${event.name}\` · _Cursor Cloud Agent_`,
    "",
  ];

  if (event.justification) {
    lines.push("**Why this change**", event.justification, "");
  } else {
    lines.push("**Why this change**", event.trigger, "");
  }

  lines.push(
    "**Event**",
    `- Name: \`${event.name}\``,
    `- Trigger: ${event.trigger}`,
  );

  const propertyEntries = Object.entries(event.properties);

  if (propertyEntries.length > 0) {
    lines.push("- Properties:");

    for (const [key, value] of propertyEntries) {
      lines.push(`  - \`${key}\`: ${String(value)}`);
    }
  }

  lines.push("", "**Where it appears in Mixpanel**");

  if (mixpanel.reportName) {
    const status = mixpanel.plannedOnly ? "Planned report" : "Report";

    lines.push(`- ${status}: **${mixpanel.reportName}** (${mixpanel.reportType ?? "insights"})`);
  } else {
    lines.push("- No dashboard report mapped yet for this event.");
  }

  if (mixpanel.reportUrl && !mixpanel.plannedOnly) {
    lines.push(`- [Open report](${mixpanel.reportUrl})`);
  }

  if (mixpanel.dashboardUrl && !mixpanel.plannedOnly) {
    lines.push(`- [Open dashboard](${mixpanel.dashboardUrl})`);
  }

  if (mixpanel.eventsUrl) {
    lines.push(`- [View event in Mixpanel Lexicon / Live view](${mixpanel.eventsUrl})`);
  } else {
    lines.push("- Configure `MIXPANEL_PROJECT_ID` and `MIXPANEL_WORKSPACE_ID` for direct Mixpanel links.");
  }

  lines.push("", `_File: \`${file}\`${event.line ? ` · line ${event.line}` : ""}_`);

  return lines.join("\n");
};

const listExistingReviewComments = async (
  context: IGitHubCommentContext,
): Promise<IGitHubReviewComment[]> => {
  const path = `/repos/${context.repo.owner}/${context.repo.repo}/pulls/${context.prNumber}/comments`;

  return githubRequest<IGitHubReviewComment[]>(context.token, path);
};

const deleteReviewComment = async (
  context: IGitHubCommentContext,
  commentId: number,
): Promise<void> => {
  const path = `/repos/${context.repo.owner}/${context.repo.repo}/pulls/comments/${commentId}`;

  await githubRequest(context.token, path, { method: "DELETE" });
};

const createReviewComment = async (
  context: IGitHubCommentContext,
  pullRequest: IPullRequestRef,
  file: string,
  line: number,
  body: string,
): Promise<void> => {
  const path = `/repos/${context.repo.owner}/${context.repo.repo}/pulls/${context.prNumber}/comments`;

  await githubRequest(context.token, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      body,
      commit_id: pullRequest.headSha,
      path: file,
      line,
      side: "RIGHT",
    }),
  });
};

export const collectReviewCommentTargets = (
  report: IInstrumentReport,
): Array<{ file: string; line: number; event: IInstrumentEvent }> => {
  if (report.newEvents.length === 0 || report.filesChanged.length === 0) {
    return [];
  }

  const newEventNames = new Set(report.newEvents);
  const changedFiles = new Set(report.filesChanged);
  const targets: Array<{ file: string; line: number; event: IInstrumentEvent }> = [];

  for (const page of report.pages) {
    if (!changedFiles.has(page.file)) {
      continue;
    }

    for (const event of page.events) {
      if (event.line && newEventNames.has(event.name)) {
        targets.push({ file: page.file, line: event.line, event });
      }
    }
  }

  return targets;
};

export const syncReviewComments = async (options: {
  context: IGitHubCommentContext;
  state: IProgressReporterState;
  mixpanelProjectId?: string;
  mixpanelWorkspaceId?: string;
}): Promise<{ posted: number; skipped: number }> => {
  const { context, state, mixpanelProjectId, mixpanelWorkspaceId } = options;

  if (!state.report) {
    return { posted: 0, skipped: 0 };
  }

  const targets = collectReviewCommentTargets(state.report);

  if (targets.length === 0) {
    return { posted: 0, skipped: 0 };
  }

  const headSha = await fetchPullRequestHeadSha(context);
  const existing = await listExistingReviewComments(context);

  for (const comment of existing) {
    if (comment.body.includes(REVIEW_MARKER)) {
      await deleteReviewComment(context, comment.id);
    }
  }

  let posted = 0;
  let skipped = 0;

  for (const target of targets) {
    const mixpanel = resolveEventMixpanelContext(
      target.event.name,
      state.dashboardPlan,
      state.deployResult,
      mixpanelProjectId,
      mixpanelWorkspaceId,
    );
    const body = buildReviewCommentBody(target.event, target.file, mixpanel);

    try {
      await createReviewComment(context, { headSha }, target.file, target.line, body);
      posted += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Review comment failed";

      if (message.includes("422")) {
        skipped += 1;
        continue;
      }

      throw error;
    }
  }

  return { posted, skipped };
};

export const buildMixpanelSectionForComment = (
  report: IInstrumentReport,
  dashboardPlan?: IDashboardPlan,
  deployResult?: IDeployDashboardPlanResult,
  mixpanelProjectId?: string,
  mixpanelWorkspaceId?: string,
): string[] => {
  const lines: string[] = ["### Mixpanel mapping", ""];

  for (const eventName of report.newEvents) {
    const mixpanel = resolveEventMixpanelContext(
      eventName,
      dashboardPlan,
      deployResult,
      mixpanelProjectId,
      mixpanelWorkspaceId,
    );

    lines.push(`**\`${eventName}\`**`);

    if (mixpanel.reportName) {
      lines.push(
        `- ${mixpanel.plannedOnly ? "Planned" : "Deployed"} report: ${mixpanel.reportName}`,
      );
    }

    if (mixpanel.reportUrl && !mixpanel.plannedOnly) {
      lines.push(`- [Report link](${mixpanel.reportUrl})`);
    }

    if (mixpanel.eventsUrl) {
      lines.push(`- [Event in Mixpanel](${mixpanel.eventsUrl})`);
    }

    lines.push("");
  }

  return lines;
};

export const buildBotIdentityNote = (): string =>
  "_Justifications from the Cursor Cloud Agent report. GitHub posts these via Instrument orchestration._";
