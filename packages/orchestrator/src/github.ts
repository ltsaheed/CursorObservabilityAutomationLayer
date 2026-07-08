import type { IProgressReporterState } from "./types.js";

export const BOT_MARKER = "<!-- instrument-bot -->";

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

export const renderCommentBody = (state: IProgressReporterState): string => {
  const lines: string[] = [BOT_MARKER, "## Instrument PR Report", ""];

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

  lines.push("### Pipeline phases");

  for (const phase of state.phases) {
    lines.push(
      `- ${phaseStatusEmoji(phase.status)} **${phase.name}** (${phase.status})`,
    );

    for (const decision of phase.decisions) {
      lines.push(`  - ${decision.label}: ${decision.detail}`);
    }
  }

  lines.push("");

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

  if (state.deployResult) {
    lines.push(
      "### Mixpanel deployment",
      `- Dashboard: [open](${state.deployResult.dashboardUrl})`,
    );

    for (const report of state.deployResult.reports) {
      lines.push(`- ${report.plan.name}: [report](${report.reportUrl})`);
    }

    lines.push("");
  }

  if (state.summaryLines.length > 0) {
    lines.push("### Notes");

    for (const line of state.summaryLines) {
      lines.push(`- ${line}`);
    }

    lines.push("");
  }

  lines.push("_Updated by Instrument bot._");

  return lines.join("\n");
};

export const findOrCreateComment = async (
  context: IGitHubCommentContext,
  body: string,
): Promise<{ commentId: number; url: string }> => {
  const commentsPath = `/repos/${context.repo.owner}/${context.repo.repo}/issues/${context.prNumber}/comments`;
  const comments = await githubRequest<IGitHubComment[]>(
    context.token,
    commentsPath,
  );

  const existing = comments.find((comment) => comment.body.includes(BOT_MARKER));

  if (existing) {
    return {
      commentId: existing.id,
      url: `https://github.com/${context.repo.owner}/${context.repo.repo}/pull/${context.prNumber}#issuecomment-${existing.id}`,
    };
  }

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
): Promise<string> => {
  const body = renderCommentBody(state);
  const { commentId, url } = await findOrCreateComment(context, body);

  await updateComment(context, commentId, body);

  return url;
};
