# EAN frosted workspace correction

The user rejected flat panels, ornamental step links/numbers and explanatory blocks, supplied desktop light/dark references, selected frosted glass over liquid refraction, requested minimal icons, and established desktop priority.

## Result

- Shared desktop frame: floating compact navigation rail, expandable permission-filtered navigation, full-width header and center/location capsule.
- One sidebar category open at a time in admin and portal. Internal portal selection returns keyboard focus to the rail toggle.
- Shared neutral frosted surfaces, opaque table interiors, reduced-transparency fallback; no yellow, aurora or liquid distortion.
- Horizontal hub categories, two-column desktop function names, search and all existing permitted destinations.
- Removed redundant section-link boxes, tutorial blocks and decorative number circles from the edited workflow pages. OneTop now aligns template replacement, photo capture/list, analysis/review and export controls.
- Dialog surface motion separated from unscaled text; explicit close/cancel/confirmation controls use the common close path. Existing save-success parent unmounts remain immediate.
- Lucide React 1.64.0 named icon imports for shared navigation, categories, search, account and theme controls. Liquid Glass React was evaluated but is not a dependency or runtime integration.

## Verification

- TypeScript and Vite production build pass. Existing large-chunk warning remains.
- Existing domain tests: 11 pass (permissions, feature access, Excel comparison).
- Temporary browser harness: 24 hub links preserved; both sidebar accordions exclusive; category keyboard navigation; search; account menu focus return; modal focus trap/Escape/close button; unscaled dialog content; Excel comparison/download; distance tabs; denied feature/direct route; zero page errors.
- OneTop fixture check: real default template loaded; simulated camera start/capture/stop; template replacement keyboard access; zero page errors. No paid AI calls or production data writes.
- Desktop light/dark screenshots inspected. Basic mobile compatibility checked before the user set desktop-only optimization priority; no further mobile redesign planned.
- Impeccable detector: no findings on reviewed files. React/accessibility review found and fixed a keyboard-focus loss when collapsing the portal navigation.

## Interaction and layout follow-up

- Shared hover/focus indicators and interruptible rail/menu transitions; CSS press feedback, reduced-motion handling, and stable scrollbar space. Sidebar translucency uses separate theme tokens.
- Corrected duplicate dashboard rail offset and portal maximum-width centering. Dashboard, hub and portal content align at x=127 at both 1440px and 2560px; dashboard outer radius is 20px with 24px insets. Light/dark screenshots checked for overflow and background discontinuities.
- Existing SortableJS handles route/column reordering, keyboard alternatives, drop previews, Escape/outside cancellation, and failed-save rollback. No additional drag library.
- Empty default saved-view controls are hidden. Browser checks cover modified filters, saving, restoring, persistence, deletion and undo.
- Permission directory and aligned read/edit matrix replace nested duplicate forms. Explicit dirty/save state and discard guard added; API contract, normalization, fixed administrator access and viewer restrictions preserved. Mock save payload and permission preview verified; no production permission writes.
- Menu Escape restores focus immediately; 20 menu and 20 menu/dialog reopen cycles passed. Confirmation callbacks run immediately, while ordinary dialog dismissal retains its return transition.
- Full browser harness passes with 24 catalog links and zero page errors; all 11 existing domain tests pass. Temporary checks remain outside the repository.

## Boundaries

This verifies the changed UI and existing local domain checks, not every production workflow. Production authentication, hub, sidebar and OneTop presentation must be checked again after deployment. UX Patterns, shadcn/sidebar and Motion Primitives were reviewed as design/implementation references; no duplicate component framework or MCP installation is claimed.
