# Explicit hub access implementation plan

> Execute inline with superpowers:executing-plans. Review the full branch once before rollout.

**Goal:** Honor an active employee editor's explicit `edit/all` grant for the granted resource across centers, while preserving inherited rules, own-center scopes, explicit denial, private data and administrator-only boundaries.

**Architecture:** Keep `operations_permission_for_actor` authoritative and reuse it in resource writes, attachment operations and participant eligibility. Align the React/legacy previews with that contract. Existing account memberships and stored grants remain unchanged.

**Tech stack:** Existing TypeScript/React, JavaScript, PostgreSQL functions/RLS and PGlite.

**Spec:** `docs/superpowers/specs/2026-11-06-hub-permissions-design.md`; user confirmed explicit all-center scope after the initial draft.

## Constraints and review focus

- Explicit grants apply only to their resource; inactive and administrator-only checks still deny.
- Viewer remains read-only except existing incident-status/notification exceptions.
- Inherited all-center rules keep existing center ceilings; explicit own-center grants stay scoped.
- Record ownership, personal task privacy, version/replay guards and attachment actor checks remain.
- No new accounts, memberships, task data or duplicate permission tables.
- Verify no-center and foreign-center employees, denied resources, scope changes while work is pending, actor mismatch, file lifecycle and participant options.

## Task 1: Permission contract and previews

- [x] Add RED cases to `tests/portal-permissions.test.mjs` for explicit edit/all, own, deny, inactive, viewer and admin-only; check TypeScript/legacy parity.
- [x] Update `app/src/domain/portal-permissions.ts`, `repo-root/js/portal-permissions.js` and SQL helper to match.
- [x] Run the same matrix in isolated PGlite, including real SELECT/UPDATE with RLS.

## Task 2: Reuse the contract at downstream writes

- [x] Add real isolated function regressions for `operations_can_edit_resource`, attachment reserve/commit, owner and participant eligibility.
- [x] Create `repo-root/sql/operations-explicit-scope.sql` using idempotent exact-body patches of existing functions; abort on unknown source instead of silently skipping.
- [x] Preserve file ownership, versions, events and private-task restrictions; check negative cases and repeat application.

## Task 3: UI, review and rollout

- [x] Update misleading scope/help text in existing member/permission views and `docs/permissions.md`; avoid a new screen.
- [ ] Run permission/auth/API-related existing tests and app build, then obtain a fresh whole-branch review.
- [ ] Update PR155 with final behavior; push/merge only tested changes. Apply SQL before the corresponding UI rollout and verify production function results using existing accounts read-only.
- [ ] Verify stored grants/memberships did not change. Distinguish local/synthetic checks, live permission reads, and any actual authenticated UI verification.
