# Instrument — Design Decisions & Rationale

This document justifies the technical decisions behind Instrument, prepared for the
Cursor FDE onsite. Structure: problem framing → architecture → decision-by-decision
rationale (with the rejected alternative and the trade-off) → known limitations →
seams for a live extension. Each decision ties back to the brief's three success
criteria: **developer velocity**, **cognitive load**, **code quality/safety/consistency**.

## 1. Why this problem

Analytics instrumentation is a chronic, low-glamour SDLC gap in every product org I've
seen: PMs request an event, an engineer bolts a `mixpanel.track()` call into a
component during an unrelated PR, nobody enforces a naming convention, and six months
later the data team can't build a funnel because `checkout_viewed`, `Checkout Viewed`,
and `checkout_page_view` are all live in production. It's high-frequency (every PR that
touches a page is a candidate), it's mechanical enough for an agent to do reliably, and
it's exactly the kind of work senior engineers resent doing by hand and junior engineers
get wrong. That combination — frequent, tedious, error-prone, and low-status — is where
agentic tooling has the best ROI.

I deliberately did **not** pick "enforce internal engineering standards" as the headline
framing, even though a standards gate is one phase of the pipeline. The prompt struck
that example through in the doc I was given, which reads as "this alone is not enough."
Instrument's actual pitch is **spec-to-implementation for analytics**: turn a coverage
gap into shipped, standards-compliant tracking code *and* a live Mixpanel dashboard,
with the standards review as one gate inside that larger flow, not the whole product.
That's a deliberate positioning choice, not an oversight.

## 2. Architecture at a glance

```
PR opened/updated
   │
   ▼
1. Pre-scan (deterministic, no LLM)      — detect gaps, build analytics catalog
2. Code Agent (Cursor Cloud Agent)       — close gaps, write .instrument/report.json
3. Standards Review Loop                 — independent Review Agent vs ADR-031
      │  fail → Agent.resume() same agent, ≤2 retries → back to review
      ▼ pass
4. Dashboard Agent                       — plan Mixpanel insights/funnels
5. Mixpanel Deploy                       — create dashboard + bookmarks via service account
6. GitHub feedback                       — sticky PR comment + inline per-line review comments
```

Human reviewers still approve the merge. Instrument's job is to make that review fast
and well-evidenced, not to remove it.

## 3. Decisions

### 3.1 Deterministic regex pre-scan before any agent call

**Decision:** `preScan.ts` uses targeted regexes (page component detection, `track()`
call extraction, `onClick` handler analysis) to build a `ICoverageAssessment` *before*
the Cursor Cloud Agent is ever invoked.

**Why:** Gap detection — "does this file call `track()`" — is a mechanical, cheap
check. Paying agent latency and tokens to have an LLM re-derive something a 200-line
scanner can do deterministically in milliseconds is wasteful, and it's non-deterministic
where determinism is free. The pre-scan also produces the `analyticsCatalog` (which
helpers already exist: `trackPageView`, `trackAction`), which is handed to the Code
Agent as structured context instead of making the agent grep the repo blind on every
run.

**Rejected alternative:** Skip the pre-scan and let the Code Agent both discover gaps
and fix them in one shot. Rejected because it couples "detect" and "fix" into one
opaque agent call — you lose the ability to show a PR author *what was found* before
any code changes happen, and you can't unit-test gap detection independently of a live
API key (see `preScan.test.ts`).

**Trade-off I accept:** Regex-based static analysis is brittle against multi-line JSX,
non-trivial handler indirection, or unconventional component shapes (see §4,
Limitations). I chose speed-to-prototype over AST correctness, and I'd swap in
`ts-morph` first if this went to production.

### 3.2 Cursor Cloud Agent for the fix, not local/background agent

**Decision:** `codeAgent.ts` calls `Agent.create({ cloud: { repos: [{ url, prUrl }],
workOnCurrentBranch: true, skipReviewerRequest: true } })`.

**Why:** The consumer is CI (GitHub Actions), not a developer's laptop — there's no
local checkout to operate on inside the tooling repo's own runner, and the whole point
is "this runs unattended on every PR." Cloud Agent gives an isolated remote workspace
already wired to the target repo and PR. `workOnCurrentBranch: true` means it commits
directly onto the existing PR branch instead of opening a competing PR that the author
now has to reconcile. `skipReviewerRequest: true` is deliberate: Instrument's own
Review Agent + sticky PR comment *is* the review surface, so I don't want Cursor also
pinging a human as if the agent were a peer reviewer — that would be a second,
redundant notification channel.

**Rejected alternative:** Run the agent locally inside the Actions runner against the
checked-out workspace. Rejected because it forfeits Cloud Agent's isolation and
resumability (`Agent.resume`, §3.3) and ties the agent's lifetime to the single CI job
step instead of letting it persist as an addressable run.

### 3.3 `Agent.resume()` for standards-review fixes, not a fresh agent

**Decision:** `standardsReviewLoop.ts` keeps the original Code Agent's `agentId` and,
on review failure, calls `Agent.resume(codeAgentId, { apiKey })` with a fix prompt
built from the Review Agent's structured issues, bounded by `MAX_REVIEW_RETRIES = 2`.

**Why:** Resuming the same agent means it already has the conversation context — which
files it touched, why it chose `trackPageView` over inline `track()`, what the
pre-scan assessment said. A fresh agent would have to reconstruct all of that from
scratch, burning tokens and risking a *different, inconsistent* fix (e.g., choosing a
different helper the second time). Bounding retries at 2 is a conscious cost/time
control: this runs on every PR update in CI, and an unbounded fix loop is both a
runaway-cost risk and a bad CI experience (a PR check that can spin for 20 minutes).
After 2 failed attempts, the pipeline fails loudly (`StandardsReviewError`) rather than
silently merging non-compliant instrumentation.

**Trade-off I accept:** If the agent gets stuck in a local minimum (repeatedly
misunderstanding the same issue), 3 total attempts is the ceiling before a human has to
intervene manually. I'd rather fail closed and visible than loop indefinitely.

### 3.4 A separate, independent Review Agent instead of trusting the Code Agent's self-report

**Decision:** `reviewAgent.ts` is a distinct agent invocation (`Agent.prompt`, local
mode reading the actual changed files from disk) that re-checks the diff against
ADR-031, rather than asking the Code Agent to just assert compliance in its own report.

**Why:** An agent grading its own homework is a weak control — it has every incentive
(explicit and statistical) to report success. A second agent, given only the standards
doc and the resulting files (not the first agent's reasoning), is a much stronger
independent check, structurally similar to why code review is a different person from
the author. This is also the piece of the pipeline that most directly serves "code
quality/safety" from the brief: it's the actual enforcement gate, distinct from the
generation step.

**Why local mode, not cloud, for this agent specifically:** `Agent.prompt(..., {
local: { cwd: workspaceRoot, settingSources: ["project"] } })` lets the Review Agent
load `.cursor/rules/analytics-standards.mdc` directly from the checked-out workspace via
Cursor's own project rules mechanism, so the standards doc has exactly one source of
truth — the same file a human engineer sees in their editor — instead of a copy baked
into the review prompt that can drift from the real rule file.

### 3.5 Structured `.instrument/report.json` (Zod-validated) as the sole interface between phases

**Decision:** Every downstream phase (standards review, dashboard planning, GitHub
comments, inline review comments) consumes `IInstrumentReport`, parsed through
`instrumentReportSchema.parse()` — never free-text agent output directly.

**Why:** LLM output is probabilistic; the rest of the pipeline needs to be
deterministic and testable. By forcing the Code Agent to emit one schema-validated
JSON artifact and having every later stage depend only on that artifact (not on the
agent's prose, not on re-parsing the diff), each downstream phase can be unit-tested
with a fixture report and zero network calls (`dashboardAgent.test.ts`,
`reviewComments.test.ts`). It also means a human can inspect `.instrument/report.json`
directly in the PR diff as an audit trail of exactly what the agent decided and why.

**Rejected alternative:** Parse the agent's final message text with looser heuristics
per consumer. Rejected — every consumer would need its own brittle parsing logic, and
failures would be silent instead of a loud Zod validation error at the one point where
the artifact is produced.

### 3.6 Deterministic fallback in every agent-calling phase (dry-run / no API key)

**Decision:** `codeAgent.ts`, `reviewAgent.ts`, and `dashboardAgent.ts` each check
`dryRun || !process.env.CURSOR_API_KEY` first and, if true, produce a realistic mocked
result (`buildCheckoutRetryDryRunReport`, `buildDryRunReview`,
`buildDashboardPlanDeterministic`) instead of calling the SDK.

**Why:** Three concrete reasons, not just "nice for demos":
1. **Testability** — the full pipeline (`runPipeline.ts`) can be exercised end-to-end in
   CI/unit tests without a live `CURSOR_API_KEY` or network access.
2. **Graceful degradation in production** — the dashboard agent specifically falls back
   to `buildDashboardPlanDeterministic` on *any* agent failure or unparseable output
   (not just missing credentials), so a flaky LLM response degrades the *quality* of
   dashboard planning rather than breaking the pipeline. This is the single biggest
   reliability decision in the codebase: an agent-based tool that hard-fails whenever
   the agent has a bad day is not enterprise-usable.
3. **Live demo control** — I can walk through the whole architecture deterministically
   without depending on Cursor Cloud Agent's live latency/availability during a
   30-minute presentation window, then flip `CURSOR_API_KEY` on to show the real path.

### 3.7 Helper reuse/deduplication as a first-class, inspectable concept

**Decision:** The report schema requires `helpersUsed`, `helpersCreated`, and
`deduplicationDecisions` (`choice: reuse|extend|create|inline` + `reason`), and the
Code Agent prompt encodes an explicit decision order (reuse → extend → create → inline)
before it's allowed to touch a page file. The Review Agent then *fails* the review if a
raw `track('*_viewed')` call was used when `trackPageView` already existed.

**Why:** This is the actual "reduce cognitive load / increase consistency" mechanism,
not the standards checklist. The failure mode this prevents isn't "wrong event name" —
it's five different pages each hand-rolling their own `useEffect` + `track()`
boilerplate with slightly different property shapes, which is how analytics codebases
rot. Making the dedup decision explicit and machine-checkable means the *pattern*
converges over time even though a different agent (or engineer) touches each PR.

### 3.8 GitHub token from Actions context, not a stored PAT; no auto-merge

**Decision:** `GITHUB_TOKEN: ${{ github.token }}` (ephemeral, job-scoped) with
`permissions: { contents: read, pull-requests: write }` declared explicitly in the
reusable workflow. Instrument posts comments and never merges.

**Why:** Least-privilege by default — the token is scoped to the single job run and
expires with it, so there's no long-lived secret sitting in the consuming repo that
could leak or be reused outside its intended blast radius. No-auto-merge is a safety
boundary I hold even though the standards review "passes": this tool authors
production analytics code via an LLM, and I don't think the current state of the art
justifies removing a human from that merge decision, however green the checks are. The
brief explicitly asks for tools that "meaningfully improve" workflows, not replace
approval gates.

### 3.9 State lives in the PR comment itself (no database)

**Decision:** `github.ts` round-trips run history through an HTML comment marker
embedded in the sticky PR comment body (`parseRunHistoryFromComment` /
`appendRunHistory`, capped at `MAX_RUN_HISTORY = 8`), rather than persisting run state
anywhere else.

**Why:** Instrument runs as a stateless GitHub Actions job — no infra to provision, no
database to secure or pay for, nothing for a consuming team to operate. For a tool
meant to be adopted by "N app repos" via a reusable workflow (§3.10), zero operational
footprint is a real adoption advantage: a platform team can roll this out without
asking for a database and an on-call rotation. The state that matters (recent run
outcomes) fits in a few KB of JSON, so a comment is genuinely sufficient, not a hack
stretched past its limit.

**Trade-off I accept:** This doesn't scale to rich historical querying ("show me every
instrumentation PR in the last quarter across all repos") — that would need real
storage. Capping history at 8 runs keeps the comment from growing unbounded.

### 3.10 Reusable GitHub Actions workflow + per-repo config, not a vendored script

**Decision:** The tooling lives in one repo (`instrument`) and is consumed via
`workflow_call` (`instrument-reusable.yml`); each app repo supplies only
`instrument.config.json` (wrapper module path, event-naming conventions, scan globs)
and a few secrets.

**Why:** This is the actual enterprise deployment model I'm targeting: a platform/DX
team ships one paved-road tool, and N product teams' repos opt in with ~10 lines of
YAML instead of copy-pasting a script that immediately forks and drifts. Updating the
ADR rules or the agent prompts in one place (`packages/orchestrator/src/prompts/`)
propagates to every consumer on their next PR run, which is the whole point of
"internal engineering standards" tooling — a standard that lives in 40 copy-pasted
scripts isn't a standard.

### 3.11 Monorepo split: orchestrator vs. mixpanel-client

**Decision:** `@instrument/orchestrator` (Cursor SDK, GitHub API, pipeline logic) and
`@instrument/mixpanel-client` (pure Mixpanel App API client + URL builders) are
separate packages, tested separately (`urls.test.ts`, `reports.test.ts`).

**Why:** The Mixpanel client has zero dependency on Cursor, GitHub, or agent
orchestration — it's pure request-building and response-shaping logic, which means it
can be fully unit-tested without mocking an SDK, and it isolates "which analytics
vendor" as a swappable concern from "how the pipeline is orchestrated." If a future
version needed Amplitude instead of/alongside Mixpanel, the orchestrator's dependency
on a dashboard-planning *interface* wouldn't need to change.

### 3.12 Inline PR review comments carry justification + live Mixpanel mapping, not just a diff

**Decision:** `reviewComments.ts` posts one comment per instrumented line, containing
the agent's `justification` field, the event's trigger/properties, and a resolved link
to the Mixpanel report/dashboard that event feeds (`resolveEventMixpanelContext`,
handling both "already deployed" and "planned only" states).

**Why:** This is where "reduce cognitive load" is most literal. Without this, a
reviewer sees a bare new `trackAction('checkout_retry', 'back_clicked', {...})` call
and has to independently reconstruct *why it's shaped that way* and *where it goes*.
With this, the justification and the downstream Mixpanel destination are sitting right
on the line being reviewed — review becomes verification of a stated claim instead of
requiring the reviewer to hold the entire analytics taxonomy in their head. Old
`instrument-review`-marked comments are deleted and reposted on each run
(`REVIEW_MARKER`) so the PR diff view never shows stale justifications after a fix
cycle.

## 4. Known limitations (say these before they're asked)

- **Regex-based static analysis, not AST.** Pre-scan will miss instrumentation gaps
  hidden behind indirection (a handler imported from another file, a JSX component
  wrapping the actual `<button>`) and can misfire on multi-line JSX. Next step: swap
  `preScan.ts`'s pattern matching for a `ts-morph` AST pass — same output shape
  (`ICoverageGap[]`), so nothing downstream changes.
- **Single framework shape.** The scanner assumes a React "PageComponent" convention
  and one analytics wrapper shape. Config-driven paths help, but a fundamentally
  different app (e.g., server-rendered, or event-driven backend) needs a different
  pre-scan strategy entirely.
- **Dashboard planning has no notion of existing dashboard clutter.** It plans new
  reports per PR; it doesn't check whether a near-duplicate report already exists on
  the target dashboard before creating another one.
- **No eval suite over agent output quality.** I unit-test the deterministic paths
  thoroughly, but I don't have a harness scoring the live Code/Review Agent's output
  against a labeled gap set — that's the natural next investment before trusting this
  with real merge-blocking authority.
- **Bot identity is generic `github-actions[bot]`.** A production rollout would use a
  dedicated GitHub App identity so instrumentation PRs are attributable and rate-limited
  independently of other Actions usage in the repo.

## 5. Good seams for a live extension

Picked to be real, self-contained, and each demonstrable in a few minutes:

- **New coverage-gap kind** — add a case to `coverageGapKindSchema` +
  `analyzePageFile` in `preScan.ts` (e.g., detect a page missing an error-state
  tracking event), and it flows through to the report and PR comment with no other
  changes.
- **New Mixpanel report type** — extend the `reportPlanSchema` discriminated union
  (e.g., a `retention` report type) and `buildDashboardPlanDeterministic`.
- **New ADR rule** — add a rule to `analytics-standards.mdc` and mirror it in
  `reviewAgent.md`; show it caught live by re-running the standards review loop against
  a deliberately non-compliant fixture.
