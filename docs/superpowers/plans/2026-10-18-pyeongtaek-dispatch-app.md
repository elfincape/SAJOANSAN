# Pyeongtaek Dispatch App Implementation Plan

**Goal:** Implement the approved provisional-dispatch workflow inside the existing admin workspace.
**Spec:** `docs/superpowers/specs/2026-10-18-pyeongtaek-dispatch-app-design.md`
**Authorization:** User resumed implementation after switching models on 2026-10-18. The earlier design-only stop is superseded. Main/Vercel publication is not part of this change.
**Architecture:** Existing browser modules, shared admin shell, Supabase center permissions and Naver leg cache. Separate import/storage adapter, pure planner and workflow UI; bounded existing optimization library for assignment.

## Constraints

- Center 002 only; preserve original rows and entire physical stops.
- Fixed original courses first. Interdelivery requires explicit adjustment.
- CJ quotas 100/250/350 for 1/2.5/3.5 tons; no invented 5-ton quota.
- Temporary routes target at most five stops, respecting entry and OTD conditions.
- Arrival OTD plus service and preparation; unknown road legs never imply compliance.
- Existing master records and confirmed dispatch records remain unchanged by draft creation.
- Follow AGENTS: no separate test files; focused existing checks and temporary verification scripts.

## Tasks

- [x] Data adapter: mapped workbook import, row provenance and duplicate detection, existing center master/cache reads, draft snapshot storage with concurrency check. Revised-file import review passed.
- [x] Planner: whole-stop grouping, fixed allocation, temporary grouping, configurable service/margin, directed-leg scheduling and issues.
- [x] UI: import/mapping, daily driver availability, draft/detail changes, save/load/export, unsaved-work protection.
- [x] Navigation integration: Pyeongtaek-only hub/sidebar entry, existing charter resource permission mapping. Shared light/dark/responsive UI verification remains with UI task.
- [x] Verification: constraints and conservation, import failures, permission isolation, stale saves, desktop/mobile workflows, lint/build, independent review.
- [x] Commit and push feature branch; report deployment status precisely.

## Interfaces

Data rows preserve `id, source, date, course, customer, name, address, boxes, otd, mode, notes`.
Context exposes `drivers, destinations, addresses, legs`.
Draft exposes `stops, routes, unassigned, issues, settings, date, version`.
Routes reference whole stop IDs; unassigned stores remaining stop IDs. Snapshot includes original rows and day overrides.

## Review Focus

Shared physical vehicles must not receive duplicate capacity through route aliases. Same coordinates must not merge distinct addresses. Invalid mapped rows must remain visible. Date switches and stale saved drafts must not silently lose work. Missing/stale legs must remain distinguished from verified timing.

## Execution Ledger

- Existing isolated feature worktree verified clean at `9a1d428`.
- Parallel work has disjoint files: data/SQL, model/dependency, UI/CSS; coordinator owns navigation and integrated verification.
- Production Supabase has the prior three cache tables and collector function; actual Naver cache population was zero at handoff.
- Existing menu/portal permission tests pass, including the new charter center mapping. Direct menu checks show the entry only for center 002.
- Local verification server is running on port 8773; existing port 8769 was occupied and left intact. Browser startup and login-page response verified.
- Independent review of the new draft persistence SQL completed before applying it.
- Applied reviewed migration `pyeongtaek_dispatch_drafts` successfully under the resumed implementation request. Transactional real-DB verification passed create/update, stale revision rejection, center immutability, other-owner read/update denial, anonymous table/RPC denial. All test fixtures rolled back; draft rows and verification users are zero. Security advisor reports no new dispatch findings.
- Browser with mocked DB and real parser/planner passed selected-date filtering, duplicate import, day-off/available fixed-driver allocation, stop conservation, route addition, snapshot save/load and light/dark desktop/mobile overflow checks. No actual Naver requests made.
- First production build hit Windows sandbox EPERM cleaning the verified in-worktree dist directory. Final build succeeded with the required filesystem permission; existing large-chunk warnings remain.
- Independent review found and verified fixes for formatting-only/partial reimports and 1904-calendar dates, ambiguous same-address warehouses, conflicting source versions, textual entry bans, fixed routes incorrectly limited to five stops, and cached legs for obsolete coordinates. Reviewers report no remaining important findings in their focused scopes.
- Final UI checks also passed real XLSX output, selected temporary-route deletion, stale-save error handling, unsaved center/date cancellation, read-only controls and wrong-center denial. Screenshots were inspected in desktop light/dark and mobile dark; internal route UUID labels removed.
- Final lint passed. Eight related existing permission/cache/provider/browser test files passed. Agents also ran the broader pre-existing suite: it is not fully green (missing dependencies/fixtures and assertions outside this feature); no broad regression-success claim is made. No new persistent test files were added.
- Model inline checks passed whole-stop rounding and conservation, absent drivers, unconfirmed 5-ton quotas, midnight windows, missing-time handling, parent-course hints without inheriting capacity. Agent dense 500-stop check completed in approximately 1.48 seconds; optimization remains bounded and provisional.
- Remaining operational prerequisites: actual Naver cache has zero legs; real authenticated provider collection and account allowance verification have not been performed. Production main/Vercel frontend remains unchanged. Draft DB storage is deployed and local UI is available on port 8773.
- Implementation commit `eff84c4` pushed successfully to `origin/codex/pyeongtaek-route-relations`. Local entry: `http://127.0.0.1:8773/admin/pyeongtaek-dispatch.html?center=pyeongtaek`.

## Separate Delivery Profiles Follow-up

- Added source tabs for daily volume and persistent destination delivery profiles. Profile file import, exact identity matching/manual matching, direct editing, template export, and independent delivery-point permissions are implemented.
- Optional daily destination code supports customer-specific labels; a profile is used only with matching code/address or name/address. Unresolved profile identity blocks automatic allocation. Daily OTD/mode mapping is removed.
- Planner snapshots preserve profile values/revisions. Profile changes retain manual draft work but require regeneration before a new save, including when an older saved draft is restored.
- Focused model/data checks and existing menu/portal permission tests passed. Real parser/planner browser checks with a mocked DB passed profile upload/edit/save, next-day reuse, read-only restrictions, charter-read-only plus destination-edit permission, old snapshot invalidation, source conservation, save/load/export, and desktop/mobile themes. Screenshots were inspected. Lint and production build passed; existing bundle-size warnings remain.
- SQL is prepared at `repo-root/sql/pyeongtaek-dispatch-profiles.sql`: nullable JSONB on existing `delivery_points`, center/edit guards, validation, atomic sorted-lock bulk RPC and optimistic revisions. No legacy destination values are overwritten.
- Initial migration attempts returned `cancelled`, including after explicit approval. On the user's subsequent apply instruction, removed unnecessary drop/recreate statements from the migration. Additive migration `pyeongtaek_dispatch_profiles` applied successfully to production Supabase.
- Real-DB transactional checks passed create/update, stale rejection, atomic batch rollback, invalid-value and duplicate rejection, center isolation, direct-update revision/clear guards, legacy-field preservation, viewer edit denial and anonymous RPC denial. All synthetic users and destinations were rolled back. Security advisor has no finding for the new profile objects; existing unrelated findings remain.

## API Collection Placement Correction

- Moved the existing center-to-destination and directed destination-to-destination API collector into provisional dispatch's source-stage road tab. The collector still calls `naver-relations` with the provider's `RECOMMEND` / `traoptimal` option and stores distance/time in the existing API cache.
- Removed collection controls from the Naver shortest-distance page. That page retains server-side Naver web distance-priority jobs and its original workbook flow. Old `mode=relations` URLs redirect to the dispatch road tab.
- Collection uses destination edit permission independently of charter edit permission, locks concurrent in-page work, supports stop/resume and refreshes saved legs into the current draft. Planner ignores cache records with a different declared route priority.
- Existing web-distance, collector/provider and menu tests passed. Playwright desktop/mobile collection checks and volume/profile/snapshot regressions passed with mocked provider responses; no live Naver API request was made. Lint/build and diff checks passed.
