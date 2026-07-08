# Instrument — Requirements (Staff FDE Framing)

Companion to [`DESIGN_DECISIONS.md`](./DESIGN_DECISIONS.md). That doc justifies *how*
the system is built; this one states *what it was obligated to do and be* — the
requirements a staff-level Forward Deployed Engineer would write before calling this
pilot-ready for a customer, and an honest scorecard against them.
◊◊
An FDE sits between the vendor (Cursor) and one specific customer's engineering org.
That changes what "requirements" means relative to a product spec: the bar isn't just
"does the feature work," it's "can this be rolled out into someone else's SDLC, on
their infra, under their security review, without a Cursor engineer in the room every
time." Every requirement below is written with that deployment reality in mind, and
each carries a status against the current prototype: **Met**, **Partial**, or **Gap**
— a staff FDE scopes a pilot by knowing exactly which gaps are acceptable for a
30-minute demo and which would block a real customer rollout.

## 0. Stakeholders

| Stakeholder | What they need from this system |
|---|---|
| PR author (app engineer) | Instrumentation added correctly without having to learn the analytics wrapper API by hand |
| PR reviewer | Enough context on the diff to approve/reject in seconds, not minutes |
| Platform/DX team (owns the tool) | One place to update standards; adoption across repos without per-repo forks |
| Data/analytics team | Events are named consistently and land on a dashboard without a manual ask |
| Security/compliance | No new persistent datastore, least-privilege tokens, no PII in tracking payloads |
| Customer engineering leadership | Evidence this reduces review burden and doesn't introduce an unreviewed auto-merge path |

## 1. Functional Requirements

### FR-A — Detection & Assessment

- **FR-A1.** The system MUST identify, for a given set of changed files, which page
  components are missing required analytics events (page view, tracked user actions)
  without requiring a live model call.
  *Status: Met* — `preScan.ts`, unit-tested in `preScan.test.ts`.
- **FR-A2.** The system MUST discover the customer's existing analytics helper
  surface (module path, exported helpers, which conventions already exist) so
  generated code extends existing patterns instead of guessing.
  *Status: Met* — `analyticsCatalog.ts`.
- **FR-A3.** Detection rules MUST be configurable per repo (wrapper module path,
  event-naming template, scan/exclude globs) without modifying the tool's source.
  *Status: Met* — `instrument.config.json` + `instrumentConfigSchema`.

### FR-B — Instrumentation Generation

- **FR-B1.** The system MUST generate code that closes a detected gap by reusing an
  existing helper when one fits, extending one when the pattern is near-identical, and
  only creating new helpers or inline `track()` calls as a last resort — and MUST
  record which of those four choices was made and why, per event.
  *Status: Met* — `deduplicationDecisionSchema`; enforced by prompt + checked by
  Review Agent.
- **FR-B2.** Every generated event MUST carry a machine-checkable justification and
  the source line it was added at, sufficient to anchor an inline PR comment.
  *Status: Met* — `instrumentEventSchema` requires `justification`, `line`.
- **FR-B3.** Generation output MUST be a schema-validated artifact, not free-text,
  so every downstream phase can consume it without re-parsing agent prose.
  *Status: Met* — `.instrument/report.json` + `instrumentReportSchema.parse()`.
- **FR-B4.** A run MUST be able to skip generation entirely (assessment-only mode) for
  teams piloting detection before trusting write access.
  *Status: Met* — `--skip-code-agent`.

### FR-C — Standards Enforcement

- **FR-C1.** Generated instrumentation MUST be checked against the org's written
  standards by a reviewer distinct from the generator, before being considered
  passing.
  *Status: Met* — `reviewAgent.ts` as a separate agent invocation.
- **FR-C2.** The standards source of truth MUST be a single artifact usable by both a
  human in their editor and the automated reviewer — not a copy embedded in a prompt
  that can drift.
  *Status: Met* — `.cursor/rules/analytics-standards.mdc` loaded via
  `settingSources: ["project"]`.
- **FR-C3.** On failure, the system MUST attempt a bounded, automatic fix before
  escalating to a human, and MUST fail loudly (not silently pass) if the bound is
  exceeded.
  *Status: Met* — `standardsReviewLoop.ts`, `MAX_REVIEW_RETRIES = 2`,
  `StandardsReviewError`.
- **FR-C4.** The system MUST NOT auto-merge under any review outcome.
  *Status: Met* — no merge call exists anywhere in the pipeline; README states this
  explicitly.

### FR-D — Dashboard Planning & Deployment

- **FR-D1.** New events MUST be mapped to a proposed dashboard report (trend or
  funnel) with a stated reason, even when no live model call is available.
  *Status: Met* — `dashboardAgent.ts` AI path + `buildDashboardPlanDeterministic`
  fallback.
- **FR-D2.** Dashboard deployment MUST be independently disable-able from code
  generation (a customer may want instrumentation without touching their Mixpanel
  project yet).
  *Status: Met* — `--reports-only`, and deploy is skipped entirely if Mixpanel env
  vars are absent (no hard dependency).

### FR-E — Feedback & Reporting

- **FR-E1.** Every run MUST produce a single, updated (not duplicated) PR-level status
  comment summarizing pre-scan, generation, review, and dashboard outcomes.
  *Status: Met* — `syncPrComment` / `BOT_MARKER`-based find-or-create.
- **FR-E2.** Reviewers MUST see per-line justification and the Mixpanel destination
  for each instrumented line, directly on the diff, not only in a summary comment.
  *Status: Met* — `reviewComments.ts`, re-synced (stale comments deleted) each run.
- **FR-E3.** Run history MUST be visible across multiple pipeline executions on the
  same PR (e.g., after a push fixes a failed review), not just the latest run.
  *Status: Met* — `parseRunHistoryFromComment` / `appendRunHistory`, capped at 8.
- **FR-E4.** A dry-run mode MUST produce the same shaped output as a live run (same
  schemas, same comment structure) so the feedback surface can be validated without
  live credentials.
  *Status: Met* — dry-run fallbacks in every agent module.

### FR-F — Operational Controls

- **FR-F1.** The tool MUST be consumable by an app repo via a small, declarative
  integration (a few lines of CI config + secrets), not a vendored copy of the source.
  *Status: Met* — `instrument-reusable.yml` via `workflow_call`.
- **FR-F2.** Per-repo secrets (Mixpanel project/workspace) MUST be separable from
  org-level shared secrets (Cursor API key, Mixpanel service account).
  *Status: Met* — documented split in README "Secrets" section.

## 2. Non-Functional Requirements

### NFR-1 — Reliability & Graceful Degradation

Any single agent call failing or returning unparseable output MUST degrade pipeline
*quality*, not availability — the run should still complete and report an honest
partial result rather than crash the CI job.
*Status: Met* for dashboard planning (deterministic fallback on any failure);
*Partial* for code generation and review, which correctly fail the phase but do not
have a non-agent fallback (arguably correct — there's no safe deterministic substitute
for "write this code" — but worth stating as a deliberate asymmetry, not an oversight).

### NFR-2 — Security & Least Privilege

- Tokens used MUST be the minimum scope and lifetime needed (job-scoped
  `GITHUB_TOKEN`, not a standing PAT). *Status: Met.*
- The system MUST NOT introduce a new persistent datastore as an adoption
  prerequisite. *Status: Met* — state lives in the PR comment (§3.9 of Design
  Decisions).
- Generated tracking code MUST NOT emit PII-shaped properties (email, phone,
  card number). *Status: Partial* — this is asserted as a standards *rule*
  (`analytics-standards.mdc`, checked by the Review Agent) but there is no independent
  static/deny-list check outside the LLM's own judgment. For a real customer, I would
  not accept "the reviewer agent said so" as sufficient evidence for a PII control —
  I'd add a deterministic property-key denylist as a hard gate, not just a prompted
  rule. **This is the single highest-priority gap for a compliance-sensitive customer.**

### NFR-3 — Performance & Cost

- The pipeline MUST bound total agent invocations per PR run (no unbounded retry
  loops). *Status: Met* — `MAX_REVIEW_RETRIES = 2` caps at 3 code-agent/review-agent
  round trips per run.
- Mechanical work (gap detection) MUST NOT consume model calls. *Status: Met* — §3.1
  of Design Decisions.
- *Gap:* there is no per-run token/cost budget surfaced to the operator (e.g., "this
  run cost $X"), which a customer's finance/eng-leadership stakeholder will ask for
  before scaling from a pilot repo to "every repo."

### NFR-4 — Observability & Auditability

- Every phase MUST emit structured, timestamped decisions and logs, both to CI logs
  and a human-readable step summary. *Status: Met* — `progressReporter.ts`,
  `core.info`/`GITHUB_STEP_SUMMARY`.
- Every generated event's rationale MUST be durably attached to the artifact that
  produced it (not just ephemeral chat output) for later audit.
  *Status: Met* — `.instrument/report.json` is committed to the PR and the
  justification is duplicated into the PR comment/inline comments.
- *Gap:* no correlation ID ties a specific Cursor agent run (`agent.agentId`) into the
  PR comment for later retrieval from Cursor's own dashboard/logs — currently only
  logged to CI stdout. A customer's support/debug workflow would want that link
  surfaced.

### NFR-5 — Scalability & Multi-Tenancy

- Standards and prompts MUST be updatable in one place and take effect across every
  consuming repo on next run, without per-repo changes. *Status: Met* — reusable
  workflow pattern, §3.10.
- The PR-comment-as-state-store approach MUST NOT grow unbounded as a repo
  accumulates runs. *Status: Met* — `MAX_RUN_HISTORY = 8`.
- *Gap:* no cross-repo aggregate view ("instrumentation coverage across all 40
  repos this quarter") — acceptable for a pilot, a real blocker for reporting
  instrumentation health up to a VP.

### NFR-6 — Maintainability & Extensibility

- Every cross-phase contract MUST be a versioned, schema-validated type (Zod), not an
  implicit shape agreed by convention. *Status: Met* — `types.ts` is the single
  schema source for every phase boundary.
- Adding a new gap kind, report type, or standards rule MUST NOT require touching
  more than the owning module + its schema. *Status: Met*, demonstrated in Design
  Decisions §5 (extension seams).
- The vendor-specific piece (Mixpanel) MUST be isolated from the orchestration core so
  a different analytics backend could be substituted. *Status: Met* —
  `@instrument/mixpanel-client` package boundary.

### NFR-7 — Portability & Compatibility

- *Gap:* detection logic assumes a specific React "PageComponent" convention and a
  single analytics-wrapper shape; there is no abstraction yet for a second framework
  or a fundamentally different app architecture. This is the correct scope for a
  single-customer pilot and an explicit non-goal for v1 (see §3 below), but it is a
  real requirement gap the moment a second, differently-shaped app repo onboards.

### NFR-8 — Usability (reviewer-facing)

- A reviewer MUST be able to approve or reject instrumentation changes from
  information present on the diff itself, without leaving GitHub to check Mixpanel or
  the standards doc. *Status: Met* — inline comments carry justification + resolved
  Mixpanel link (§3.12 of Design Decisions).

## 3. Explicit Non-Goals (v1)

A staff FDE scopes a pilot as tightly as the requirements above, on purpose:

- Not a general PR review assistant (BugBot/security review are explicitly excluded by
  the brief, and this tool doesn't touch either).
- Not a multi-analytics-vendor platform yet — Mixpanel only, by design (§3.11 keeps the
  door open, doesn't walk through it).
- Not a replacement for human merge approval, under any circumstance.
- Not a historical analytics-health reporting tool — it is a per-PR gate, not a
  dashboard-of-dashboards.
- Not framework-agnostic — scoped to the customer's actual stack (React + a
  `src/lib/analytics.ts`-shaped wrapper), not a generic instrumentation engine.

## 4. What I'd require before calling this "customer-ready" beyond pilot

In priority order, the gate I'd actually enforce before proposing this to more than one
design-partner repo:

1. Deterministic PII property-key denylist (NFR-2) — don't rely on LLM judgment alone
   for a compliance-shaped guarantee.
2. An eval set of labeled gap/fix fixtures to score Code/Review Agent output quality
   over time, not just unit tests of the deterministic scaffolding around them.
3. Per-run cost visibility (NFR-3) surfaced in the PR comment, so a platform team can
   forecast spend before flipping this on org-wide.
4. AST-based detection (`ts-morph`) once a second framework/shape needs support — the
   regex approach is the right amount of engineering for one design-partner repo, not
   for a generalized product.
