# Naver course capture implementation plan
> **For agentic workers:** Use superpowers:executing-plans. Existing user authorization requests implementation now; execute inline without another approval round.

**Goal:** Excel multi-course import creates real Naver shortest-distance screenshots and batch print output.
**Architecture:** Extend the existing jobs and browser worker; private Storage holds PNGs. Reuse React page, SheetJS, JSZip, pdf-lib.
**Spec:** ../specs/2026-10-28-naver-course-capture-design.md

## Global constraints
Keep legacy distance jobs unchanged. Five intermediate stops including center; fixed order; same starting/ending garage. No new dependencies or repository test files. Check owner and center permissions.

## Review focus
1. Repeated garage and identical courses must not collapse results.
2. Overflow/blank/duplicate names must not silently drop stops.
3. Cancellation and stale leases must not publish another worker's result.
4. Screenshot failures cannot become successful routes.
5. Other users/centers must not read private images.

## Tasks
- [x] Domain: add typed Excel row parsing with source row and stable per-row ID, bounds and roundtrip validation; verify temporary assertions for blanks, overflows and duplicate courses.
- [x] Server: extend jobs with kind/courses; authenticated enqueue and private Storage policies. Extend worker claim, route capture and PNG upload, retaining lease predicates. Verify SQL permissions and existing worker tests plus capture branch checks.
- [x] UI: add tab and import template, per-course results, restore/cancel/retry, signed private images, PNG/ZIP/PDF. Verify TypeScript build and mocked browser multi-course flow including failed course and mobile/light/dark.
- [ ] Verify a real roundtrip on Naver, screenshot dimensions and distance card, run existing distance regression checks, review diff, apply schema, commit/push and check deployment.

## Progress (2026-10-28 KST)
Implemented owner/center-scoped queue and private Storage, Excel validation, actual Naver distance-priority selection/capture, React preview/retry/restore, PNG ZIP/PDF. Build, four existing Naver suites and menu permission checks pass. Mocked browser verified two duplicate courses -> two distinct PNG entries/two PDF pages, partial retry preservation, light/dark/mobile. Live public-address roundtrip and maximum five intermediate stops captured; no mathematical shortest-path guarantee. SQL rollback verified unauthenticated rejection, owner/cross-user queue/cancel/storage access, retry preserving successful results. Production additive migration applied. Commit/push and CI live upload verification pending. No live staff browser login used.
