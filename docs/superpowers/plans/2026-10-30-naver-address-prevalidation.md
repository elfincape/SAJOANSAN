# Naver Address Prevalidation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Root implements; independent photo-row investigation is read-only and touches no Naver files.

**Goal:** Make full address validation, explicit correction, targeted revalidation, verified capture and vertical Excel one operating web flow.

**Architecture:** Reuse the current React capture screen, Supabase job queue, browser address selection and storage. Add a validation job type and a guarded capture RPC; preserve matching historical captures and pass trusted validation points to the existing optimizer.

**Tech Stack:** Existing React/TypeScript, ExcelJS/SheetJS, Supabase SQL, Node worker and Ego Lite verification; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-30-naver-address-prevalidation-design.md`

## Global Constraints

- Keep existing permissions, owner/center scope, 1/2 rotation separation and fixed points.
- Preserve original addresses, skipped blank deliveries, existing success results, retries and cancellation.
- Do not guess the two unresolved garages or turn provider errors into address absence.
- Reuse safe exact address results; never accept client-supplied normal status or coordinates.

## Review Focus

- Blank delivery columns must retain original source roles in the validation location.
- Correction of a shared address must be explicit and consistent across all its uses, including fixed garage/center fields.
- Unchanged old successes must survive a different course's correction.
- Validation reuse and capture binding must reject other owners, centers and unrelated addresses.
- Stale polling, upload/center changes, cancellation and provider outages must not restore wrong validation/capture state.

## Tasks

- [ ] **1. Input model.** Modify `app/src/domain/naver-courses.ts`, add `app/src/domain/naver-address-validation.ts`. Preserve originalStops/sourceRoles, group unique address occurrences, edit explicitly, determine verified courses and routing-equivalent prior captures. Exercise these real functions through existing domain verification and boundary tests before implementation.
- [ ] **2. Browser validation.** Modify `scripts/lib/naver-map-browser.mjs` and existing `tests/naver-browser.test.mjs`. Add resolve/validate helpers using current selection and token validation; return bounded candidate summaries and distinct statuses. RED/GREEN for valid, ambiguous, no candidates, cached duplicates and provider failures.
- [ ] **3. Queue contract.** Add `repo-root/sql/naver-address-validation.sql`; extend `scripts/apply-naver-browser-migration.mjs` with idempotent application. Add validation kind/link and two owner/center-guarded RPCs. Reuse existing capture structural validation. Transactional checks cover authorization, duplicate addresses, partial revalidation, unchanged result reuse and unverified-route exclusion. Existing storage policies and legacy RPC remain intact.
- [ ] **4. Worker.** Extend `scripts/naver-browser-worker.mjs` and existing worker tests. Validation loops unique addresses, saves classified results, continues individual errors and pauses provider errors. Captures seed only verified, same-owner/center stored point evidence. Cancel and checkpoint behavior remain intact.
- [ ] **5. Web UI.** Add `app/src/components/NaverAddressValidation.tsx`, `app/src/lib/naver-address-validation.ts`; integrate into `NaverCourseCapture.tsx` and existing `naver-capture.css`. Add whole/individual validation, explicit edits, location/status table, current validation summary and eligible capture counts. Preserve old capture state across upload/correction. Restore saved validation and capture separately.
- [ ] **6. Output and delivery.** Extend existing course Excel to distinguish original/edited/confirmed address where changed. Run related regression checks, TypeScript/Vite build, permission review and current UI guideline checks. Deploy through current main/CI flow. Use actual operating buttons on a real input copy and a clearly marked small correction fixture; verify no route calls during validation, no duplicate resolution, only edited-address revalidation, blocked courses, preserved successes and generated XLSX. Record exact operational state and limitations.
