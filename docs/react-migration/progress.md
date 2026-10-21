# React migration progress

Spec: user instructions in this conversation. Plan: docs/react-migration/plan.md.
Base: f083c1e. Branch: react-migration. Original files remain intact.

- User-approved correction: keep Vercel Root Directory at repository root; keep api/ and server/ in place. Install/build run in app; output app/dist. Production settings remain unchanged until parity verification.
- Pre-flight: common CSS has direct body-child selectors. React mounts at body so no additional root wrapper changes geometry. Shared shell and page-local style load order must remain equivalent.
- Pre-flight: auth/session, center, permission context and page queries must retain contracts. Move queries to src/lib; no DB/schema/Edge changes.
- Pre-flight: legacy tests include scripts with production writes; run relevant isolated checks only. AGENTS.md forbids separate committed test files; use existing tests and private temporary browser assertions.
- Setup: complete. Baseline legacy npm run build passed (existing large-chunk warning).
- Screens: 20/33 migrated (login, image straightener, dispatch parser, pallet slips, Excel compare, settings, admin hub, paused Notion health, audit log, vehicles, companies, drivers, delivery points, routes, route-stop editor, users, course export, CSV import, transfers, daily temperature). Portal internal views require separate commits.

- Login: npm run build passed (TypeScript + Vite); existing username-auth and menu-permissions checks passed; temporary Playwright assertions passed for empty fields, invalid username/email credentials, inactive reason, theme and mobile overflow. No live backend requests. Redirect allowlist assertions passed. Impeccable detector: no findings.

- Image straightener: TypeScript/Vite build passed; temporary isolated Playwright passed multi-file ingestion, circular navigation, per-photo rotation retention, responsive shared shell, native dialog Escape. Impeccable: no findings. Reused original catalog/settings behavior and CSS; no live requests. Removed generated tsbuildinfo from tracking and ignored it.

- Dispatch parser: original pure parser extracted to typed domain module without algorithm changes. Legacy-result parity fixtures passed (single/batch/slash/phone/empty/warnings); isolated Playwright passed shortcut, result format/TSV, reorder, clear, empty state. TypeScript/Vite build and Impeccable passed.

- Pallet slips: pinned npm SheetJS replaces CDN; typed matching model preserves first-hit/cell copy and unmatched cells. TypeScript/Vite build passed. Temporary browser verification passed real XLSX upload/download cell assertions and option recalculation; Impeccable passed.

- Excel compare: original model ported with explicit TypeScript types. Existing model cases passed against new module via private adapted runner; isolated browser passed comparison/import requirement/duplicate data/filter/invalidation/existence/mobile and downloaded workbook sheets. TypeScript/Vite and Impeccable passed.

- Settings: full 27-feature catalog, search-scoped bulk switches, defaults, persistence and storage event verified in isolated Playwright. TypeScript/Vite and Impeccable passed. Owner-only access kept.

- Admin hub: catalog/center filtering, search/category/reset, feature event and mobile verified. TypeScript/Vite and Impeccable passed; original href/query parameters retained.

- Notion health: paused notice and four disabled actions retained; browser verified no sync call. TypeScript/Vite and detector passed.

- Audit log: queries isolated under src/lib; 51 mock records verified 50-row server pagination, before/after values, ignored updated_at noise, raw JSON and Escape; empty/filter/reset also passed. TypeScript/Vite and Impeccable passed.

- Vehicles: TypeScript/Vite and detector passed. Isolated browser verified list/counts, selection, draft cancel, tonnage normalization, company filter, relation-aware deletion confirmation/cancel, required plate, viewer read-only write block. Actual CRUD not exercised against live DB; mutation contract verification remains mock-only.

- Independent auth/permission review (af582cc): no concrete privilege escalation found. Two behavior regressions found and fixed: shared drop/paste interception and section anchors. React FileTransfers/FileArea now validate registered zones and block outside drops; actual initial image drop, XLSX card drop and invalid extension assertions passed. Login/image/Excel/pallet/settings/hub rechecks passed. CSS import order restored (common → page → workspace → theme). Original Excel fieldset has three sections; restored three anchors rather than adding a fourth section.

- Companies: queries separated; shared React document panel preserves owner generations, pending lock, per-file request IDs, multiple backsides and preview URL cleanup. Mock OneDrive browser check passed linked company selection, cancel, four document kinds, sequential uploads/IDs, preview, deletion and unsaved-owner gating. TypeScript/Vite and Impeccable passed. Real OneDrive/prod CRUD were not invoked.

- User confirmed the referenced PYT template does not exist. Preserve missing-template behavior; do not invent or substitute a workbook. This no longer needs a user answer.

- Drivers: paginated center queries/document chunks, health schema fallback, KST expiry priority, eight kinds and PDF logic ported. Browser verified linked selection, expiry ordering/checks, cancel, filtered list and whole-center PDF missing-doc skips. Typed date assertions passed; existing PDF batch scenarios passed against new typed module (sequential, partial failure, stop, save verification). TypeScript/Vite and detector passed. Live DB and OneDrive not used.

- Delivery points: original fields/layout converted to controlled React form; separate typed photo/time helpers and query/schema retry adapter. Browser passed linked selection, contact/radio compatibility, region extraction, 00:00-based time normalization, photo add/delete/cancel, search/filter/new validation. TypeScript/Vite and detector passed. Existing legacy blur warning text retained even though actual shared time policy is 00:00–23:59. Cross-screen mocked CRUD write/error contracts still need final integration verification; live writes remain unperformed.

- Routes: original AG Grid dependency/version retained; React-owned editor and cell content mounted through library lifecycle refs, no React grid wrapper dependency. Browser passed grid/counts, edit defaults, company-dependent driver/vehicle options, closed days, detailed filters/reset and delete confirmation. TypeScript/Vite and detector passed. Route-stop iframe parity awaits route-edit migration.

- Route-stop editor: typed stop queries/forms and original SortableJS version retained. Browser passed metadata/slack, overrides, duplicate confirmation/cancel, unregistered stop selection, and failed reorder rollback. TypeScript/Vite and detector passed. Two-phase save ordering and separate drag ordering remain equivalent; no live writes.

- Users: global profile list and original account/protection flows retained. Isolated browser passed create through mocked username-auth, update payload excluding role, toggle, cancel, self protections and center-aware portal permission link. TypeScript/Vite and detector passed. No real accounts created or changed.

- Course export: original queries/unassigned inclusion and typed flattening retained, pinned npm PapaParse replaces CDN. Browser read downloaded XLSX/CSV and passed leading zeros, time, enum/memo normalization, filters/reset, sort movement, zero-column fallback and BOM/filename. TypeScript/Vite and detector passed; mocked reads only.

- CSV import: typed normalization matches original across 80 generated parity cases. Browser passed mapping, warnings/unassigned points, four section anchors, dry-run zero writes, mocked ordered updates and stop insert payload, failure stop/unlock. The original replace=false path still inserts stops; misleading existing upsert guidance was not silently reinterpreted. TypeScript/Vite and detector passed; no production writes.

- Transfers: original four-photo compression/edit merging, center-scoped sequential save/delete and exact binary template preserved. Browser passed photo retention/deletion, mocked update payload, route defaults/phone, added photo compression, unsaved selection deletion, and downloaded workbook cell values/image anchors. TypeScript/Vite and detector passed. Original form reset/edit-index behavior retained; live writes not invoked.

- Daily temperature: real default and uploaded templates verified in browser; threshold-derived status, whole-day edit, embedded batch parser, added roles, exact separator preservation and downloaded cell/style/row-height assertions passed. Missing PYT template remains error/disabled, with no substitute. TypeScript/Vite and detector passed. Legacy actualRowCount-first scanning and style fallback rules retained; sparse nonstandard worksheets share existing limitations.
