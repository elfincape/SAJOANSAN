# Personal Work Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect Jang Heeseong's personal daily work to the existing portal without duplicate tasks or exposing private mail.

**Architecture:** Reuse operations_tasks as the eventual canonical work record and retain private sources and AI history in the current private-mail tables. Introduce an explicit work classification and a minimal task projection contract before connecting production mutations. Activation and permission migration remain pending the user's sharing decision.

**Tech Stack:** Existing JavaScript/React, Postgres RPC, Node assertions and isolated PGlite.

**Spec:** The approved scope recorded below is the specification for this plan.

## Global Constraints

- Only the current owner's work; never infer a different assignee from a center.
- Mail belongs to delivery_team; manual input explicitly chooses center and work category. No geographic center inference.
- Ansan Coupang and Yangsan dispatch are different workflows.
- Stable workId is the linkage key; dates and new sources never create replacement tasks.
- Receipt/visibility date, explicit due date and service date remain separate.
- Do not publish private source text, evidence, model JSON or attachment URLs in portal inputs/events.
- Sharing is unanswered. No production portal rows, permission changes or activation until resolved.
- Extend existing test files only. Preserve user corrections, completion history and OneNote notes.

## Review Focus

- Same route in two categories must not be merged.
- Reanalysis must not overwrite a more recent portal correction.
- Completion followed by reopen must stay open on the next day.
- A reference is not automatically a task.
- Nullable delivery-team center must not be replaced by an invented center.

### Task 1: Shared classification and portal projection contract

**Files:** Modify `supabase/functions/onedrive-auth/private-mail-work.js`; extend `tests/private-mail.test.mjs`.

**Interfaces:** `normalizeWorkScope(value, sourceKind)`, `portalWorkInput(work, {ownerId, scope, visibleFrom})`, `applyPortalWorkSnapshot(work, task, {ownerId})`. Existing normalized work may carry optional workScope. Portal inputs carry only the business projection and stable link identity.

- [x] Add assertions for explicit scope, original owner, stable linkage, omitted private evidence, separate receipt/service/due dates, reference rejection and invalid classification.
- [x] Run `node --test tests/private-mail.test.mjs`; observe failure before implementation.
- [x] Implement contracts and scope-preserving merge with conflicting explicit classifications rejected.
- [x] Test completion/reopen projection, stale linked version rejection, wrong owner/task rejection, exact source/history preservation and no input mutation.
- [x] Run existing JS and isolated SQL suites, review diff and commit this independent contract.

### Task 2: Classification input and durable enqueue context

**Files:** Existing manual input component, portal-mail client, private-mail-manual handler and private-mail-manual-background SQL; existing tests.

**Interfaces:** Manual requests carry explicit workScope; follow-ups inherit the selected task's classification and reject conflicting selections. Server checks center against existing active centers and uses existing owner authorization.

- [x] Extend existing handler/SQL tests for retries, exact same text in different scopes, conflicting target scope and immutable original request context.
- [x] Add existing-style center/category controls to the message popup; retain raw text on failure and do not add a new menu.
- [x] Persist scope before background dispatch, return it on re-read and propagate into normalized work.
- [x] Verify current global and targeted input flows still use the actual common analysis API.

### Task 3: Canonical portal write/read integration and permissions

**Files:** Existing operations RPC SQL, private-mail orchestration/model, portal task mutations and existing isolated tests.

**Interfaces:** Unique owner+workId link to operations_tasks, version-checked mutations, canonical portal snapshot applied after old private corrections, existing dirty-note queue.

- [ ] Once sharing is resolved, specify and test the exact RLS boundary across tasks/events/files/views before production data is linked.
- [ ] Introduce delivery-team work scope without inventing a center or changing owner; reuse existing task/event/version machinery.
- [ ] Link existing work once; isolate private source records from portal business fields.
- [ ] Verify portal correction/reopen to daily view/OneNote, multi-work supplements, duplicates and category conflicts in isolated SQL.
- [ ] Deploy only the approved permission boundary, then parent verifies the real Ego Lite flow. Never claim mocks are operating verification.

## Progress

- Current baseline: PR110 deployed; working tree clean apart from existing untracked node_modules symlink.
- Sharing boundary: existing permissive operations_tasks read policy is not owner-private; production activation intentionally pending user answer.

- Tasks 1/2 local implementation: explicit center/category UI, atomic private receipt scope, scope-aware hash and candidate filtering, scope on source re-read and hidden next-day context; no operations_tasks mutation exists yet.
- Local compatibility ruling: existing direct-add extraction/stress callers remain supported without scope; the current UI enqueue requires explicit center/category for new untargeted receipts. Unclassified legacy work cannot become a portal task through portalWorkInput.
- Visibility/cutover hold: do not merge/deploy this stage before the complete link and historical unclassified-work cutover are ready. Otherwise new scoped global input could fail to match still-unclassified historical work. No center/category may be inferred for that cutover.
- Review fixed: next-day hidden workContext lost scope (reproduced actual null classification, regression now covers it); fresh global enqueue could omit classification (now rejected by handler, with delivery_team forbidden for new untargeted scoped SQL receipts).
- Local React mock screenshot: /tmp/personal-portal-scope.png. Real API, operational portal linkage and Ego Lite verification for this stage remain unperformed.
- Impeccable detect attempted: exit127, engine0.1.16 missing and default /home/agent/.impeccable cache unwritable. No install or permission expansion performed; local actual React screenshot and manual guideline review used instead.

## Task 3 isolated continuation (no operational activation)

The parent explicitly authorized implementing the real linkage/synchronization in isolation while sharing remains undecided. No authenticated grants, RLS policy changes, production data, production SQL application or OneNote writes are included.

- [ ] Add `private-mail-portal.js` orchestration: `syncPersonalPortalWork`, batch results with stable request IDs, and `personalPortalDailyView` reading canonical snapshots.
- [ ] Add local-only `supabase/sql/private-mail-portal.sql`: unique owner/workId identity in existing operations_tasks inputs, service-only idempotent upsert/snapshot RPCs, existing task/event history, same-transaction private link and dirty-report update. Existing portal save/reopen operations participate through guarded task triggers.
- [ ] Apply canonical snapshots after private corrections and before date filtering. Retain owner-protected fields across source reanalysis and use original verified event time to distinguish newer completion from old retry.
- [ ] Extend existing PGlite suite using actual operations core/save/reopen SQL: create/link, duplicate requests, supplements, owner edit, complete/reopen, stale version, category conflict, transaction rollback, batch partial failure/retry, and unchanged unrelated task/source/history.
- [ ] Reuse dailyBriefingView/renderDailyBriefing in the isolated path; no synthetic records reach operating DB or Note.
- [ ] Run focused suites/build and review; commit/push and create draft PR only. Document that actual grants/visibility and production enrollment remain unresolved.

### Isolated continuation result

Implemented `private_mail_portal_upsert` and snapshots plus the existing operations save/reopen path through guarded task triggers. The task's stable owner/workId key is unique; the private ledger holds only the task link. Source receipts and preexisting correction/event arrays are retained. Public business projection includes opaque source keys, not source text/evidence/attachment URLs. Reanalysis preserves fields explicitly edited through the portal. Original source proof time controls completion/reopen; cargo supplements alone cannot change state.

Canonical snapshots feed the actual daily view and HTML renderer after private corrections. Historical dates read event snapshots up to KST day end. The rollover predicate accepts the same snapshots. This adapter is deliberately not registered as a live action and no analysis worker is enabled to enroll production records.

Verification: five relevant existing test files pass (JS/model, real PGlite operations save/reopen/upsert/snapshots/trigger path, portal calendar/model/view), app build passes with existing chunk-size warnings. Service RPC tests run as service_role; only the isolated fixture models the expected Supabase table/sequence ACL. Overlapping adapter calls are tested against PGlite's serialized engine; this is not a multi-session PostgreSQL load test. No new model calls, real portal/OneNote writes or production SQL execution occurred.

Fresh review found three defects: lost incoming reopen proof, historical latest-state leakage, first-link source-scope mismatch. All three were reproduced and corrected with regressions. Role-realistic execution gap was fixed in the fixture. Same-transaction rollback covers task, private link, dirty-note marker and event failure; retry succeeds without duplicate task.

Remaining activation work: determine actual read-sharing boundary and apply reviewed policy, verify operating ACL, explicitly classify historical unclassified manual work without guessing or replacing IDs, connect enrollment/read adapters to the operating handlers and verify Ego Lite UI. Existing center_code:string frontend assumptions need delivery-team null-center presentation before operating activation. No standalone merge/deploy of this draft.
