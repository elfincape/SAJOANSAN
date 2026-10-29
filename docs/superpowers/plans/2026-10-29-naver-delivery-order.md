# Delivery-order shortest-distance implementation plan

**Goal:** Compare every distinct delivery permutation using all displayed Naver driving road-route options, with garage/center/end fixed per existing rotation contracts. Capture only a fully verified winner.

**Architecture:** Keep the existing importer, queue, storage and exports. Add a focused sequential optimizer around the existing browser capture; measure without screenshots, persist per-route checkpoints in existing results JSON, and recapture/verify the winning route. Preserve successful rotations and reusable measured routes on retry. No new tables, dependencies, push or deployment.

**Tech stack:** Existing Node/Playwright worker, React/TypeScript UI, Supabase results JSON.

**Spec:** Parent delegation dated 2026-10-29: general garage→center→deliveries→garage; rotation 1 garage→center→deliveries→center; rotation 2 center→deliveries→garage. Optimize deliveries only, skip blanks, preserve per-rotation limits. Compare all provided driving options by displayed road distance for every candidate; ties retain original permutation traversal, then Naver option order. No first-success/global-shortest claims after missing candidates. Actual unresolved addresses remain errors.

## Tasks

- [x] Add failing cases to existing browser/worker tests: six permutations, fixed stops, road-distance ranking, ties, duplicate routes, partial failure/resume/cancel, final capture consistency, 270 vs 270-1, fresh search results.
- [x] Implement permutation optimizer and exact address candidate selection; retain browser route/capture code and sequential requests. Verify tests.
- [x] Connect worker checkpoint/heartbeat/cancellation and retry JSON preservation through existing queue contract. Verify rotation isolation and completed-image preservation.
- [x] Show estimated comparisons before start, current per-course progress, selected ordered stops and verification policy; label historical results unverified. Keep per-rotation PDF/ZIP output.
- [x] Run relevant existing checks, TypeScript/build, source review and a small real Naver check if available. Report limits and local-only status.

## Review focus

- Duplicate deliveries retain multiplicity but remove equivalent permutations.
- Cache identity includes ordered stops, rotation and comparison policy; failed or incomplete routes are never cached as successes.
- Worker pause/cancel must not advance cursor or overwrite completed rotations.
- A final screenshot with changed distance/order must not become a verified result.
- Old captures remain explicitly input-order/unverified; incomplete checkpoints have no exportable final image.

## Ledger

Baseline: 288a229; isolated task checkout on fix/naver-delivery-order. Existing naver-browser and worker checks passed (pre-existing MODULE_TYPELESS_PACKAGE_JSON warning).
Ruling: Proceed from the detailed approved implementation delegation without another design approval round. Preserve this checkout as explicitly requested.
Ruling: Compare all displayed driving options, rather than trusting the distance-priority label. Real Naver row-13 evidence showed distance-priority 184km while free-priority was 175km in the same results. This is necessary for the requested shortest displayed road distance.
Verification: Final all-options row-13 live check evaluated both permutations and recaptured the winner at free-priority 176km; option, order, displayed distance, and selected-card activation matched. Live distances can change between requests.
Review: Fresh read-only reviewer found a worker-lease gap. Added atomic ownership-guarded heartbeat and a failing-then-passing lease-loss regression. Re-review found no further critical/important issues.
Final: Six related existing test scripts passed, plus original-extracted-row/rotation/blank/ZIP/PDF checks, lint, TypeScript and app build. Desktop/mobile DOM/layout verified; extra UI screenshots blocked by a minimized Ego window. Original Windows materialization remains unsupported by the official xattr helper; no claim of a full raw-original-file upload here. No commit, push, live DB update or deployment.
Release approval: User approved deployment on 2026-10-29 at 05:10 UTC. Revalidated the final six related tests and app build; remote main still matches baseline 288a229. Proceed with the existing GitHub/Vercel release and verify both frontend and capture worker. Release evidence is recorded in the task's final report.
