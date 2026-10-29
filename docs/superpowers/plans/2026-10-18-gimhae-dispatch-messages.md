# Gimhae Dispatch Messages Implementation Plan

## Current provider decision (2026-10-29)
- User reported repeated JEV + Haiku failures and authorized removing the hybrid feature if it could not be made dependable. Keep this tool scoped to carrier request text, reply extraction/normalization, CJ dispatch text and the first vehicle-operation summary.
- Production logs on 2026-10-28 showed `gimhae_jev_uncertain` for two request temperature fields. A local regression reproduced successful Haiku extraction being rejected solely because the subsequent JEV call failed.
- Retire the hybrid selector, JEV-only image submission conversion and JEV review module. Use the existing Haiku extractor directly. Accept the old `provider: jev` request from already-open tabs but truthfully return `provider: haiku`; no JEV request or key dependency remains in this function.
- Preserve authentication, center read/edit checks, image/text limits, input retention, manual correction, report generation and the shared JEV tools used elsewhere. No credentials, permissions, tables or other features change.
- Verification: the failing handler regression now passes for old/default/Haiku callers, source-field preservation, denied permissions, invalid provider and upstream rate limits. Mock browser checks passed photo → carrier text → reply failure/retry → CJ + first summary, phone/time normalization, mobile light/dark and zero runtime errors. This is not a fresh live Haiku OCR accuracy evaluation.
- Supabase production function version 9 is ACTIVE with JWT verification enabled; read-back confirms only index.ts/handler.js, Haiku response metadata and no JEV dependency. TypeScript/Vite build, menu-permission checks, targeted handler lint/format and UI detector passed (existing bundle-size warning remains).

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
- Format mobile contacts with hyphens and arrival times as HH:MM, omitting before/after conditions and interpreting explicit 오전/오후; leave arrival blank when no time can be identified. Show arrival only in the vehicle operation summary; omit it from CJ dispatch contacts and carrier requests.
- Verification: supplied five-vehicle shape in all 120 reply permutations; repeat and normalization idempotence; volume preservation; missing-info enrichment; prior-link repair; fixed-driver preservation; actual/request tonnage separation. Existing browser workflow and supplied-image UI with mocked extraction verify resulting CJ text without operational writes.

## Loading Notes and Empty-Slot Follow-Up (2026-10-25)
- A request slot containing only a loading description is available for a real vehicle reply. Ignore extracted description-only pseudo-vehicles and remove excess empty slots, while retaining all identified vehicles and fixed assignments.
- Match replies with clear temperature/tonnage first; a reply without tonnage can use the remaining compatible request. Missing tonnage does not require an additional truck.
- Suppress loading notes that only repeat the displayed temperature/tonnage and “상차”. Preserve pallet quantities, loading limits, partial loads and additional instructions. Source loading text remains in the draft.
- Verified both reply orders, description-only placeholders, surplus empty slots, repeat idempotence, no-ton final-slot matching, redundant note suppression and special-note preservation.

## Source-Reconciliation Follow-Up (2026-10-25)
- Reproduced the observed four-vehicle extraction with the user's raw source: the second Hayang truck is missing and its time is attached to the first.
- Cross-check source vehicle plates against extracted records. For explicit standalone plate/name/phone blocks with a route and temperature, recover fields directly from that block; a route/time heading before the next vehicle belongs to the next block. Clear previously misassigned arrival when the source block has no time.
- If a source plate remains unaccounted for, reject application before changing the draft. Preserve details across repeated partial records and avoid duplicate vehicles.
- Verification uses the actual supplied text plus a fixture matching the observed faulty extraction, not a claim that live AI extraction was rerun. Repeated source, stale arrival correction, missing-plate failure without mutation, and the rendered five-vehicle output are checked.

## Analysis Provider Selection (2026-10-27)
- User-approved default: JEV verification + Haiku extraction. Haiku-only remains selectable. JEV is a decision API, not a free-form OCR generator; both providers are explicitly named in the UI.
- Existing authenticated/center-authorized Edge Function first extracts with Haiku, then uses JEV image choices to verify/correct requested tonnage, temperature and count; mismatched request row counts, unsupported values and confidence below 0.6 reject the result. Replies use original text to check explicit actual tonnage. This threshold is a review policy, not a measured accuracy guarantee.
- Keys remain server-only: existing AIAPIFLOW_API_KEY and new TYPESAFE_API_KEY in Supabase Edge Function secrets. Missing JEV configuration returns an actionable error; no silent fallback or browser key storage. Legacy callers without provider keep Haiku behavior; the new UI defaults to JEV.
- Selection affects both photo/reply analysis, allows same-input reanalysis, and locks during requests. Reanalyzing a photo with existing assignments requires the existing confirmation flow and supports undo.
- Verification: live JEV on synthetic image corrected deliberately wrong 11/5/3.5/11/5 ton values, temperatures and counts; malformed, uncertain, omitted and count-mismatched answers reject. Handler tests cover provider allowlist, old clients, missing keys, authentication and center denial before external calls. UI checks cover switching/retry, failure preservation, stale-output guards and mobile themes. Original uploaded image is unavailable in this execution environment; no claim of retesting its live OCR.

## JEV Image Compatibility Fix (2026-10-27)
- Investigated production 502 failures. A bounded synthetic call from the deployed Supabase runtime using its registered secret returned JEV HTTP 200; temporary startup diagnostics were removed in Edge Function version 7.
- Official TypeSafe image limits are 280–1568 pixels on each axis. Reproduced HTTP 400 Invalid image dimensions with an 803×219 fixture. Existing photo handling allowed 2400px and no minimum height.
- JEV submission now pads short axes to 280px with white space and scales long axes to at most 1568px without cropping or changing aspect ratio. Original preview and Haiku-only image handling stay intact; existing images are normalized at submission as well.
- Reference the image in state only, not once in every question, avoiding repeated image expansion. Error messages distinguish 400/401/403/413/429 and server failures; logs include status and mode only, without images, source text or credentials.
- Browser verification: 803×219 becomes 803×280; 2400×900 becomes 1568×588. The browser-normalized previously rejected fixture returned actual JEV HTTP 200 with expected 11/5/3.5/11/5 ton selections. User's current image is not persisted server-side; its exact rejection payload was unavailable in historical logs.
