import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  findReportForPlanOnDashboard,
  normalizeReportName,
} from "./reportMatching.js";
import type { IMixpanelDashboardDetail } from "./types.js";

const dashboardWithReports = (): IMixpanelDashboardDetail => ({
  id: 500,
  title: "Instrument Reports",
  contents: {
    report: {
      "90001": {
        id: 42,
        name: "Duplicate of Support Page Viewed Trend",
        type: "insights",
        params: JSON.stringify({
          sections: {
            show: [
              {
                behavior: {
                  type: "event",
                  value: { name: "support_page_viewed" },
                },
              },
            ],
          },
        }),
      },
    },
  },
});

describe("packages/mixpanelClient/src/reportMatching.ts", () => {
  test("given duplicate-prefixed report name this should normalize to the planned name", () => {
    assert.equal(
      normalizeReportName("Duplicate of Support Page Viewed Trend"),
      "Support Page Viewed Trend",
    );
  });

  test("given matching event params this should find an existing dashboard report", () => {
    const located = findReportForPlanOnDashboard(dashboardWithReports(), {
      type: "insights",
      name: "Support Page Viewed Trend",
      description: "Daily trend",
      event: "support_page_viewed",
      reason: "Primary page view",
    });

    assert.deepEqual(located, { contentId: 90001, bookmarkId: 42 });
  });
});
