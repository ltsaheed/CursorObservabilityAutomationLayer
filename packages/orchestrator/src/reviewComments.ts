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
import {
  collectReviewCommentBlockTargets,
  type IReviewCommentBlockTarget,
} from "./reviewCommentBlocks.js";

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

export const buildChangeBlockCommentBody = (
  block: IReviewCommentBlockTarget,
  mixpanelByEvent: Map<string, IEventMixpanelContext>,
): string => {
  const eventNames = block.events.map((event) => event.name);
  const titleEvents =
    eventNames.length > 0
      ? eventNames.map((name) => `\`${name}\``).join(", ")
      : "instrumentation change";
  const lines: string[] = [
    REVIEW_MARKER,
    `**Instrument** · ${titleEvents} · _Cursor Cloud Agent_`,
    "",
    "**Why this change**",
    block.justification,
    "",
  ];

  if (block.events.length > 0) {
    lines.push("**Events in this change**");

    for (const event of block.events) {
      lines.push(`- \`${event.name}\` (${event.trigger})`);

      const propertyEntries = Object.entries(event.properties);

      if (propertyEntries.length > 0) {
        lines.push("  - Properties:");

        for (const [key, value] of propertyEntries) {
          lines.push(`    - \`${key}\`: ${String(value)}`);
        }
      }
    }

    lines.push("");
  }

  lines.push("**Where it appears in Mixpanel**");

  if (block.events.length === 0) {
    lines.push("- Helper or module change — no new tracked event in this block.");
  }

  for (const event of block.events) {
    const mixpanel = mixpanelByEvent.get(event.name);

    if (!mixpanel) {
      continue;
    }

    lines.push(`- \`${event.name}\`:`);

    if (mixpanel.reportName) {
      const status = mixpanel.plannedOnly ? "Planned report" : "Report";
      lines.push(`  - ${status}: **${mixpanel.reportName}** (${mixpanel.reportType ?? "insights"})`);
    } else {
      lines.push("  - No dashboard report mapped yet.");
    }

    if (mixpanel.reportUrl && !mixpanel.plannedOnly) {
      lines.push(`  - [Open report](${mixpanel.reportUrl})`);
    }

    if (mixpanel.eventsUrl) {
      lines.push(`  - [View event in Mixpanel](${mixpanel.eventsUrl})`);
    }
  }

  if (block.events.length > 0 && !mixpanelByEvent.size) {
    lines.push("- Configure `MIXPANEL_PROJECT_ID` and `MIXPANEL_WORKSPACE_ID` for direct Mixpanel links.");
  }

  const lineLabel =
    block.startLine === block.endLine
      ? `line ${block.startLine}`
      : `lines ${block.startLine}-${block.endLine}`;

  lines.push("", `_File: \`${block.file}\` · ${lineLabel}_`);

  return lines.join("\n");
};

/** @deprecated Use buildChangeBlockCommentBody */
export const buildReviewCommentBody = (
  event: IInstrumentEvent,
  file: string,
  mixpanel: IEventMixpanelContext,
): string =>
  buildChangeBlockCommentBody(
    {
      file,
      startLine: event.line ?? 1,
      endLine: event.line ?? 1,
      justification: event.justification ?? event.trigger,
      events: [event],
    },
    new Map([[event.name, mixpanel]]),
  );

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
  block: IReviewCommentBlockTarget,
  body: string,
): Promise<void> => {
  const path = `/repos/${context.repo.owner}/${context.repo.repo}/pulls/${context.prNumber}/comments`;
  const payload: Record<string, string | number> = {
    body,
    commit_id: pullRequest.headSha,
    path: block.file,
    side: "RIGHT",
    line: block.endLine,
  };

  if (block.startLine < block.endLine) {
    payload.start_line = block.startLine;
  }

  await githubRequest(context.token, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
};

export { collectReviewCommentBlockTargets } from "./reviewCommentBlocks.js";
export { collectReviewCommentTargets } from "./reviewCommentBlocks.js";

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

  const targets = collectReviewCommentBlockTargets(state.report);

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

  for (const block of targets) {
    const mixpanelByEvent = new Map<string, IEventMixpanelContext>();

    for (const event of block.events) {
      mixpanelByEvent.set(
        event.name,
        resolveEventMixpanelContext(
          event.name,
          state.dashboardPlan,
          state.deployResult,
          mixpanelProjectId,
          mixpanelWorkspaceId,
        ),
      );
    }

    const body = buildChangeBlockCommentBody(block, mixpanelByEvent);

    try {
      await createReviewComment(context, { headSha }, block, body);
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
