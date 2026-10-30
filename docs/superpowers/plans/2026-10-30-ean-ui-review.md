# EAN UI change review

Base: dd904be (origin/main at branch creation). Scope: UI dependencies, shared React layout, themes, hub, workflow presentation and design documentation.

## Result

No new critical/high/medium security findings in the inspected diff. UI regression risk is moderate because the frame/provider cover all application pages and Modal has seven calling files. Authentication, permission evaluation, Supabase clients/functions, data schemas and business domain calculations have no changes. Existing access checks remain inside AdminPage and featureAccessible; the common frame receives only allowed navigation and does not grant access.

## Verification

- TypeScript and production Vite build passed. Existing large-chunk warnings remain.
- Existing permission, private-feature and Excel tests: 11 passed. The Excel test uses the app's already installed xlsx through XLSX_TEST_MODULE.
- Temporary Node Playwright checks on the React development app passed with isolated mock Supabase responses and blocked external requests: 24 permitted hub links match the sidebar plus the original portal entry; keyboard tabs; search/empty/reset; menu Escape/focus; modal focus trap/Escape; light/dark; mobile drawer; reduced motion; parser output; Excel upload/column mapping/comparison/two result rows/download; distance/capture tabs; result-area download; portal shell and desktop/mobile overflow; hidden driver feature and denied direct driver route.
- Light/dark hub, 390px mobile and portal screenshots were visually inspected. Fixed a nested-tab offset problem by moving body width/offset ownership into WorkspaceFrame, and removed the portal's duplicate margin.
- Impeccable detect returned an empty findings array for shared UI files. React hooks, Radix labels/IDs, keyboard focus, reduced motion and navigation/center guards were reviewed.
- A browser-fixture issue was corrected only in the temporary harness: absent maybeSingle rows must be null, not an empty array. Production query handling was not changed for that fixture issue.

## Dependencies and limits

Motion 14.8.0, Radix Dialog 1.3.1, Dropdown Menu 2.2.1 and Tabs 1.2.1 are pinned in the app lockfile. npm audit reports three existing issues in xlsx (high), exceljs and its uuid dependency (moderate); none are attributed to the added Motion/Radix packages. The xlsx/exceljs versions already existed at the base commit. No forced or major-version audit fix was applied to the business file-processing libraries.

Verification used mock authentication/data and local files, not production database mutations, paid routing/capture requests, real OneDrive uploads or live mail. No claim is made that all external integrations were exercised. Portal-specific task dialogs retain their existing guarded native-dialog lifecycle; shared admin dialogs use Radix. Programmatic unmounts after completed actions remain controlled by their callers.

## Maintenance

WorkspaceProvider owns theme storage/synchronization, CSS layers and MotionConfig. WorkspaceFrame owns all chrome and body offset, so composite pages need no separate sidebar calculation. AdminPage preserves authorization and embedded-page behavior. FEATURE_CATALOG still feeds hub/sidebar/commands. WorkflowNavigation supplies the shared input/review/execute/results sequence. DESIGN.md documents the required extension path for future pages.
