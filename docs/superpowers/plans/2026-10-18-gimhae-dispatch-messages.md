# Gimhae Dispatch Messages Implementation Plan

**Goal:** Deliver the user-approved CJ photo -> carrier request -> raw reply -> CJ message workflow in the existing admin hub.
**Architecture:** Vanilla modules in the existing shell. Deterministic message generation; authenticated Haiku extraction only. Owner/center-scoped versioned drafts, separate from actual charter trips and route planning.
**Spec:** This conversation's workbook review and answers 1-13. User explicitly requested implementation after the interview; no further design approval round.

## Rules
- Seoul business date; Saturday initially selects Sunday. Explicit CJ photo date wins.
- Gwangsin covers Gwangju/Jeonju every day. Hayang uses Dongjin weekdays and Happy weekends, based on business date.
- Request tons/count are external inputs, never inferred from pallets. For a region with one chilled and one mixed-temperature request, the larger tonnage is mixed-temperature; messages list chilled first. CJ output uses explicit actual reply tonnage when available and otherwise the matched request tonnage, preserving loading details.
- Gyeongsan aliases Hayang. Replies match region, temperature and explicit tonnage instead of source order; ambiguous replies remain unlinked for confirmation. Automatic dock sequences follow chilled-first request order: Gwangju 4,5; Jeonju 6; Hayang 2,3. Manual docks and registered fixed-driver docks remain authoritative.
- Gwangsin request/instructions and expected volume are two messages. Hayang is one message.
- No pallet deficit allocation, automatic extra truck orders, Kakao sending, or revised-CJ merge workflow.
- Use existing Haiku server credential; do not store or use the JEV credential exposed in chat.
- Keep center permissions and owner data isolation; no new center or charter trip writes.

## Tasks
- [x] Model: dates, request/vehicle normalization, reply mapping, deterministic messages; inline checks against examples.
- [x] Backend: bounded authenticated extraction, existing dispatch_parser permission, RLS draft storage with optimistic revisions; denial/conflict checks.
- [x] UI: hub/sidebar entry, photo paste/drop/upload, editable requests/replies, preview/copy, saved drafts, dark/mobile states.
- [x] Verify: targeted checks, production build, desktop/mobile browser exercise, independent review, deploy backend and frontend, verify live availability.

## Review Focus
- Late API responses must not overwrite subsequent input; disable editing during calls.
- Unknown regions must remain visibly unlinked, never silently discarded.
- Partial replies must not erase previous vehicles; repeated replies must not duplicate plates.
- Date/center changes must not leak or silently move persisted drafts.
- Blank/zero tons and missing vehicle details must not produce a falsely completed CJ report.

## Verification Ledger
- Baseline clean at b33625d; already in linked worktree. Existing DB candidates are trip/route-specific, so a dedicated small draft table avoids corrupting those contracts.
- Initial model check fails with module missing, before implementation. Repository instruction prohibits separate test files; use inline checks and browser tooling.
- Model and handler inline checks passed: Seoul Saturday/date override, weekend carrier, region alias, requested tons preservation, loading text, authentication/center denials, malformed/truncated provider results.
- Independent review identified dock reconciliation, surplus linking, order preservation, dated-record overwrite, unknown-volume loss and whitespace validation. Fixed all with regression checks; automatic docks follow current sequence, explicit dock edits persist, surplus replies require manual request linking, unknown/duplicate volume regions reject import visibly.
- Browser QA uses isolated mock auth/DB/API responses, not production bypasses: photo upload/render, parsing UI, reply analysis, duplicate reply, output grouping, copy content, missing details, save and date fork all passed. Desktop 1440x1000 and dark mobile 390x844 checked; no overflow/broken images/runtime errors. Main margin override found visually and removed.
- Production migration dispatch_message_drafts applied. Transactional authenticated checks passed create/update, stale revision rejection, wrong-center denial, identity-update denial, other-owner read/write denial and anonymous denial. All verification rows rolled back; table count 0. Security advisor has no finding for new objects.
- Production gimhae-dispatch-parse version 1 ACTIVE, platform JWT verification enabled and in-function user/center checks. No provider key is exposed; no JEV key stored or called.
- Targeted ESLint, existing menu-permissions tests and Vite production build passed. Existing large-chunk warning remains unrelated.
- Feature commit 0360cb6 pushed atomically to main and codex/gimhae-dispatch-messages. Vercel reported success; live hub shows 25 tools including the new menu.
- Authenticated production Haiku image extraction passed with the supplied CJ image: 2026-10-16, pallets 2/8, 1/3, 3/10 and requested 5/3.5/8 tons, one vehicle each. Weekday Hayang correctly uses Dongjin.
- Production Haiku raw-reply extraction passed with clearly synthetic vehicle details: Gyeongsan aliases Hayang, actual tonnage remains separate, carrier loading text is preserved. Generated CJ text keeps requested tonnage; copied clipboard text exactly matches the preview.
- Synthetic production UI inputs were discarded without saving; no Kakao message was sent. Live screenshot recorded outside the repository at ../gimhae-dispatch-live.jpg.

## Fixed-Driver Follow-Up
- User requested saved default fixed drivers, checked by default, optional daily exclusion, and inclusion in initial carrier request text.
- Reuse dispatch_message_drafts with a generated record_kind and unique owner/center defaults index. Existing save RPC, RLS and optimistic revision checks remain in place. Daily drafts retain their own fixed-driver snapshot; defaults never appear in dated history.
- Fixed drivers match region/dock with an optional carrier restriction. Unchecking removes that driver's assignment, not the CJ-requested vehicle count. New work and a different business date reset inclusion; same-day photo reimport preserves exclusion.
- Carrier text keeps the explicit requested count and adds fixed-driver contacts separately. Existing manual replacements and confirmed replies are preserved; surplus confirmed replies remain unlinked for review rather than disappearing.
- Inline model regressions, targeted ESLint, existing menu-permission test and production build passed. Independent review findings were addressed, including dock movement, date transitions, request counts and reply preservation.
- Isolated browser QA passed default save/reload, carrier text, daily exclusion save/load, new-work reset, phone/load text preservation, manual replacement preservation and date reset. Desktop and dark mobile 390px have no page overflow or runtime errors.
- Production migration applied; transactional create/update, duplicate defaults, stale revisions, record-kind mutation, cross-center, other-owner and anonymous access checks passed. Test writes rolled back; no operational defaults or dispatch data inserted.

## Paste-Only Follow-Up
- Replace tabs with one page: paste/readonly request summary, carrier messages, raw reply and CJ messages. Remove file selection, drop, normal analyze/remove controls, request/quantity editing and separate common-instructions editor.
- Decode and show the pasted photo before the existing API call. Replies analyze on text paste; failure or edited text exposes retry. Preserve fixed-driver defaults and daily exclusion.
- Persist pending image/reply state. Hide stale outputs while pending; incomplete extraction remains retryable after load/undo. Undo after saving a replacement retains the current optimistic revision and marks restored content dirty.
- Compare imported pallets and requested ton/count against the existing haul calculator in a bounded module worker. Only differences or unavailable comparisons appear; no CJ request mutation, rate editing or standalone calculator UI. Existing private-price visibility applies.
- Targeted lint, existing haul and menu tests, production build passed. Isolated browser checks passed preview-before-API, duplicate photo, automatic reply, failure/undo, pending reply save/load, retry dedup recovery and replacement-save/undo/resave. Desktop and 390px mobile checked in both themes with no overflow or broken images.
- Existing parse function version 2 deployed with only paste/retry error wording changes; JWT and center authorization unchanged. No schema changes.

## Reply Matching and Formatting Correction (2026-10-25)
- Corrected sequential first-empty-slot assignment. Resolve specific replies before incomplete ones; repeated plates update existing rows. Reanalysis can repair prior mismatched request links without losing other incoming vehicle details. Insufficient evidence remains unlinked and blocks CJ copying.
- Larger tonnage receives mixed-temperature designation when a region requests one chilled and one mixed-temperature row. Preserve each requested tonnage and count, list chilled first, and use confirmed actual tonnage in CJ/operation output.
- Format mobile contacts with hyphens and arrival times as HH:MM, omitting before/after conditions and interpreting explicit 오전/오후; leave arrival blank when no time can be identified. Include arrival in CJ contacts.
- Verification: supplied five-vehicle shape in all 120 reply permutations; repeat and normalization idempotence; volume preservation; missing-info enrichment; prior-link repair; fixed-driver preservation; actual/request tonnage separation. Existing browser workflow and supplied-image UI with mocked extraction verify resulting CJ text without operational writes.
