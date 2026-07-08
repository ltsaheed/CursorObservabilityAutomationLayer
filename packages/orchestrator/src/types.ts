import { z } from "zod";

export const instrumentConfigSchema = z.object({
  framework: z.string(),
  paths: z.object({
    pages: z.string(),
    routes: z.string().optional(),
    analytics: z.string(),
    entry: z.string().optional(),
  }),
  analytics: z.object({
    wrapper: z.object({
      module: z.string(),
      initFunction: z.string(),
      trackFunction: z.string(),
    }),
    requiredEvents: z.object({
      pageView: z.string(),
      userAction: z.string(),
    }),
    propertyConventions: z.record(z.string()).optional(),
  }),
  env: z.record(z.string()).optional(),
  scan: z
    .object({
      includeGlobs: z.array(z.string()).optional(),
      excludeGlobs: z.array(z.string()).optional(),
    })
    .optional(),
  mixpanel: z
    .object({
      dashboardName: z.string().optional(),
    })
    .optional(),
});

export type IInstrumentConfig = z.infer<typeof instrumentConfigSchema>;

export const coverageGapKindSchema = z.enum([
  "missing_page_view",
  "missing_track_import",
  "onclick_without_track",
  "handler_without_track",
  "route_without_page",
]);

export const coverageGapSchema = z.object({
  file: z.string(),
  line: z.number().optional(),
  kind: coverageGapKindSchema,
  description: z.string(),
  pageName: z.string().optional(),
});

export const analyticsCatalogSchema = z.object({
  module: z.string(),
  helpers: z.array(z.string()),
  trackingHelpers: z.array(z.string()),
  hasTrackPageView: z.boolean(),
  hasTrackAction: z.boolean(),
});

export type IAnalyticsCatalog = z.infer<typeof analyticsCatalogSchema>;

export const deduplicationDecisionSchema = z.object({
  choice: z.enum(["reuse", "extend", "create", "inline"]),
  helper: z.string().optional(),
  reason: z.string(),
});

export type IDeduplicationDecision = z.infer<typeof deduplicationDecisionSchema>;

export const coverageAssessmentSchema = z.object({
  scannedFiles: z.array(z.string()),
  gaps: z.array(coverageGapSchema),
  summary: z.string(),
  analyticsCatalog: analyticsCatalogSchema.optional(),
});

export type ICoverageGap = z.infer<typeof coverageGapSchema>;
export type ICoverageAssessment = z.infer<typeof coverageAssessmentSchema>;

export const instrumentEventSchema = z.object({
  name: z.string(),
  properties: z.record(
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
  trigger: z.string(),
  line: z.number().optional(),
  justification: z.string().optional(),
});

export const instrumentPageSchema = z.object({
  name: z.string(),
  file: z.string(),
  events: z.array(instrumentEventSchema),
});

export const instrumentReportSchema = z.object({
  version: z.literal("1"),
  prSummary: z.string(),
  pages: z.array(instrumentPageSchema),
  newEvents: z.array(z.string()),
  filesChanged: z.array(z.string()),
  helpersUsed: z.array(z.string()).default([]),
  helpersCreated: z.array(z.string()).default([]),
  deduplicationDecisions: z.array(deduplicationDecisionSchema).default([]),
});

export type IInstrumentEvent = z.infer<typeof instrumentEventSchema>;
export type IInstrumentPage = z.infer<typeof instrumentPageSchema>;
export type IInstrumentReport = z.infer<typeof instrumentReportSchema>;

export const dashboardPlanDecisionSchema = z.object({
  summary: z.string(),
  reason: z.string(),
});

export const insightsReportPlanSchema = z.object({
  type: z.literal("insights"),
  name: z.string(),
  description: z.string(),
  event: z.string(),
  breakdown: z.string().optional(),
  reason: z.string(),
});

export const funnelsReportPlanSchema = z.object({
  type: z.literal("funnels"),
  name: z.string(),
  description: z.string(),
  steps: z.array(z.string()).min(2),
  reason: z.string(),
});

export const reportPlanSchema = z.discriminatedUnion("type", [
  insightsReportPlanSchema,
  funnelsReportPlanSchema,
]);

export const dashboardPlanSchema = z.object({
  decisions: z.array(dashboardPlanDecisionSchema),
  reports: z.array(reportPlanSchema),
});

export type IDashboardPlanDecision = z.infer<typeof dashboardPlanDecisionSchema>;
export type IInsightsReportPlan = z.infer<typeof insightsReportPlanSchema>;
export type IFunnelsReportPlan = z.infer<typeof funnelsReportPlanSchema>;
export type IReportPlan = z.infer<typeof reportPlanSchema>;
export type IDashboardPlan = z.infer<typeof dashboardPlanSchema>;

export const runOptionsSchema = z.object({
  config: z.string(),
  repo: z.string().optional(),
  prNumber: z.coerce.number().optional(),
  prUrl: z.string().optional(),
  workspaceRoot: z.string(),
  dryRun: z.boolean().default(false),
  reportsOnly: z.boolean().default(false),
  skipCodeAgent: z.boolean().default(false),
  changedFiles: z.array(z.string()).optional(),
});


export const standardsReviewIssueSchema = z.object({
  severity: z.enum(["error", "warning"]),
  file: z.string(),
  line: z.number().optional(),
  rule: z.string(),
  message: z.string(),
  suggestion: z.string(),
});

export const standardsReviewResultSchema = z.object({
  passed: z.boolean(),
  issues: z.array(standardsReviewIssueSchema),
  summary: z.string(),
  decisions: z.array(dashboardPlanDecisionSchema),
});

export type IStandardsReviewIssue = z.infer<typeof standardsReviewIssueSchema>;
export type IStandardsReviewResult = z.infer<typeof standardsReviewResultSchema>;

export interface ICodeAgentResult {
  report: IInstrumentReport;
  agentId?: string;
}

export type IRunOptions = z.infer<typeof runOptionsSchema>;

export const deployedReportSchema = z.object({
  plan: reportPlanSchema,
  bookmarkId: z.number(),
  reportUrl: z.string(),
});

export const deployResultSchema = z.object({
  dashboardId: z.number(),
  dashboardUrl: z.string(),
  reports: z.array(deployedReportSchema),
  createdDashboard: z.boolean(),
});

export const finalResultSchema = z.object({
  assessment: coverageAssessmentSchema,
  report: instrumentReportSchema.optional(),
  standardsReview: standardsReviewResultSchema.optional(),
  dashboardPlan: dashboardPlanSchema.optional(),
  deployResult: deployResultSchema.optional(),
  commentUrl: z.string().optional(),
  dryRun: z.boolean().optional(),
});

export type IFinalResult = z.infer<typeof finalResultSchema>;

export const mixpanelEnvConfigSchema = z.object({
  serviceAccountUsername: z.string(),
  serviceAccountSecret: z.string(),
  projectId: z.string(),
  workspaceId: z.string(),
  dashboardId: z.string().optional(),
});

export type IMixpanelEnvConfig = z.infer<typeof mixpanelEnvConfigSchema>;

export type IProgressPhase =
  | "pre-scan"
  | "code-agent"
  | "standards-review"
  | "dashboard-agent"
  | "mixpanel-deploy"
  | "github-comment";

export interface IProgressDecision {
  label: string;
  detail: string;
}

export interface IProgressLogEntry {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: string;
}

export interface IProgressStreamSnippet {
  text: string;
  timestamp: string;
}

export interface IProgressPhaseState {
  name: IProgressPhase;
  status: "running" | "complete" | "skipped" | "failed";
  startedAt: string;
  completedAt?: string;
  decisions: IProgressDecision[];
  logs: IProgressLogEntry[];
  streamSnippets: IProgressStreamSnippet[];
}

export interface IProgressReporterState {
  phases: IProgressPhaseState[];
  summaryLines: string[];
  assessment?: ICoverageAssessment;
  report?: IInstrumentReport;
  standardsReview?: IStandardsReviewResult;
  dashboardPlan?: IDashboardPlan;
  deployResult?: z.infer<typeof deployResultSchema>;
  runMetadata?: IRunMetadata;
  runHistory?: IRunHistoryEntry[];
}

export interface IRunMetadata {
  runId: string;
  runUrl: string;
  runAttempt: string;
  updatedAt: string;
  overallStatus: "passed" | "failed" | "partial";
}

export interface IRunHistoryEntry {
  runId: string;
  runUrl: string;
  status: "passed" | "failed" | "partial";
  updatedAt: string;
}

export interface IProgressReporter {
  phaseStart: (phase: IProgressPhase) => void;
  decision: (phase: IProgressPhase, label: string, detail: string) => void;
  log: (phase: IProgressPhase, message: string, level?: "info" | "warn" | "error") => void;
  streamEvent: (phase: IProgressPhase, event: unknown) => void;
  phaseComplete: (phase: IProgressPhase, status?: "complete" | "skipped" | "failed") => void;
  setAssessment: (assessment: ICoverageAssessment) => void;
  setReport: (report: IInstrumentReport) => void;
  setStandardsReview: (review: IStandardsReviewResult) => void;
  setDashboardPlan: (plan: IDashboardPlan) => void;
  setDeployResult: (result: z.infer<typeof deployResultSchema>) => void;
  setRunMetadata: (metadata: IRunMetadata) => void;
  setRunHistory: (history: IRunHistoryEntry[]) => void;
  appendSummaryLine: (line: string) => void;
  getState: () => IProgressReporterState;
  finalize: () => Promise<void>;
}
