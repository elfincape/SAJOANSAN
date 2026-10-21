# React migration progress

Spec: user instructions in this conversation. Plan: docs/react-migration/plan.md.
Base: f083c1e. Branch: react-migration. Original files remain intact.

- User-approved correction: keep Vercel Root Directory at repository root; keep api/ and server/ in place. Install/build run in app; output app/dist. Production settings remain unchanged until parity verification.
- Pre-flight: common CSS has direct body-child selectors. React mounts at body so no additional root wrapper changes geometry. Shared shell and page-local style load order must remain equivalent.
- Pre-flight: auth/session, center, permission context and page queries must retain contracts. Move queries to src/lib; no DB/schema/Edge changes.
- Pre-flight: legacy tests include scripts with production writes; run relevant isolated checks only. AGENTS.md forbids separate committed test files; use existing tests and private temporary browser assertions.
- Setup: complete. Baseline legacy npm run build passed (existing large-chunk warning).
- Screens: 6/33 migrated (login, image straightener, dispatch parser, pallet slips, Excel compare, settings). Portal internal views require separate commits.

- Login: npm run build passed (TypeScript + Vite); existing username-auth and menu-permissions checks passed; temporary Playwright assertions passed for empty fields, invalid username/email credentials, inactive reason, theme and mobile overflow. No live backend requests. Redirect allowlist assertions passed. Impeccable detector: no findings.

- Image straightener: TypeScript/Vite build passed; temporary isolated Playwright passed multi-file ingestion, circular navigation, per-photo rotation retention, responsive shared shell, native dialog Escape. Impeccable: no findings. Reused original catalog/settings behavior and CSS; no live requests. Removed generated tsbuildinfo from tracking and ignored it.

- Dispatch parser: original pure parser extracted to typed domain module without algorithm changes. Legacy-result parity fixtures passed (single/batch/slash/phone/empty/warnings); isolated Playwright passed shortcut, result format/TSV, reorder, clear, empty state. TypeScript/Vite build and Impeccable passed.

- Pallet slips: pinned npm SheetJS replaces CDN; typed matching model preserves first-hit/cell copy and unmatched cells. TypeScript/Vite build passed. Temporary browser verification passed real XLSX upload/download cell assertions and option recalculation; Impeccable passed.

- Excel compare: original model ported with explicit TypeScript types. Existing model cases passed against new module via private adapted runner; isolated browser passed comparison/import requirement/duplicate data/filter/invalidation/existence/mobile and downloaded workbook sheets. TypeScript/Vite and Impeccable passed.

- Settings: full 27-feature catalog, search-scoped bulk switches, defaults, persistence and storage event verified in isolated Playwright. TypeScript/Vite and Impeccable passed. Owner-only access kept.
