import type { IDeployDashboardPlanResult } from "@instrument/mixpanel-client";

import type { IDashboardPlan, IProgressReporterState, IProgressPhaseState } from "./types.js";
import type { IRunHistoryEntry } from "./types.js";
import { getPhaseDescription } from "./phaseDescriptions.js";
import { formatPhaseDuration, resolvePhaseAgentLabel } from "./phaseUtils.js";
import { buildMixpanelSectionForComment } from "./reviewComments.js";

export const BOT_MARKER = "<!-- instrument-bot -->";
export const RUN_HISTORY_MARKER_PREFIX = "<!-- instrument-run-history:";
export const MAX_RUN_HISTORY = 8;

export interface IGitHubRepoRef {
  owner: string;
  repo: string;
}

export interface IGitHubCommentContext {
  token: string;
  repo: IGitHubRepoRef;
  prNumber: number;
}

interface IGitHubComment {
  id: number;
  body: string;
  user?: { login?: string };
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

export const parseRepoSlug = (repoSlug: string): IGitHubRepoRef => {
  const [owner, repo] = repoSlug.split("/");

  if (!owner || !repo) {
    throw new Error(`Invalid repo slug: ${repoSlug}`);
  }

  return { owner, repo };
};

export const buildFileLink = (
  repo: IGitHubRepoRef,
  prNumber: number,
  file: string,
  line?: number,
): string => {
  const anchor = line ? `#L${line}` : "";

  return `https://github.com/${repo.owner}/${repo.repo}/pull/${prNumber}/files#diff-${encodeURIComponent(file)}${anchor}`;
};

const phaseStatusEmoji = (status: string): string => {
  if (status === "complete") {
    return "✅";
  }

  if (status === "skipped") {
    return "⏭️";
  }

  if (status === "failed") {
    return "❌";
  }

  return "🔄";
};

export const computeOverallStatus = (
  state: IProgressReporterState,
): "passed" | "failed" | "partial" => {
  const failedPhase = state.phases.some((phase) => phase.status === "failed");

  if (failedPhase || state.standardsReview?.passed === false) {
    return "failed";
  }

  const requiredPhases = ["pre-scan", "code-agent"] as const;
  const allRequiredComplete = requiredPhases.every((name) =>
    state.phases.some((phase) => phase.name === name && phase.status === "complete"),
  );

  if (allRequiredComplete && state.standardsReview?.passed === true) {
    return "passed";
  }

  return "partial";
};

const overallStatusLabel = (status: "passed" | "failed" | "partial"): string => {
  if (status === "passed") {
    return "**PASSED**";
  }

  if (status === "failed") {
    return "**FAILED**";
  }

  return "**PARTIAL**";
};

export const parseRunHistoryFromComment = (body: string): IRunHistoryEntry[] => {
  const match = body.match(/<!-- instrument-run-history:([\s\S]*?) -->/);

  if (!match?.[1]) {
    return [];
  }

  try {
    const parsed = JSON.parse(match[1]) as IRunHistoryEntry[];

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const appendRunHistory = (
  previous: IRunHistoryEntry[],
  entry: IRunHistoryEntry,
): IRunHistoryEntry[] => {
  const deduped = previous.filter((item) => item.runId !== entry.runId);

  return [entry, ...deduped].slice(0, MAX_RUN_HISTORY);
};

export const serializeRunHistory = (history: IRunHistoryEntry[]): string => {
  return `${RUN_HISTORY_MARKER_PREFIX}${JSON.stringify(history)} -->`;
};

const renderPhaseDetails = (phase: IProgressPhaseState): string[] => {
  const lines: string[] = [];

  if (phase.decisions.length === 0 && phase.logs.length === 0 && phase.streamSnippets.length === 0) {
    return lines;
  }

  lines.push(`<details><summary>${phase.name} details</summary>`, "");

  for (const decision of phase.decisions) {
    lines.push(`- **${decision.label}**: ${decision.detail}`);
  }

  for (const log of phase.logs.slice(-5)) {
    lines.push(`- _${log.level}_ (${log.timestamp}): ${log.message}`);
  }

  if (phase.streamSnippets.length > 0) {
    lines.push("", "**Agent stream**");

    for (const snippet of phase.streamSnippets) {
      lines.push(`- \`${snippet.text}\``);
    }
  }

  lines.push("", "</details>", "");

  return lines;
};

export const renderPhaseTimeline = (state: IProgressReporterState): string[] => {
  const lines = [
    "### Run timeline",
    "| Phase | Status | Duration | Agent / Run ID |",
    "| --- | --- | --- | --- |",
  ];

  for (const phase of state.phases) {
    const { title, subtitle } = getPhaseDescription(phase.name);

    lines.push(
      `| ${title}<br><sub>${subtitle}</sub> | ${phaseStatusEmoji(phase.status)} ${phase.status} | ${formatPhaseDuration(phase)} | ${resolvePhaseAgentLabel(phase.name, state.codeAgentId)} |`,
    );
  }

  lines.push("");

  for (const phase of state.phases) {
    lines.push(...renderPhaseDetails(phase));
  }

  return lines;
};

export const buildMixpanelBoardsSection = (
  deployResult?: IDeployDashboardPlanResult,
  dashboardPlan?: IDashboardPlan,
): string[] => {
  if (deployResult) {
    const lines = [
      "### Mixpanel boards",
      `- **[Open dashboard](${deployResult.dashboardUrl})** (board \`${deployResult.dashboardId}\`)`,
      "",
      "**Reports on this board:**",
    ];

    for (const report of deployResult.reports) {
      lines.push(`- [${report.plan.name}](${report.reportUrl})`);
    }

    lines.push("");

    return lines;
  }

  if (dashboardPlan && dashboardPlan.reports.length > 0) {
    return [
      "### Mixpanel boards",
      "Deploy did not run or was skipped. Planned reports:",
      ...dashboardPlan.reports.map((report) => `- ${report.name} (${report.type})`),
      "",
    ];
  }

  return [];
};

export const renderCommentBody = (
  state: IProgressReporterState,
  mixpanel?: { projectId?: string; workspaceId?: string; region?: "us" | "eu" | "in" },
): string => {
  const lines: string[] = [BOT_MARKER, "## Instrument PR Report", ""];

  if (state.runMetadata) {
    lines.push(
      `**Latest run:** ${overallStatusLabel(state.runMetadata.overallStatus)} · [Workflow #${state.runMetadata.runId}](${state.runMetadata.runUrl}) · attempt ${state.runMetadata.runAttempt} · ${state.runMetadata.updatedAt}`,
      "",
    );
  }

  if (state.runHistory && state.runHistory.length > 1) {
    lines.push("### Recent runs", "| Status | Workflow | Updated |", "| --- | --- | --- |");

    for (const run of state.runHistory.slice(0, MAX_RUN_HISTORY)) {
      lines.push(
        `| ${overallStatusLabel(run.status)} | [Run #${run.runId}](${run.runUrl}) | ${run.updatedAt} |`,
      );
    }

    lines.push("");
  }

  lines.push(
    "### Cursor agents",
    "- **Code Agent** — Cursor Cloud Agent on this PR (instrumentation commits + `.instrument/report.json`)",
  );

  if (state.codeAgentId) {
    lines.push(`- Cloud Agent ID: \`${state.codeAgentId}\``);
  }

  lines.push(
    "- **Review Agent** — checks instrumentation against org analytics standards (independent from the Code Agent)",
    "- **Dashboard Agent** — Cursor SDK Mixpanel report planning",
    "",
  );

  if (state.assessment) {
    lines.push("### Pre-scan", state.assessment.summary, "");

    if (state.assessment.gaps.length > 0) {
      lines.push("| File | Gap |", "| --- | --- |");

      for (const gap of state.assessment.gaps.slice(0, 20)) {
        lines.push(`| \`${gap.file}\` | ${gap.description} |`);
      }

      lines.push("");
    }
  }

  lines.push(...renderPhaseTimeline(state));

  if (state.report) {
    lines.push("### Instrumentation summary", state.report.prSummary, "");
    lines.push("**New events**");

    for (const eventName of state.report.newEvents) {
      lines.push(`- \`${eventName}\``);
    }

    if (state.report.helpersUsed.length > 0) {
      lines.push("**Helpers used**");

      for (const helper of state.report.helpersUsed) {
        lines.push(`- \`${helper}\``);
      }

      lines.push("");
    }

    if (state.report.deduplicationDecisions.length > 0) {
      lines.push("**Deduplication decisions**");

      for (const decision of state.report.deduplicationDecisions) {
        lines.push(`- ${decision.choice}${decision.helper ? ` (${decision.helper})` : ""}: ${decision.reason}`);
      }

      lines.push("");
    }

    lines.push("");
  }


  if (state.standardsReview) {
    lines.push(
      "### Standards review",
      state.standardsReview.passed ? "**PASSED**" : "**FAILED**",
      state.standardsReview.summary,
      "",
    );

    if (state.standardsReview.issues.length > 0) {
      lines.push("| File | Rule | Message |", "| --- | --- | --- |");

      for (const issue of state.standardsReview.issues.slice(0, 20)) {
        lines.push(`| \`${issue.file}\` | ${issue.rule} | ${issue.message} |`);
      }

      lines.push("");
    }

    if (state.standardsReview.passed) {
      lines.push(
        "_Awaiting human reviewer approval — Instrument does not auto-merge._",
        "",
      );
    }
  }

  lines.push(...buildMixpanelBoardsSection(state.deployResult, state.dashboardPlan));

  if (state.dashboardPlan) {
    lines.push("### Dashboard plan");

    for (const decision of state.dashboardPlan.decisions) {
      lines.push(`- ${decision.summary}: ${decision.reason}`);
    }

    lines.push("");

    for (const report of state.dashboardPlan.reports) {
      lines.push(`- ${report.name} (${report.type})`);
    }

    lines.push("");
  }

  if (state.report && state.dashboardPlan && state.report.newEvents.length > 0 && !state.deployResult) {
    lines.push(
      ...buildMixpanelSectionForComment(
        state.report,
        state.dashboardPlan,
        state.deployResult,
        mixpanel?.projectId,
        mixpanel?.workspaceId,
        mixpanel?.region,
      ),
    );
  }

  if (state.summaryLines.length > 0) {
    lines.push("### Notes");

    for (const line of state.summaryLines) {
      lines.push(`- ${line}`);
    }

    lines.push("");
  }

  lines.push("_Updated by Instrument · instrumentation via Cursor Cloud Agent._");

  if (state.runHistory && state.runHistory.length > 0) {
    lines.push("", serializeRunHistory(state.runHistory));
  }

  return lines.join("\n");
};

export const listIssueComments = async (
  context: IGitHubCommentContext,
): Promise<IGitHubComment[]> => {
  const comments: IGitHubComment[] = [];
  let page = 1;

  while (page <= 10) {
    const path = `/repos/${context.repo.owner}/${context.repo.repo}/issues/${context.prNumber}/comments?per_page=100&page=${page}`;
    const batch = await githubRequest<IGitHubComment[]>(context.token, path);

    if (batch.length === 0) {
      break;
    }

    comments.push(...batch);
    page += 1;
  }

  return comments;
};

export const findInstrumentComment = (
  comments: IGitHubComment[],
): IGitHubComment | undefined => {
  return comments.find((comment) => comment.body.includes(BOT_MARKER));
};

export const findOrCreateComment = async (
  context: IGitHubCommentContext,
  body: string,
): Promise<{ commentId: number; url: string; previousBody?: string }> => {
  const comments = await listIssueComments(context);
  const existing = findInstrumentComment(comments);

  if (existing) {
    return {
      commentId: existing.id,
      url: `https://github.com/${context.repo.owner}/${context.repo.repo}/pull/${context.prNumber}#issuecomment-${existing.id}`,
      previousBody: existing.body,
    };
  }

  const commentsPath = `/repos/${context.repo.owner}/${context.repo.repo}/issues/${context.prNumber}/comments`;
  const created = await githubRequest<IGitHubComment>(context.token, commentsPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });

  return {
    commentId: created.id,
    url: `https://github.com/${context.repo.owner}/${context.repo.repo}/pull/${context.prNumber}#issuecomment-${created.id}`,
  };
};

export const updateComment = async (
  context: IGitHubCommentContext,
  commentId: number,
  body: string,
): Promise<void> => {
  const path = `/repos/${context.repo.owner}/${context.repo.repo}/issues/comments/${commentId}`;

  await githubRequest(context.token, path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
};

export const syncPrComment = async (
  context: IGitHubCommentContext,
  state: IProgressReporterState,
  mixpanel?: { projectId?: string; workspaceId?: string; region?: "us" | "eu" | "in" },
): Promise<string> => {
  const { commentId, url, previousBody } = await findOrCreateComment(context, BOT_MARKER);

  const overallStatus = state.runMetadata?.overallStatus ?? computeOverallStatus(state);
  const runMetadata = state.runMetadata ?? {
    runId: "local",
    runUrl: "#",
    runAttempt: "1",
    updatedAt: new Date().toISOString(),
    overallStatus,
  };

  const previousHistory = previousBody ? parseRunHistoryFromComment(previousBody) : [];
  const runHistory = appendRunHistory(previousHistory, {
    runId: runMetadata.runId,
    runUrl: runMetadata.runUrl,
    status: overallStatus,
    updatedAt: runMetadata.updatedAt,
  });

  const body = renderCommentBody(
    {
      ...state,
      runMetadata: { ...runMetadata, overallStatus },
      runHistory,
    },
    mixpanel,
  );

  await updateComment(context, commentId, body);

  return url;
};
