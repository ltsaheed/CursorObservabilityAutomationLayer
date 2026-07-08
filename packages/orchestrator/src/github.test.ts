import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  appendRunHistory,
  buildInstrumentationEventsSection,
  buildMixpanelBoardsSection,
  computeOverallStatus,
  parseRunHistoryFromComment,
  renderCommentBody,
  renderPhaseTimeline,
} from "./github.js";
import type { IDashboardPlan, IProgressReporterState } from "./types.js";

describe("packages/orchestrator/src/github.ts", () => {
  test("given failed phase this should compute failed overall status", () => {
    const state: IProgressReporterState = {
      phases: [
        { name: "pre-scan", status: "complete", startedAt: "", decisions: [], logs: [], streamSnippets: [] },
        { name: "code-agent", status: "failed", startedAt: "", decisions: [], logs: [], streamSnippets: [] },
      ],
      summaryLines: [],
    };

    assert.equal(computeOverallStatus(state), "failed");
  });

  test("given passed review this should compute passed overall status", () => {
    const state: IProgressReporterState = {
      phases: [
        { name: "pre-scan", status: "complete", startedAt: "", decisions: [], logs: [], streamSnippets: [] },
        { name: "code-agent", status: "complete", startedAt: "", decisions: [], logs: [], streamSnippets: [] },
      ],
      summaryLines: [],
      standardsReview: {
        passed: true,
        issues: [],
        summary: "ok",
        decisions: [],
      },
    };

    assert.equal(computeOverallStatus(state), "passed");
  });

  test("given run history marker this should parse previous runs", () => {
    const body = `<!-- instrument-bot -->\n<!-- instrument-run-history:[{"runId":"1","runUrl":"https://example.com","status":"failed","updatedAt":"t1"}] -->`;
    const history = parseRunHistoryFromComment(body);

    assert.equal(history.length, 1);
    assert.equal(history[0]?.runId, "1");
  });

  test("given new run this should prepend run history", () => {
    const history = appendRunHistory(
      [{ runId: "1", runUrl: "u1", status: "failed", updatedAt: "t1" }],
      { runId: "2", runUrl: "u2", status: "passed", updatedAt: "t2" },
    );

    assert.equal(history[0]?.runId, "2");
    assert.equal(history[1]?.runId, "1");
  });

  test("given phase timeline this should render run timeline table", () => {
    const lines = renderPhaseTimeline({
      phases: [
        {
          name: "pre-scan",
          status: "complete",
          startedAt: "2026-07-08T12:00:00.000Z",
          completedAt: "2026-07-08T12:00:01.000Z",
          decisions: [{ label: "Assessment", detail: "1 gap found" }],
          logs: [],
          streamSnippets: [],
        },
        {
          name: "code-agent/resume-1",
          status: "complete",
          startedAt: "2026-07-08T12:02:00.000Z",
          completedAt: "2026-07-08T12:02:45.000Z",
          decisions: [{ label: "Resume target", detail: "`agent-abc`" }],
          logs: [],
          streamSnippets: [],
        },
      ],
      summaryLines: [],
      codeAgentId: "bc-e39a7c9c-5321-47a5-9440-7783e721d04f",
    });
    const body = lines.join("\n");

    assert.match(body, /Run timeline/);
    assert.match(body, /Pre-scan/);
    assert.match(body, /Code Agent/);
    assert.match(body, /cursor\.com\/agents\/bc-e39a7c9c/);
    assert.match(body, /Open in Cursor/);
  });

  test("given cloud agent id this should link from cursor agents section", () => {
    const body = renderCommentBody({
      phases: [
        {
          name: "code-agent",
          status: "complete",
          startedAt: "2026-07-08T12:00:00.000Z",
          completedAt: "2026-07-08T12:00:01.000Z",
          decisions: [],
          logs: [],
          streamSnippets: [],
          cursorAgentId: "bc-abc123-def456",
          cursorAgentRuntime: "cloud",
        },
        {
          name: "standards-review/attempt-1",
          status: "complete",
          startedAt: "2026-07-08T12:01:00.000Z",
          completedAt: "2026-07-08T12:01:30.000Z",
          decisions: [],
          logs: [],
          streamSnippets: [],
          cursorAgentId: "local-review-agent-1",
          cursorAgentRuntime: "local",
        },
        {
          name: "dashboard-agent",
          status: "complete",
          startedAt: "2026-07-08T12:02:00.000Z",
          completedAt: "2026-07-08T12:02:30.000Z",
          decisions: [],
          logs: [],
          streamSnippets: [],
          cursorAgentId: "bc-dashboard-agent-99",
          cursorAgentRuntime: "cloud",
        },
      ],
      summaryLines: [],
      codeAgentId: "bc-abc123-def456",
    });

    assert.match(body, /Phase run \| Agent/);
    assert.match(body, /cursor\.com\/agents\/bc-abc123-def456/);
    assert.match(body, /local-review-agent-1.*local CI run/);
    assert.match(body, /Mixpanel deploy.*Mixpanel App API/);
  });

  test("given run metadata this should render latest run header", () => {
    const body = renderCommentBody({
      phases: [],
      summaryLines: [],
      runMetadata: {
        runId: "99",
        runUrl: "https://github.com/o/r/actions/runs/99",
        runAttempt: "1",
        updatedAt: "2026-07-08T12:00:00.000Z",
        overallStatus: "passed",
      },
    });

    assert.match(body, /Latest run/);
    assert.match(body, /PASSED/);
    assert.match(body, /Workflow #99/);
  });

  test("given deploy result this should render Mixpanel board links", () => {
    const body = renderCommentBody({
      phases: [],
      summaryLines: [],
      deployResult: {
        dashboardId: 11350065,
        dashboardUrl:
          "https://eu.mixpanel.com/project/1/view/2/app/boards#id=11350065",
        createdDashboard: false,
        reports: [
          {
            plan: {
              type: "insights",
              name: "Clients Viewed Trend",
              description: "Daily trend",
              event: "clients_viewed",
              reason: "New page",
            },
            bookmarkId: 42,
            reportUrl:
              "https://eu.mixpanel.com/project/1/view/2/app/boards#id=11350065&editor-card-id=\"report-42\"",
          },
        ],
      },
    });

    assert.match(body, /Mixpanel boards/);
    assert.match(body, /Open dashboard/);
    assert.match(body, /Clients Viewed Trend/);
  });

  test("given deploy result this should expose board section helper links", () => {
    const lines = buildMixpanelBoardsSection({
      dashboardId: 99,
      dashboardUrl: "https://eu.mixpanel.com/project/1/view/2/app/boards#id=99",
      createdDashboard: true,
      reports: [
        {
          plan: {
            type: "insights",
            name: "Home Viewed Trend",
            description: "Daily trend",
            event: "home_viewed",
            reason: "New page",
          },
          bookmarkId: 7,
          reportUrl: "https://eu.mixpanel.com/project/1/view/2/app/boards#id=99",
        },
      ],
    });

    assert.match(lines.join("\n"), /Open dashboard/);
    assert.match(lines.join("\n"), /Home Viewed Trend/);
  });

  test("given six new events and two dashboard reports this should separate board vs tracked-only", () => {
    const dashboardPlan: IDashboardPlan = {
      decisions: [],
      reports: [
        {
          type: "insights",
          name: "Reports Viewed Trend",
          description: "Daily trend",
          event: "reports_viewed",
          reason: "Page view",
        },
        {
          type: "insights",
          name: "Reports Generate Report Clicked Trend",
          description: "Daily trend",
          event: "reports_generate_report_clicked",
          reason: "Primary action",
        },
      ],
    };
    const lines = buildInstrumentationEventsSection(
      {
        version: "1",
        prSummary: "Added 6 events on ReportsPage; 2 prioritized for Mixpanel boards.",
        pages: [],
        newEvents: [
          "reports_viewed",
          "reports_filter_selected",
          "reports_report_selected",
          "reports_generate_report_clicked",
          "reports_export_pdf_clicked",
          "reports_schedule_report_clicked",
        ],
        filesChanged: ["src/pages/ReportsPage.tsx"],
        helpersUsed: ["trackPageView", "trackAction"],
        helpersCreated: [],
        deduplicationDecisions: [],
        changeBlocks: [],
      },
      dashboardPlan,
    );
    const body = lines.join("\n");

    assert.match(body, /Events in this PR/);
    assert.match(body, /6 events.*in code/);
    assert.match(body, /2 board reports/);
    assert.match(body, /4 events only/);
    assert.match(body, /\*\*Board report\*\* — Reports Viewed Trend/);
    assert.match(body, /\*\*Events only\*\* — Live View/);
    assert.match(body, /reports_filter_selected/);
  });
});
