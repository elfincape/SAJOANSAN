# Pyeongtaek Route Relations Implementation Plan

> Use superpowers:executing-plans. User explicitly requests execution without additional questions or approval checkpoints.

**Goal:** Persist reusable directed Naver road legs for Pyeongtaek provisional dispatch.
**Architecture:** Extend the existing distance workflow with address grouping, ranked candidate previews, a dedicated authenticated batched Edge Function and three RLS-protected cache/job tables. Preserve the existing distance endpoint.
**Tech Stack:** Existing JavaScript, Supabase Postgres/Edge Functions, XLSX and shared admin UI.
**Spec:** ../specs/2026-10-18-pyeongtaek-route-relations-design.md

## Global Constraints

- Center 002 only for this collector; retain all existing center workflows.
- Maximum 50 candidate destinations per stop; directed routes, no self-route requests.
- Pilot limit 60; full Directions budget at most 25,000 including center legs and retries.
- Separate geocoding budget at most 2,000; unknown provider allowance is never displayed as verified remaining quota.
- No added dependencies or new test files. No main push or Vercel production deployment.

## Review Focus

- Cancellation during an external request must preserve its saved result without permitting the next request.
- A timed-out worker must not overwrite a newer lease or double reserve the same attempt.
- Same coordinates do not establish the same physical stop; source rows and address details remain separate.
- Expired time estimates must remain visibly dated and cannot certify future OTD.
- Provider credentials and service role remain server-only; unauthorized center requests make no external call.

## Tasks

### 1. Candidate Selection

Files: `supabase/functions/naver-relations/model.js`, existing `tests/destination-distance.test.mjs`.
Exports: `normalizeAddress`, `groupAddresses`, `buildCandidates`.

- [x] Add failing assertions for exact address grouping, directed neighbors, max 50, center-first and balanced round-robin selection.
- [x] Implement pure functions without API calls; verify with `node --test tests/destination-distance.test.mjs`.

### 2. Persistence And Worker

Files: `repo-root/sql/naver-api-relations.sql`, `supabase/functions/naver-relations/{index.ts,handler.js,provider.js}`, existing `tests/charter-fuel-naver.test.mjs`.
Interfaces: address/leg/job tables; `naver_api_claim`, `naver_api_reserve`, `naver_api_release`, `naver_api_cancel`.

- [x] Implement RLS and service-only atomic claim/reserve/release/save RPCs; validate grants and cross-center protection.
- [x] Add failing provider/auth assertions; implement persisted geocoding and independent Directions 5 legs.
- [x] Implement preview/create/batch/status/resume actions with edit permission, bounded requests, explicit provider failures and pause/resume state.
- [x] Run existing provider and distance regression tests.

### 3. Existing UI Integration

Files: existing `repo-root/admin/naver-shortest-distance.html`, new `repo-root/js/naver-relations-ui.js`.

- [x] Integrate Pyeongtaek candidate preview, DB/file input, pilot/full budget, status table and stop/resume in the existing distance page.
- [x] Show dated road estimates, cache hits, attempted requests and deferred candidates without changing existing fuel calculation.
- [x] Run lint/build and browser desktop/mobile validation.

### 4. Verify And Publish Feature Branch

- [x] Independent review and fix significant issues; rerun affected checks.
- [x] Apply additive schema and deploy the new function only if permitted; preserve the existing deployed endpoint.
- [ ] Verify live authorization and at most 60 Directions requests when an authorized session is available.
- [x] Commit/push the feature branch; report concrete results and unresolved external prerequisites.

## Execution Ledger

- Setup: existing isolated feature worktree verified. Baseline 13eea4b, clean tree.
- Ruling: user explicitly waived further review questions; execute this plan without another handoff.
- Ruling: batch execution is resumable from persistent DB state, not a 25,000-request invocation; closing the browser pauses orchestration after the current batch, and re-opening can resume. No new scheduler or always-on server is introduced in this first stage.
- Task 1: complete. Pure model scale checks passed at 500/653/1,999 stops; local candidate calculation took 49/69/628ms respectively.
- Task 2: complete. Fenced cache writes and monthly cross-job reservation cap added after independent review. A live rollback-only SQL probe passed concurrent claim rejection, per-job/shared budget, stale cache/release blocking, cancellation with in-flight save, and role grants. Test data was rolled back; all three tables remained empty.
- Task 3: complete. Shared-shell desktop 1440px/mobile 390px screenshots verified with no page overflow. Existing UI tests cover file metadata, stale estimates, error-bearing summaries, restored criteria and single-pair additions. Four supplied workbook imports were verified locally without transmitting them or querying Naver.
- Task 4: partial. User expressly approved operational schema/new function; migration succeeded and Edge Function active. Real anonymous and invalid bearer requests returned 401. Local browser redirects to login, so no real geocoding or Directions pilot has run. No credentials read and no fake user tokens used.
- Security review: Supabase advisor flags authenticated execution of `naver_api_cancel` because it is SECURITY DEFINER. This is intentional: tables are not directly writable, and cancellation checks non-null auth.uid(), center edit permission and job owner/admin, uses fixed empty search_path, and is not executable by PUBLIC/anon. No other new-feature security finding was identified.
- Verification: 8 related test files passed, plus lint/build and desktop/mobile browser checks. Temporary jsdom/xlsx test dependencies stay outside the app and lockfiles.
- Follow-up review: all five initial findings resolved. Added caller-displayed revision to resume; a stale-tab test failed before the fix and passed after it. Single-pair additions use the same persisted collector and monthly ledger without replacing the main collection view.
- Published: implementation commit `e29ab9f` pushed to `codex/pyeongtaek-route-relations`; Edge Function `naver-relations` version 2 ACTIVE. No main push or Vercel production deployment. User-facing local server is `http://127.0.0.1:8769`; an authenticated user session is still required for the real pilot.
