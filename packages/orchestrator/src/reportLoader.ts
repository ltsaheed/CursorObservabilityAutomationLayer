import type { IGitHubCommentContext } from "./github.js";
import { fetchPullRequestHeadSha } from "./reviewComments.js";
import type { IInstrumentReport } from "./types.js";
import { instrumentReportSchema } from "./types.js";

export const REPORT_RELATIVE_PATH = ".instrument/report.json";

const GITHUB_API_BASE = "https://api.github.com";
const FETCH_RETRY_ATTEMPTS = 6;
const FETCH_RETRY_DELAY_MS = 5000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const githubRequest = async <T>(
  token: string,
  path: string,
): Promise<T> => {
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(`GitHub API ${response.status}: ${body}`);
  }

  return (await response.json()) as T;
};

interface IGithubContentFile {
  content?: string;
  encoding?: string;
}

export const normalizeReportPayload = (
  parsed: Record<string, unknown>,
): Record<string, unknown> => {
  return {
    version: "1",
    prSummary: typeof parsed.prSummary === "string" ? parsed.prSummary : "",
    pages: Array.isArray(parsed.pages) ? parsed.pages : [],
    newEvents: Array.isArray(parsed.newEvents) ? parsed.newEvents : [],
    filesChanged: Array.isArray(parsed.filesChanged) ? parsed.filesChanged : [],
    helpersUsed: Array.isArray(parsed.helpersUsed) ? parsed.helpersUsed : [],
    helpersCreated: Array.isArray(parsed.helpersCreated) ? parsed.helpersCreated : [],
    deduplicationDecisions: Array.isArray(parsed.deduplicationDecisions)
      ? parsed.deduplicationDecisions
      : [],
  };
};

export const parseInstrumentReportJson = (
  raw: string,
): { report: IInstrumentReport | null; error?: string } => {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const normalized = normalizeReportPayload(parsed);

    return { report: instrumentReportSchema.parse(normalized) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid report JSON";

    return { report: null, error: message };
  }
};

const decodeGithubContent = (file: IGithubContentFile): string | null => {
  if (!file.content || file.encoding !== "base64") {
    return null;
  }

  return Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
};

export const fetchReportFromPullRequest = async (
  context: IGitHubCommentContext,
  filePath: string = REPORT_RELATIVE_PATH,
): Promise<{ raw: string | null; ref: string }> => {
  const ref = await fetchPullRequestHeadSha(context);
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= FETCH_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const path = `/repos/${context.repo.owner}/${context.repo.repo}/contents/${encodedPath}?ref=${ref}`;
      const file = await githubRequest<IGithubContentFile>(context.token, path);
      const raw = decodeGithubContent(file);

      if (raw) {
        return { raw, ref };
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("GitHub fetch failed");

      if (attempt < FETCH_RETRY_ATTEMPTS) {
        await sleep(FETCH_RETRY_DELAY_MS);
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  return { raw: null, ref };
};

export const extractReportCandidatesFromText = (text: string): string[] => {
  const candidates: string[] = [];

  const fencedMatches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];

  for (const match of fencedMatches) {
    if (match[1]?.includes('"version"')) {
      candidates.push(match[1].trim());
    }
  }

  const inlineMatches = [...text.matchAll(/\{[\s\S]*?"version"\s*:\s*"1"[\s\S]*?\}/g)];

  for (const match of inlineMatches) {
    candidates.push(match[0]);
  }

  return candidates;
};

export const extractReportFromAgentResult = (
  resultText: string,
): { report: IInstrumentReport | null; error?: string } => {
  const candidates = extractReportCandidatesFromText(resultText);

  for (const candidate of candidates) {
    const parsed = parseInstrumentReportJson(candidate);

    if (parsed.report) {
      return parsed;
    }
  }

  return {
    report: null,
    error: candidates.length > 0 ? "Report JSON found but failed schema validation" : "No report JSON in agent result",
  };
};

export interface ILoadInstrumentReportOptions {
  workspaceRoot: string;
  agentResultText?: string;
  github?: IGitHubCommentContext;
}

export const loadInstrumentReport = async (
  options: ILoadInstrumentReportOptions,
): Promise<{
  report: IInstrumentReport | null;
  source?: "workspace" | "github" | "agent-result";
  errors: string[];
}> => {
  const errors: string[] = [];

  try {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const raw = readFileSync(join(options.workspaceRoot, REPORT_RELATIVE_PATH), "utf8");
    const parsed = parseInstrumentReportJson(raw);

    if (parsed.report) {
      return { report: parsed.report, source: "workspace", errors };
    }

    if (parsed.error) {
      errors.push(`workspace: ${parsed.error}`);
    }
  } catch {
    errors.push("workspace: file not found");
  }

  if (options.github) {
    try {
      const { raw, ref } = await fetchReportFromPullRequest(options.github);

      if (raw) {
        const parsed = parseInstrumentReportJson(raw);

        if (parsed.report) {
          return { report: parsed.report, source: "github", errors };
        }

        if (parsed.error) {
          errors.push(`github@${ref}: ${parsed.error}`);
        }
      } else {
        errors.push(`github@${ref}: empty file`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub fetch failed";
      errors.push(`github: ${message}`);
    }
  }

  if (options.agentResultText) {
    const parsed = extractReportFromAgentResult(options.agentResultText);

    if (parsed.report) {
      return { report: parsed.report, source: "agent-result", errors };
    }

    if (parsed.error) {
      errors.push(`agent-result: ${parsed.error}`);
    }
  }

  return { report: null, errors };
};
