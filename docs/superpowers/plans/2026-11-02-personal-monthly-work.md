# Personal Monthly Work Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task. Local development and isolated verification only; activation is a separate approval boundary.

**Goal:** Show the owner's six confirmed monthly duties from three KST calendar days before their original scheduled date, using the existing portal task/event ledger and the existing personal daily-work view.

**Architecture:** Reuse operations_templates, operations_tasks, occurrence_key, operations_task_events and the existing scheduler. Reuse the isolated personal-work ID/projection/upsert core from draft PR111 without enabling its generic mail synchronization or adding its scope-selection UI. Monthly templates and their canonical tasks are owner-private. No second monthly task ledger or separate cron.

**Tech Stack:** Existing JavaScript, PostgreSQL/PGlite, React/TypeScript and current owner-authenticated APIs.

**Spec:** User-selected OneNote schedule: two day-1 duties; day-7 prior-month second-half duty; day-8-before duty; day-10 closing duty; day-23 current-month first-half duty. Actual private titles/page reference belong in the owner's activation payload, not a public client bundle. Initial seed remains local until approved.

## Global Constraints

- Lead is exactly 3 KST calendar days, including previous-month/year visibility.
- Preserve original "before day 8" qualifier; do not turn it into an inclusive day-8 deadline or fabricate a time.
- Keep target period, planned approval date, payment date and visibility separate. Yangsan first: current month 1–15 → day 23 approval → month-end payment, visible day 20. Yangsan second: previous month 16–last → day 7 approval → day 15 payment, visible day 4. Nonghyup: previous full month → early-month approval using existing day-1 basis → day-10 payment, visible three days before day 1. Preserve “월초 품의”; this basis is not a legal deadline. Other payment dates/target periods remain unspecified.
- Exactly one instance per template family, owner and scheduled month, including retries/concurrency/version changes.
- No holiday shifting; unfinished prior instances stay open; completion/reopen/history remain intact. New month receives a new ID.
- No extra end-of-month second-advance instance from conflicting notes. No uncertain receipt windows or undated evidence tasks auto-generated.
- Do not deploy PR111 or expand sharing. No operating data, permissions, credentials or OneNote writes during this local phase.
- Extend existing test files only. Use synthetic titles in committed fixtures; keep the real six-title seed local.

## Review Focus

1. KST midnight/month/year/leap boundaries and day-8 strict qualifier.
2. Repeated/concurrent runs and template version transitions retain existing IDs and corrected/completed values.
3. Owner-private tasks, templates, events and mutations cannot leak through the portal's existing broader access.
4. Early completion stays visible on the actual completion day; target period and planned date never become an activity interval or invented deadline.
5. Ambiguous, old or unvalidated follow-ups cannot complete a month/task or overwrite a later manual reopen.

## Task 1: Calendar contract and native monthly materialization

Files: add `supabase/functions/onedrive-auth/private-mail-monthly.js`; add local-only `supabase/sql/private-mail-monthly.sql`; extend `tests/private-mail.test.mjs` and `tests/private-mail-rls.test.mjs`.

- [x] Reproduce missing monthly lead/instance support using fixed KST boundary cases in existing tests.
- [x] Define validated monthly template metadata and canonical instance DTO: scheduledMonth, scheduledDate, qualifier, originalSchedule, visibleFrom, targetPeriod, source provenance and owner ID.
- [x] Reuse existing operations_task_from_template occurrence locking/identity; generate only eligible missing months from an explicit effective month. Preserve native events and all existing instances.
- [x] Keep activity work_date/period at visibility time while scheduled date stays independent; do not create due_at when no source time exists.
- [x] Test six synthetic templates, Oct29→Nov1, Dec29→Jan1, leap-year prior-month end, strict before-day-8, overdue carry and repeat/new-month IDs.

## Task 2: Owner-private canonical ledger and daily projection

Files: reuse the existing draft's `private-mail-portal.js`, core additions in `private-mail-work.js`/`private-mail-briefing-model.js`, and `private-mail-portal.sql`; add monthly source validation in the same contracts. Existing `DailyWorkList.tsx`, `portal-mail.ts` and portal records remain the entry points.

- [x] Copy only the draft's stable-ID/projection/upsert core, preserving current released behavior; exclude generic activation and the unapproved scope-selection UI.
- [x] Guard monthly templates/tasks by owner and approved source/template identity; fail closed for other actors and changed occurrence metadata. Scope nullable-center support to personal records.
- [x] Add owner-only restrictive reads and guarded writes for monthly records, including native template/task actions and linked events. Keep all non-monthly permissions unchanged.
- [x] Project the same portal task ID into personal daily work and OneNote HTML; no shadow task instance. Show planned date/qualifier and target period without invented deadline.
- [x] Verify portal→daily and daily→portal correction, completion/reopen, historical views and user notes with isolated SQL and common renderers.

## Task 3: Existing API matching and automatic execution integration

Files: existing `private-mail-manual.js`, `private-mail-background.js`, local SQL manual-target/correction contracts and scheduler hook.

- [x] Include owner-private monthly tasks in existing manual target/global analysis candidates; preserve current source boundaries and original input.
- [x] Connect selected mail updates to owner-private monthly duties through current-body/period/type checks and existing targeted semantic validation; persist in the analysis transaction.
- [x] Reuse validated normalized follow-up outcomes and source-event-time state protection; quantity/progress-only input does not imply completion, ambiguous month/target remains confirmation-needed.
- [x] Persist validated status transitions in the same canonical task transaction with source/correction history and version checks; retry/partial failure cannot split ledgers.
- [x] Hook eligible monthly materialization into the existing operations scheduler, avoiding a second cron and skipping duplicate generic issuance of private monthly templates.
- [x] Keep operating activation absent until exact SQL, six-template seed, owner/sharing boundary and app changes are reported for approval.

## Task 4: Final isolated verification and activation report

- [x] Run targeted existing private-mail/portal suites, isolated PGlite, build and local mock UI/render verification. Do not use operating tasks as test fixtures.
- [x] Review privilege/data-flow changes and calendar/state correctness; fix failures before reporting.
- [ ] Report implemented vs isolated-tested vs unactivated, exact owner/template/SQL/scheduler changes needed, and remaining real API/Ego verification. Do not claim operating monthly automation is live.

## Verified checkpoint — local only

- Existing private-mail and RLS/PGlite test files: 2/2 passed; app production build passed.
- Actual native operations SQL (including trash migration): six synthetic approved templates, KST three-day visibility, strict-before qualifier, period separation, existing-month identity, next month instances, preserved overdue rows, native completion/reopen events, other-admin reads/writes blocked.
- Fault injection: one occurrence failure retains five other new instances; retry creates the missing instance only and clears the diagnostic error. Existing eight instances remain byte-for-byte unchanged.
- Shared HQ AI snapshot excludes private monthly task rows/counts/events even for the owner, because shared caches must not receive private content. Non-recurring monthly issuance and private/shared template-family mixing reject.
- Projection and existing note renderer use canonical native task IDs and preserve the planned date/target period without exposing source-page IDs.
- Implemented after initial checkpoint: actual overview/report/note-writer loading; monthly-only next-day queue; manual target and global clause matching through existing Luna contract; atomic ready-input/native task and owner-correction/native task updates; original source-time ordering; genuine portal-source backup queue and JS delivery contract; monthly-only exclusion/processing-note projection.
- Mail→monthly canonical linking is now implemented and locally verified. Not executed: real monthly Luna/JEV requests, operational monthly SQL/seed/deployment, actual monthly OneNote write. No operational monthly automation is claimed.
- No operating SQL, seeds, permissions, data, credentials, deployment or PR111 activation was performed.

## Latest local verification and activation boundary

- Five relevant existing test files passed together: private-mail, private-mail-rls, portal-task-views, portal-model, portal-history. New React-domain formatter and monthly ambiguity regressions also passed. Production build passed after UI integration.
- Actual local PortalTaskDetail rendered in isolated Playwright with synthetic data, mocked ancillary components, blocked external requests and no writes. Mobile 390px and desktop dates/period/payment readability passed. Screenshots remain in /tmp, not operating OneNote.
- Diagnosed portal-ai.test: mock authenticated user omitted the email required by the existing production survey-draft guard. Updated only the fixture; ordinary-admin denial and authorized-email success now both pass. Production permissions are unchanged.
- Real history SQL is loaded in monthly PGlite tests. The portal correction payload is saved in its immutable pending delivery queue and restored by the actual JS delivery parser with matching hash/filename. No OneDrive write was made.
- Native completion/reopen, old input after user reopen, newer verified completion, progress after completion, idempotent replay and transaction rollback under injected native-write failure passed. Progress creates updated, not a duplicate completion event.
- Read-only operating catalog checks found required native/scheduler/history/correction patch anchors. Operating monthly instance count is zero. No DDL or data writes were performed.
- Private activation payload prepared only at /tmp/personal-monthly-seed.json (not committed): six distinct template families with native create/approve request IDs, fixed owner, center null/delivery-team scope, source note/confirmation pointers and proposed effective_from 2026-11-01. Pure preview on 2026-11-02 yields two eligible day-1 duties; the other duties appear only at their three-day lead dates.
- Before any operation: perform appropriate real synthetic API verification through an approved authenticated app path, review/apply the two SQL changes as a compatible migration, register only the six approved owner-private templates, and promote app/Edge code. Keep generic PR111 activation and staff sharing absent. Actual OneNote/portal behavior then needs owner-authenticated Ego Lite verification. This is an explicit unperformed activation boundary, not an authentication failure.

## Mail and diagnostic extension checkpoint

- Mail candidate selection reuses the existing owner-private monthly task IDs. Current-body evidence, original header time, target period and advance kind are checked; the existing targeted API validates the requested change. Material delivery/quantity updates are not approval completion. Missing source time becomes confirmation-needed.
- The actual mail analysis-finish transaction updates the same native task and source keys. Reanalysis uses the original event time and cannot overwrite a later reopen. An invalid source or native write failure rolls the mail analysis back rather than splitting ledgers.
- Three fixed non-sensitive monthly MIME cases were added to the existing authenticated stress catalogue and existing virtual-reception selector. Actual native SQL runs only in the browser's isolated PGlite. The existing diagnostic OneNote route accepts only a sealed model extraction and a validated fixed-fixture canonical snapshot, and writes only a separate “가상 검증 <receipt>” page.
- Local provider transport and Graph simulations check positive approval, material-only, wrong-period, native SQL replay, new receipt intake/claim/finish/readback, concise HTML, tampered-client rejection and duplicate-page fencing. Real provider/Graph calls remain unexecuted for these monthly cases.
- Operational monthly SQL/seed/permissions remain unapplied. Code-only diagnostic rollout and owner-authenticated Ego Lite runs are distinct from monthly operational activation; neither has been performed in this checkpoint.

## Activation inventory (not applied)

1. Existing native operations schema/scheduler/history/correction migrations must already be present (read-only anchors checked). Apply `supabase/sql/private-mail-portal.sql` before `supabase/sql/private-mail-monthly.sql`. The latter patches native monthly guards/materialization, original-time mail/manual binding, native owner correction and portal-source history. No second ledger or cron is introduced.
2. Register only six confirmed templates using the existing create/approve RPC. Proposed effective month is 2026-11. The private seed stays outside Git. Each template belongs only to the approved owner, center null / delivery-team; private restrictive reads and source guards prevent staff exposure. No shared notification or HQ AI snapshot receives these duties.
3. Generic PR111 remains draft/unactivated. This branch reuses only its stable-ID/upsert/projection core and adds monthly-specific guards; it does not require merging PR111's generic synchronization or scope-selection UI.
4. To run real monthly diagnostics without activating duties, deploy only reviewed app/Edge code, leave both operating SQL/seed unapplied, and use the existing owner login: Settings → API management → isolated daily-briefing verification → virtual reception case. Run the three monthly cases; download SQL/native results; optionally write the sealed result only to its separate virtual-verification page. Existing operating monthly count is zero and must remain zero in this diagnostic-only step.
5. Then separately confirm six-template registration and owner-only recurring activation; no staff sharing decision is inferred from this development work. Actual live monthly generation, provider requests and OneNote output remain unverified until their respective steps run.

Final local evidence: three relevant test files passed together, including native monthly SQL and simulated Graph repeat/readback; the last missing-source-time regression passed with portal-ai. Production app build passed. Actual local Chromium executed the monthly reception selector and browser PGlite worker, verified completed canonical task and note HTML, and blocked external requests. The model transport was mocked and the Graph checks were simulated; these are not live API/OneNote claims. Read-only differential review found no additional concrete blocker.

## Operating activation — 2026-11-02

The user explicitly approved owner-private monthly work and then separately approved the necessary shared-table, scheduler, history and access-policy changes. Earlier rejected SQL attempts did not execute. The scoped atomic SQL assembled by `scripts/personal-monthly-activation.mjs` was subsequently applied as `owner_only_monthly_existing_task_activation` after checking that no monthly functions, templates or instances existed.

The builder tightens the reusable draft core: nullable-center delivery-team records must be the approved owner's monthly records; the new core triggers run only on monthly rows; snapshots select monthly rows; the source upsert can update existing approved monthly tasks only and cannot create generic personal work. The original private monthly guards, restrictive RLS, history, scheduler and shared-AI exclusions apply in the same transaction. Generic PR111 activation remains absent.

Operating checks: six approved owner-only template families registered through the existing audited template RPC with stable request IDs. On November 2, the real generator created the two eligible day-1 duties with zero failures; repeat generated zero and retained the same two IDs. All six definitions retain the confirmed schedule/period/payment rules and no holiday shifting. Original nine non-monthly task records retain their prior source-field hash. Owner reads return 2 monthly tasks / 6 templates / 14 events; a different authorized administrator reads 0 / 0 / 0 while retaining access to the original nine public tasks. The existing recurring scheduler is active and recent minute runs succeeded. No dummy tasks were written into the operating ledger.

PR115 and PR116 app/Edge code is deployed; JEV now includes monthly updates and bounded period/payment context in advisory review without changing extraction/state. Monthly actual-provider/isolated-SQL and separate virtual-OneNote browser verification is delegated to the existing Ego Lite operator; do not duplicate that execution or claim its result before evidence arrives. Real monthly duties are not completed/reopened merely for testing.
