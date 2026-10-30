# Employee permissions implementation plan

**Goal:** The administrator selects an employee and assigns the work that employee can access, rather than editing shared page eligibility rules.

**Direction:** The user explicitly selected employee-first administration. The existing shared rules remain a compatibility default, never a substitute for a per-employee save. Existing assignments do not change during migration.

**Architecture:** Reuse operations_permissions with a member_overrides JSONB map, keyed by employee UUID. An entry contains level (none/read/edit) and scope (own/all). Missing entry inherits existing rules. A single administrative RPC atomically validates employee state and resource versions, writes changed entries and records an audit event in operations_task_events. Existing API/RLS permission checks evaluate the override while retaining active/admin-only, role and center ceilings.

**Stack:** React/TypeScript, existing Radix/Motion controls, Supabase PostgreSQL RPC and RLS.

- [x] Backend: inspect actual production schema/functions, add compatible column, evaluator and atomic administrative RPC. Preserve grants, membership locks, request idempotency and existing global-rule saves.
- [x] Frontend: employee search/selection, grouped work rows, unavailable/read/edit controls, scope, current effective access and explicit save. Preserve dirty edits on employee switch. Link existing role/center management rather than silently changing employee role.
- [x] Navigation: retain permissions URL but rename visible entry to employee permissions; reuse existing catalog grouping.
- [x] Verification: existing permission tests plus temporary SQL rollback checks for deny/read/edit, isolation between employees, role/center limits, atomic conflicts, retries and unauthorized calls. Browser checks use mocks; no actual employee permissions changed for testing.
- [ ] Release: deploy compatible database migration before frontend, build and test, merge and verify production UI and API shape.

Administrator-only functions stay fixed; inactive employees have no effective access. Viewer accounts cannot receive ordinary edit access without an explicit role change through member management. Center-scoped writes remain limited to assigned centers. Multiple screens backed by one resource are represented as a single work permission.

## Subsequent user direction

- Common tools remain available while browsing either center. Catalog navigation scope is explicit; center data screens retain center-bound guards.
- Distance calculation, personal course captures/address validation and Gimhae analysis get dedicated tool resources. Existing employees receive an exact snapshot of their former effective eligibility; new default access is denied until assigned. Database relations, master data and dispatch drafts retain their actual-center checks. Capture jobs and images remain owner-only.
- Replace the duplicate Ctrl+K menu search with the existing authorized work-data search. No second search backend.
- Preserve the approved sidebar glass material. Neutral frosted surfaces replace blue category fills, with consistent icon meaning and restrained transitions. Account menu opens at its trigger; dialogs do not travel from the header.
- Check tables and portal calendar against shared spacing, corner and readability rules, and review the full hub catalog rather than relying on one representative page.

## Final local verification

- TypeScript and final Vite build passed; emitted CSS retains both required frosted backdrop filters.
- All 31 audited routes opened with the appropriate mock role/center, no page errors or horizontal overflow. Screenshots inspected; this is UI fixture coverage, not a claim of every production business operation.
- Full browser harness passed: 24 hub destinations, navigation, theme, account/modal focus, Excel download, search entry and denied-route checks.
- Employee UI mock checks passed atomic payload/version, failure draft retention, switching guard, reset, shared-tool scope and isolation. Domain evaluator checked 20,736 legacy comparisons, 31,104 override cases and 41,472 isolation comparisons.
- Shared tools appear from both centers; center data and Pyeongtaek-only dispatch remain restricted. Intercepted distance request uses the new resource. No paid live AI/map request was used for testing.
- Data table light/dark 1440/2560 screenshots, sorting/filtering/scrolling, calendar 7-column fit and empty state checked. Account menu 40 cycles, category 20 cycles and reduced-motion checks passed.
- Impeccable detector and diff whitespace checks passed. Existing domain/permission/distance tests passed. Final review corrected shared-tool preview center semantics before release.

## Database deployment evidence

- Applied compatible employee override schema and RPC; corrected shared-row lock order.
- Real database rollback checks passed for non-admin denial, employee isolation, explicit deny/read/edit, role and center ceilings, inactivity, stale member/resource versions, atomic multi-resource rollback, retry idempotency, inheritance reset, malformed fail-closed and anonymous execution grants.
- Existing 35 rules retained fingerprint `3750fff9cdc7ad7e1f183614284308bd`; no test assignments persisted.
- Added two common-tool resources. Existing-user eligibility mismatches: 0; tool access differences between 001 and 002: 0. Existing data rules remain unchanged.
- Supabase Edge versions deployed: naver-distance 7 and gimhae-dispatch-parse 10. Existing JWT settings and internal authentication retained; published sources matched repository HEAD before modifying the authorization checks.
- Security advisor counts were unchanged except the expected authenticated SECURITY DEFINER RPC (53 to 54). The new administrative RPC requires auth.uid/is_admin before and after its administration lock, fixes search_path, denies anonymous execution and is covered by the non-admin rejection test. It follows the existing administrative RPC model; no public table write grants were added.
