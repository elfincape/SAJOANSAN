# Gimhae Dispatch Messages Implementation Plan

**Goal:** Deliver the user-approved CJ photo -> carrier request -> raw reply -> CJ message workflow in the existing admin hub.
**Architecture:** Vanilla modules in the existing shell. Deterministic message generation; authenticated Haiku extraction only. Owner/center-scoped versioned drafts, separate from actual charter trips and route planning.
**Spec:** This conversation's workbook review and answers 1-13. User explicitly requested implementation after the interview; no further design approval round.

## Rules
- Seoul business date; Saturday initially selects Sunday. Explicit CJ photo date wins.
- Gwangsin covers Gwangju/Jeonju every day. Hayang uses Dongjin weekdays and Happy weekends, based on business date.
- Request tons/count are external inputs, never inferred from pallets. CJ uses requested tons, with carrier-provided per-vehicle loading text appended.
- Gyeongsan aliases Hayang. Carrier reply order is preserved. Dock sequences: Gwangju 4,5; Jeonju 6; Hayang 2,3. No temperature-based dock rule.
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
