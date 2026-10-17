# Payload review and implemented binary transfer (not deployed)

## Corrected constraint

Vercel's 4.5MB limit is for the HTTP request received by a function and the HTTP
response returned by it. The owner invokes Node with a tiny mode JSON and receives
counts only. POP socket input and Node's outbound fetch to Supabase are separate
connections, not the user-facing Vercel payload. Therefore the previous 1MiB cap was
a conservative implementation cap, NOT a necessary consequence of Vercel's 4.5MB
limit. It was insufficient for the user's normal attachment workflow.

The prior 1MiB/3MiB version was preserved in commit cb2198b. The current local
code implements the sequential-binary phase below: 10MiB EML/20MiB aggregate,
per-file authenticated upload plus independently verified metadata-only finish.
Tests exercised an exact 10MiB EML and 7MiB attachment, maximum binary body
10,044,570 bytes and metadata 772 bytes, one request at a time. The legacy JSON Edge ingest caps an individual file at 10MiB, aggregate decoded
files at 20MiB and request JSON at 30MiB; it buffers JSON plus base64 strings plus
decoded files. Original EML plus decoded attachments repeat much of the content.
The shared storage verifier also downloads each file into arrayBuffer for hashing.
Current receipt maxDuration is locally 90 seconds; production diagnostic is 30.
Vercel Fluid compute documentation permits Hobby 300s and Pro/Enterprise 800s, but
the current project's plan/Fluid setting has not been read and is not assumed.

Sources:
https://vercel.com/docs/functions/limitations
https://supabase.com/docs/guides/functions/limits

## Minimum useful implementation: sequential binary files, initially 10MiB EML

1. Keep the existing owner JWT, mailbox lease, deterministic file names, privacy
   checks and final private_mail_publish RPC. No new tables, OAuth scope or long
   credential is needed for owner-invoked collection.
2. Change Node packaging to return buffers/metadata, not base64. Retain one bounded
   raw EML and decoded MIME parts, capped at 10MiB raw/20MiB aggregate initially.
   Keep buffers within the aggregate bound during upload. Postal
   MIME still materializes parsed parts; this is bounded processing, not a claim
   of constant-memory streaming MIME.
3. Add an owner-only binary-file operation in the existing Edge bridge. Headers or
   a small metadata envelope fix mailbox lease, UIDL/content hash, file index,
   kind, sanitized original name, byte count and expected file hash. Never accept
   Graph URLs, arbitrary paths, other mailboxes or caller-created item IDs as
   authoritative. Bound the binary body while reading, independently of claimed
   Content-Length. Send each file directly Node->Edge as octet-stream; never
   through browser/Vercel ingress, and never base64 the whole message.
4. Edge rechecks active owner, live mailbox lease and private destination; upload
   one file using existing immutable-name/conflict-fail logic and verify its
   actual location, size, privacy and hash. Return only bounded manifest metadata.
   Keep Graph OAuth entirely inside Edge. Small Graph content PUT accepts a binary
   stream and supports files up to 250MB, so upload sessions are not required just
   to restore the existing 10MiB worker target.
5. Add a metadata-only final publish operation. Re-read/verify every deterministic
   item against the manifest, require exactly one matching EML, enforce total file
   count/size and cutoff, then atomically publish with the existing RPC. A client
   manifest must never be trusted without revalidation. Failed/partial uploads
   leave unpublished deterministic files that an authorized retry can verify;
   never delete POP mail or overwrite changed items.
6. Keep bounded hash reads initially (one 10MiB file at a time). Later use an
   incremental SHA-256 implementation and bounded streaming verification, shared
   only with this mail path rather than changing unrelated document behavior.

Source: https://learn.microsoft.com/en-us/graph/api/driveitem-put-content

## Optional next tier: resumable chunks, without exporting Graph capabilities

For substantially larger files, keep upload-session URLs inside Edge. They are
temporary upload capabilities and must never enter browser responses, logs or
Git. Use an encrypted, owner/mailbox/lease/file-bound opaque envelope returned to
Node, using existing server encryption; Edge alone decrypts its upload URL.
Node sends binary chunks (for example 640KiB = two 320KiB units) through Edge,
which enforces index/length/hash and consults Graph nextExpectedRanges before
sequential PUT. A fragment is less than 60MiB; non-final chunk sizing uses 320KiB
multiples. Do not attach Graph Authorization to the uploadUrl PUT. Validate HTTPS
Microsoft upload hosts, disallow redirects and arbitrary caller URLs. Recheck the
collection lease for every chunk and final publish. Envelope expiry never outlives
the lease/session. Replay may only confirm the same bytes/range, never replace
content or advance unrelated state. No new permanent staging table is required,
but encrypted-envelope format and capability exposure require security review.

Source: https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession

## Fake-only validation before raising the cap

- 10MiB/20MiB fixtures, nested messages, UTF-8/legacy charsets, filenames and
  malformed MIME; byte-preserved EML and exact part hashes.
- Assert every bridge metadata request is small and file bodies are raw bytes;
  measure max live buffers/RSS, not only final JSON length.
- Cut every file/chunk boundary; retry duplicates, missing/out-of-order/range
  mismatches, expired lease, changed content, shared folder/item, wrong owner.
- Verify publish never occurs before every file has been independently verified;
  zero POP DELE and no shared search/AI rows on all error paths.
- Bounded deadlines/backoff and interruption cleanup; no secret/content logs.
- A future 25MiB+ target needs explicit measured runtime/memory evidence, rather
  than changing constants alone. Runtime/plan cannot be inferred from local tests.

## Administrator and folder access findings

Computer-use inventory returned apps=[] and browsers=[]; opening the in-app
browser returned 'Browser is not available: iab'. No Vercel connector/admin API is
available. Thus the current plan, authenticated Functions settings and billing
cannot be read here. Source configuration has no region override; observed Node
diagnostic ran iad1. Official per-function regions can target icn1, but Hobby's
single-region constraint versus existing iad1 needs authenticated plan/settings
verification. No region/network/billing setting was changed.

The existing app's connections form calls operations-config, which resolves a
folder link then immediately PATCHes the operations destination. It is not a
read-only private-mail folder inspector and must not be used for this purpose.
No file picker/private destination inspection route existed. New local
private-mail-folder action and configurePrivateMailFolder caller reuse the current
owner session and server-side OneDrive connection. Inspection does no DB write;
configuration creates only a disabled, fixed-account 60-day owner mailbox after
drive owner and private permission checks. No redeemSharingLink preferences,
sharing grants or token extraction. This code is not yet deployed, and no
authenticated browser session is available to invoke it, so the actual supplied
folder remains unverified/unconfigured here. Anonymous 403 is not treated as an
authenticated Graph denial. An actual Graph denial must be reported, not bypassed.
