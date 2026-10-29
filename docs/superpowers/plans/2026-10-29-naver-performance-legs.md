# Naver capture timing and same-route Excel implementation plan

> **For agentic workers:** Use superpowers:executing-plans; preserve the existing checkout. This scope is authorized for implementation/testing only. No commit, push or deployment.

**Goal:** Reduce repeated address work without dropping permutations, and export the selected route's real legs vertically to Excel.

**Architecture:** Keep the current queue/optimizer/storage. Resolve each distinct address via the existing exact-candidate UI once per job, validate/cache its serialized Naver directions point, and navigate each complete permutation using those points. Observe the browser's own directions response; decode only its published protobuf summary/tag fields, validate raw meters against rendered options and stop count, and retain those legs with the same winning screenshot. Existing capture files and partial successes remain intact. ExcelJS already used by this app produces one vertical worksheet per rotation, original/confirmed address columns, raw-derived numeric km, total/reconciliation and explicit unknown statuses.

**Tech Stack:** Existing Node browser worker, React/TypeScript, ExcelJS, existing tests; Ego Lite for live comparison. No new production dependency/schema/permission.

**Spec:** User delegation 2026-10-29 07:21 UTC, including rotation-specific fixed points, all-permutation real-road comparison, same-winning-route legs, before/after timings and no new deployment authorization.

## Constraints and evidence

- Remote main/local HEAD both 9c7f3e8; clean at start. Preserve later remote/user edits.
- Existing UI detail rounds legs (44+51+43+75 versus total 212km); never sum rounded values as raw evidence.
- The very same captured directions response exposes raw summary.waypoints[].distance, summary.goal.distance, summary.distance via protobuf tag metadata. Observed 43594+50828+42665+74713=211800 meters.
- Public serialized directions URLs retain exact selected point tokens. Cache only exact successful choices within a job. Validate token labels, UI stop list, provider request order and rendered option identity. Fail closed on unsupported response/URL changes.
- Do not call independent point-pair routes, divide totals, invent zeros or skip permutations. Naver requests remain sequential.
- Runtime XLSX reuses the repository's ExcelJS convention (AGENTS takes precedence over the generic artifact authoring recommendation). Use spreadsheet tools for read/render verification.
- Prior Library upload helper reported prepare_uploads unavailable; attempt supported current path once for the final sample and report any blocker separately.

## Tasks

- [x] Add existing-file failing checks for protobuf summary/option mapping, exact meter reconciliation, truncation/missing legs, same-order identity, raw-vs-display ties, valid/invalid cached point URLs.
- [x] Add minimal raw-response summary reader and integrate exact meters with winning capture; never store full route geometry or request headers.
- [x] Instrument address/search refresh, route lookup, option comparison, capture, upload, and request/cache counts. Capture a baseline and revised run with the same course, browser/vehicle settings and sequential request conditions.
- [x] Reuse validated address point tokens, remove only waits replaced by explicit observable conditions, preserve all optimizer/cache/retry/cancel/ownership tests.
- [x] Add typed same-route leg metadata and an ExcelJS vertical export, bulk and per-course buttons; preserve PNG/PDF/ZIP. Original address/confirmed address separate, first leg n/a, unknown blank+reason, raw km 0.000, formula sum and independent raw total/reconciliation.
- [x] Verify representative native Naver result: all options/permutations, selected screenshot/order, raw leg sum, XLSX numeric types/wrapping/layout, partial/legacy/missing cases. Run related tests, lint/build, focused read-only review.
- [x] Report measured results and remaining limits. Leave work uncommitted/unpushed/undeployed for this scope.

## Review focus

- Old checkpoints/results without raw legs must remain distinguishable and usable for existing exports.
- Repeated addresses are visits, not omissions; return-to-center and garage stay fixed.
- A cached point label mismatch or provider option/format drift must not select a nearby place or fabricated distance.
- Missing or mismatched legs must not become zero or a passing sum.
- An image must represent the precise option and raw response selected during its comparison; a resumed winner still needs matching evidence.

Final evidence and explicit operational HTTP400 blocker: ../outputs/naver-performance-legs/final-report.md (outside repository). New changes remain uncommitted/unpushed/undeployed. Library sample libfile_95525b5930788191a3d897a960a64bc9 saved; Windows xattr only failed. Six related tests/build/lint pass. Mobile screenshot and Impeccable engine checks are limited as documented.

