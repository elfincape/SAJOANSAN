# Naver Checkpoint Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Preserve the existing independent rotations and approvals.

**Goal:** Resume interrupted work from confirmed server checkpoints without restarting route comparisons or mixing changed input.
**Architecture:** Keep current naver_browser_jobs/API jobs. Restore the frozen job and its validation/candidate references, add an owner-scoped in-place resume operation, bound retries of idempotent queue transport writes/reads and preserve workflow continuation after infrastructure failure. Do not bypass Naver restrictions or silently retry provider-attention jobs.
**Tech Stack:** Existing React, worker Playwright, Postgres RPC, Node/PGlite assertions.
**Spec:** Latest user request: frequent interruptions must preserve address verification, candidate evaluation, independent rotations, query/capture results, and resume after reload/reconnection/timeout/server errors; changed files/conditions invalidate incompatible checkpoints; no duplicate output.

## Confirmed evidence

- Operating run 41312177678 exited 2026-11-01 14:03:10 UTC with `Server queue query failed: HTTP 502` (downloaded GitHub log).
- Workflow handoff step has no failure condition, so it is skipped when worker exits, leaving the hourly schedule as recovery.
- Latest capture 20c2ff91 has 3 saved images, 8/11 comparisons and attention at first unfinished course. Error is NAVER_ROUTE_UNAVAILABLE/HTTP400 with empty response body and no confirmed access/captcha marker; provider-internal cause remains unknown.
- Existing optimizer already saves per-permutation checkpoints and verifies unchanged input; do not replace it.
- Current UI recreates a capture job on retry, refreshing shortlist evidence/TTL rather than resuming its frozen plan. UI state and validation/candidate job IDs are not restored together on reload.

## Tasks

- [ ] Extend existing worker/lifecycle suites with one transient queue502 during heartbeat/checkpoint and permanent/ambiguous-claim errors. Add bounded retries only for idempotent SELECT/UPDATE operations; claim stays single-attempt. Handoff runs after worker failure but not cancellation/setup failure.
- [ ] Add owner/center/input/strategy-fenced resume RPC for the same frozen job, preserving successful results/optimization/validation/candidate references and requeuing only unfinished approved items. Test replay, cross-owner denial, changed input rejection and partial rotations in isolated SQL.
- [ ] Restore latest matching server work and exact validation/candidate references in existing UI. Existing start action resumes unchanged terminal work without rebuilding the API plan. New file/conditions use normal validation/enqueue flow. Test React reload/error/retry behavior locally with mocked transport.
- [ ] Make capture object publication paths deterministic per frozen job/course, preserve known verified output before cursor replay, and test upload/retry duplicate behavior without real user data.
- [ ] Review cache/settings checks and expired API partial-stage recovery; preserve completed matrix edges when valid and avoid silently treating incomplete selection as success.
- [ ] Run existing suites, build, isolated rollback checks and review. Existing authorized deployment may proceed once safe, without resuming real attention jobs or processing private route fixtures as tests.

## Local verification result

- Queue502 heartbeat/checkpoint retry passes without repeating route measurements. Persistent failure (including inside measurement heartbeat) remains infrastructure failure, does not advance cursor, and does not become a route failure. Ambiguous claim is never replayed.
- Same-job resume preserves result JSON, original validation/candidate IDs and plan, removes finished approved rotations from pending work, rejects changed inputs/mode/cross-owner, and is idempotent when queued/running.
- Newly approved previously blocked courses use new validated enqueue. Unchanged completed web comparisons can survive fresh API timestamps only when plan inputKey (including settings/coordinates) and candidate index set still match; changed vehicle settings do not reuse old output. The 30-minute API freshness rule remains for new selection.
- Actual local React component/shared client verification: restore frozen input/strategy/approval IDs, lost-ACK repeat keeps same job, reload does not enqueue or rebuild APIs. Separate parent-component scenario simulates child approval update and confirms previously blocked work follows new approved enqueue instead of frozen resume loop.
- Image publication uses owner/job/course/PNG-sha256.png, so exact retry is idempotent and a late obsolete worker cannot overwrite different image bytes. Known verified capture avoids remeasure/reupload after lost cursor acknowledgment.
- Reviewer found three Important defects (mutable shared image path, blocked-course resume loop, nested queue error swallowed as route failure). All corrected and covered by regressions.
- Existing Naver suites (7 files) pass with isolated PGlite enabled; app build passes with existing large-chunk warning. Browser tests use isolated mocked transport, not user PC/Ego or private routes.
- Impeccable detect attempted on both changed components: exit127, pinned engine unavailable and default home cache not writable. No duplicate engine installed; manual guideline review and real local React render used.
- Actual Naver routeHTTP400: stored response has zero-byte body and no access/captcha marker. Provider-internal cause remains unconfirmed. This fix preserves/restarts confirmed progress rather than claiming that rejection is solved.
- Operational rollout pending: install compatible owner-scoped SQL before frontend, then existing workflow/public fixture checks and deployment observations. Do not touch portal draft PR111 or auto-reprocess private attention jobs as tests.


## Follow-up: isolated route HTTP400 (PR112 operating replay)

- Evidence: the same saved job preserved six captures but a row-14 candidate HTTP400 stopped fifteen independent rotations. `queryLength:0` measured the search-only `query` parameter, not route `start/goal/waypoints`; the matcher already requires exact coordinates and names for the current navigation.
- Keep address-search outages, restriction indicators (including JSON access/captcha/limit markers), settings changes, storage failures and queue outages as global pauses. Only a route HTTP400 without restriction evidence becomes a per-course retry item.
- Persist incomplete optimizer evidence and advance the independent-course cursor. Do not upload a partial winner or claim a shortest route. Final SQL checks persisted retry markers so a worker handoff cannot hide unresolved courses. Existing owner-approved resume filters finished captures and retains successful candidate evaluations.
- Diagnostics record method, safe parameter names, point count and coordinate validity; no labels, raw URLs, coordinates or credentials are added. Search query length is null for route requests.
- Verification: red/green worker continuation and request diagnostics, JSON restriction regression, actual worker SQL in PGlite, resume filtering, existing Naver regression suites. A saved successful candidate's distance is not repeated; if its final screenshot was never persisted, the eventual winner still requires one screenshot/evidence verification. Already verified captures remain untouched.
- Provider HTTP400's internal cause remains unconfirmed. This change fixes isolation and recovery; it does not bypass restrictions or assert that the provider rejection is cured.

## Read-only HTTP400 follow-up after PR113 (local only)

- Operating snapshot: 22 courses tried, 15 verified captures, seven courses incomplete. Their candidate plans contain 52 logical candidates: 38 successful stored evaluations, seven HTTP400 failures, seven further candidates not tried after their course failure. Course-level unprocessed=0 does not mean every candidate succeeded.
- All seven failures recorded GET /p/api/directions/car with start/goal/waypoints, EPSG-valid coordinate shapes and empty response bodies; no recorded access/captcha/limit indicators. They use 5–7 folded points; successful candidates use 4–7. Address tokens pass the existing validator, all coordinates fall in the Korean operating range, and decoded labels contain no reserved path delimiters in this snapshot.
- Reconstructed map URLs are 712–1006 characters for failures versus 501–1145 for successes. Estimated core API query sizes are 444–633 versus 314–706. These are offline reconstructions, not retained wire request lengths. The old failure evidence lacks actual request bytes/settings values, so no request-size limit or failed vehicle-setting difference is established.
- Confirmed redundant work: row-35 candidates 1 and 3 have identical generated map URL, point tokens, labels, coordinate sequence and logical mapping; original address aliases differ. Candidate 1 succeeded, candidate 3 failed. Existing cache keys use original address strings and miss the equivalence. This establishes an unnecessary repeated query, not the provider's internal HTTP400 cause or a common cause for the other six courses.
- Local fix: key known routes by exact validated native URL plus unchanged logical mapping and request settings. Keep each original candidate's requested stops, resolved/confirmed addresses and logical evidence. Seed equivalent route proofs from checkpoints only when their stored labels/source URL/logical mapping/coordinates match current validated points. A stale mapping cannot propagate old leg distances into a new mapping; final winner evidence remains independently checked.
- Local diagnostics now record actual URL/query byte counts and an allowlisted-settings fingerprint for future comparisons, without raw URLs, point labels, coordinates or credentials. They cannot retroactively recover the seven old wire requests.
- Offline checks: all 52 planned request transformations/label round-trips, seven simulated rejection paths, zero external requests. Actual row-35 saved-proof replay fills the equivalent third evaluation with zero new distance lookups; its missing final winner image is simulated once and is not a real new Naver/Storage result. No operating capture is declared repaired by this replay.
- Deployment, operating DB changes, live job retries and private route requests are on hold. PR111 remains unrelated and un-deployed. Six distinct failed route shapes still lack a confirmed application cause; new real observations would require separately approved operating instrumentation/retry.
