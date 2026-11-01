# Naver Checkpoint Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Preserve the existing independent rotations and approvals.

**Goal:** Resume interrupted work from confirmed server checkpoints without restarting route comparisons or mixing changed input.
**Architecture:** Keep current naver_browser_jobs/API jobs. Restore the frozen job and its validation/candidate references, add an owner-scoped in-place resume operation, bound retries of idempotent queue transport writes/reads and preserve workflow continuation after infrastructure failure. Do not bypass Naver restrictions or silently retry provider-attention jobs.
**Tech Stack:** Existing React, worker Playwright, Postgres RPC, Node/PGlite assertions.
**Spec:** Latest user request: frequent interruptions must preserve address verification, candidate evaluation, independent rotations, query/capture results, and resume after reload/reconnection/timeout/server errors; changed files/conditions invalidate incompatible checkpoints; no duplicate output.

## Confirmed evidence

- Operating run 41312177678 exited 2026-11-01 14:03:10 UTC with `Server queue query failed: HTTP 502` (downloaded GitHub log).
- Workflow handoff step has no failure condition, so it is skipped when worker exits, leaving the hourly schedule as recovery.
- Latest capture 20c2ff91 has 3 saved images, 8/11 comparisons and attention at first unfinished course. Error is NAVER_ROUTE_UNAVAILABLE/HTTP400 with empty response body and no confirmed access/captcha marker; provider-internal cause remains unknown.
- Existing optimizer already saves per-permutation checkpoints and verifies unchanged input; do not replace it.
- Current UI recreates a capture job on retry, refreshing shortlist evidence/TTL rather than resuming its frozen plan. UI state and validation/candidate job IDs are not restored together on reload.

## Tasks

- [ ] Extend existing worker/lifecycle suites with one transient queue502 during heartbeat/checkpoint and permanent/ambiguous-claim errors. Add bounded retries only for idempotent SELECT/UPDATE operations; claim stays single-attempt. Handoff runs after worker failure but not cancellation/setup failure.
- [ ] Add owner/center/input/strategy-fenced resume RPC for the same frozen job, preserving successful results/optimization/validation/candidate references and requeuing only unfinished approved items. Test replay, cross-owner denial, changed input rejection and partial rotations in isolated SQL.
- [ ] Restore latest matching server work and exact validation/candidate references in existing UI. Existing start action resumes unchanged terminal work without rebuilding the API plan. New file/conditions use normal validation/enqueue flow. Test React reload/error/retry behavior locally with mocked transport.
- [ ] Make capture object publication paths deterministic per frozen job/course, preserve known verified output before cursor replay, and test upload/retry duplicate behavior without real user data.
- [ ] Review cache/settings checks and expired API partial-stage recovery; preserve completed matrix edges when valid and avoid silently treating incomplete selection as success.
- [ ] Run existing suites, build, isolated rollback checks and review. Existing authorized deployment may proceed once safe, without resuming real attention jobs or processing private route fixtures as tests.

## Local verification result

- Queue502 heartbeat/checkpoint retry passes without repeating route measurements. Persistent failure (including inside measurement heartbeat) remains infrastructure failure, does not advance cursor, and does not become a route failure. Ambiguous claim is never replayed.
- Same-job resume preserves result JSON, original validation/candidate IDs and plan, removes finished approved rotations from pending work, rejects changed inputs/mode/cross-owner, and is idempotent when queued/running.
- Newly approved previously blocked courses use new validated enqueue. Unchanged completed web comparisons can survive fresh API timestamps only when plan inputKey (including settings/coordinates) and candidate index set still match; changed vehicle settings do not reuse old output. The 30-minute API freshness rule remains for new selection.
- Actual local React component/shared client verification: restore frozen input/strategy/approval IDs, lost-ACK repeat keeps same job, reload does not enqueue or rebuild APIs. Separate parent-component scenario simulates child approval update and confirms previously blocked work follows new approved enqueue instead of frozen resume loop.
- Image publication uses owner/job/course/PNG-sha256.png, so exact retry is idempotent and a late obsolete worker cannot overwrite different image bytes. Known verified capture avoids remeasure/reupload after lost cursor acknowledgment.
- Reviewer found three Important defects (mutable shared image path, blocked-course resume loop, nested queue error swallowed as route failure). All corrected and covered by regressions.
- Existing Naver suites (7 files) pass with isolated PGlite enabled; app build passes with existing large-chunk warning. Browser tests use isolated mocked transport, not user PC/Ego or private routes.
- Impeccable detect attempted on both changed components: exit127, pinned engine unavailable and default home cache not writable. No duplicate engine installed; manual guideline review and real local React render used.
- Actual Naver routeHTTP400: stored response has zero-byte body and no access/captcha marker. Provider-internal cause remains unconfirmed. This fix preserves/restarts confirmed progress rather than claiming that rejection is solved.
- Operational rollout pending: install compatible owner-scoped SQL before frontend, then existing workflow/public fixture checks and deployment observations. Do not touch portal draft PR111 or auto-reprocess private attention jobs as tests.
