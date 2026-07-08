import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { IInstrumentConfig } from "./types.js";
import { runPreScan } from "./preScan.js";

const baseConfig: IInstrumentConfig = {
  framework: "vite-react",
  paths: {
    pages: "src/pages",
    routes: "src/routes",
    analytics: "src/lib/analytics.ts",
    entry: "src/main.tsx",
  },
  analytics: {
    wrapper: {
      module: "src/lib/analytics.ts",
      initFunction: "initMixpanel",
      trackFunction: "track",
    },
    requiredEvents: {
      pageView: "{page}_viewed",
      userAction: "{page}_{action}",
    },
  },
};

describe("packages/orchestrator/src/preScan.ts", () => {
  test("given CheckoutRetryPage without track calls this should detect gaps", () => {
    const filePath = "src/pages/CheckoutRetryPage.tsx";
    const content = `
import { Link } from 'react-router-dom';

export const CheckoutRetryPage = () => {
  return (
    <main>
      <h1>Checkout Retry</h1>
      <Link to="/checkout">Back to checkout</Link>
    </main>
  );
};
`;

    const assessment = runPreScan(
      [filePath],
      new Map([[filePath, content]]),
      baseConfig,
    );

    assert.equal(assessment.scannedFiles.length, 1);
    assert.ok(assessment.gaps.some((gap) => gap.kind === "missing_track_import"));
    assert.ok(assessment.gaps.some((gap) => gap.kind === "missing_page_view"));
    assert.ok(assessment.gaps.some((gap) => gap.kind === "handler_without_track"));
  });

  test("given instrumented HomePage this should report no gaps", () => {
    const filePath = "src/pages/HomePage.tsx";
    const content = `
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { trackAction, trackPageView } from '../lib/analytics';

export const HomePage = () => {
  useEffect(() => {
    trackPageView('home');
  }, []);

  const handleCtaClick = () => {
    trackAction('home', 'cta_clicked', { cta: 'start_checkout' });
  };

  return (
    <main>
      <Link to="/checkout" onClick={handleCtaClick}>Start checkout</Link>
    </main>
  );
};
`;

    const assessment = runPreScan(
      [filePath],
      new Map([[filePath, content]]),
      baseConfig,
    );

    assert.equal(assessment.gaps.length, 0);
  });

  test("given test files in changed list this should exclude them", () => {
    const assessment = runPreScan(
      ["src/pages/HomePage.test.tsx"],
      new Map([["src/pages/HomePage.test.tsx", "describe('test')"]]),
      baseConfig,
    );

    assert.equal(assessment.scannedFiles.length, 0);
  });
});
