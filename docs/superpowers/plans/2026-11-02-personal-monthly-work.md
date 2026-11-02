# Personal Monthly Work Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task. Local development and isolated verification only; activation is a separate approval boundary.

**Goal:** Show the owner's six confirmed monthly duties from three KST calendar days before their original scheduled date, using the existing portal task/event ledger and the existing personal daily-work view.

**Architecture:** Reuse operations_templates, operations_tasks, occurrence_key, operations_task_events and the existing scheduler. Reuse the isolated personal-work ID/projection/upsert core from draft PR111 without enabling its generic mail synchronization or adding its scope-selection UI. Monthly templates and their canonical tasks are owner-private. No second monthly task ledger or separate cron.

**Tech Stack:** Existing JavaScript, PostgreSQL/PGlite, React/TypeScript and current owner-authenticated APIs.

**Spec:** User-selected OneNote schedule: two day-1 duties; day-7 prior-month second-half duty; day-8-before duty; day-10 closing duty; day-23 current-month first-half duty. Actual private titles/page reference belong in the owner's activation payload, not a public client bundle. Initial seed remains local until approved.

## Global Constraints

- Lead is exactly 3 KST calendar days, including previous-month/year visibility.
- Preserve original "before day 8" qualifier; do not turn it into an inclusive day-8 deadline or fabricate a time.
- Target periods are separate from scheduled dates: previous month 16–last day; current month 1–15. Other target periods remain unspecified.
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
- [ ] Verify portal→daily and daily→portal correction, completion/reopen, historical views and user notes with isolated SQL and common renderers.

## Task 3: Existing API matching and automatic execution integration

Files: existing `private-mail-manual.js`, `private-mail-background.js`, local SQL manual-target/correction contracts and scheduler hook.

- [ ] Include only eligible owner-private monthly tasks in existing target/global analysis candidates; preserve current source boundaries and original input.
- [ ] Reuse validated normalized follow-up outcomes and source-event-time state protection; quantity/progress-only input does not imply completion, ambiguous month/target remains confirmation-needed.
- [ ] Persist validated status transitions in the same canonical task transaction with source/correction history and version checks; retry/partial failure cannot split ledgers.
- [x] Hook eligible monthly materialization into the existing operations scheduler, avoiding a second cron and skipping duplicate generic issuance of private monthly templates.
- [x] Keep operating activation absent until exact SQL, six-template seed, owner/sharing boundary and app changes are reported for approval.

## Task 4: Final isolated verification and activation report

- [ ] Run targeted existing private-mail/portal suites, isolated PGlite, build and local mock UI/render verification. Do not use operating tasks as test fixtures.
- [ ] Review privilege/data-flow changes and calendar/state correctness; fix failures before reporting.
- [ ] Report implemented vs isolated-tested vs unactivated, exact owner/template/SQL/scheduler changes needed, and remaining real API/Ego verification. Do not claim operating monthly automation is live.

## Verified checkpoint — local only

- Existing private-mail and RLS/PGlite test files: 2/2 passed; app production build passed.
- Actual native operations SQL (including trash migration): six synthetic approved templates, KST three-day visibility, strict-before qualifier, period separation, existing-month identity, next month instances, preserved overdue rows, native completion/reopen events, other-admin reads/writes blocked.
- Fault injection: one occurrence failure retains five other new instances; retry creates the missing instance only and clears the diagnostic error. Existing eight instances remain byte-for-byte unchanged.
- Shared HQ AI snapshot excludes private monthly task rows/counts/events even for the owner, because shared caches must not receive private content. Non-recurring monthly issuance and private/shared template-family mixing reject.
- Projection and existing note renderer use canonical native task IDs and preserve the planned date/target period without exposing source-page IDs.
- Not implemented yet: runtime daily-overview/background note loading, monthly source target acceptance and global matching, atomic normalized follow-up commit/correction. No operational monthly automation or actual monthly OneNote output is claimed.
- No operating SQL, seeds, permissions, data, credentials, deployment or PR111 activation was performed.
