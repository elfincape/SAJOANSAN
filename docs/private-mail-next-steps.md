# Private mail: prepared Node receipt and activation prerequisites

Based on user main d221851. Production user result at 2026-10-17 17:48:40 KST:
DNS/TCP/TLS/POP greeting succeeded in vercel-node, iad1, TLSv1.2,
TLS_RSA_WITH_AES_256_GCM_SHA384. No POP account login has been attempted.

## Local implementation

Owner-only POST /api/private-mail-collect (both repository-root deployment layouts)
uses the current user's session, never a stored user token or new collector key.
A new disabled private-mail-owner-sync action in the existing onedrive-auth Edge
handler performs getUser/active profile/exact owner UUID validation and fixes the
mailbox from server configuration. Existing private_mail_begin/publish RPCs supply
the atomic mailbox lease and UIDL uniqueness. This reuses the collection lease;
the diagnostic lease has a separate purpose and is unchanged. Concurrent/replayed
begin is rejected by the existing live mailbox lease. Node has no service/Graph key.

Node checks all activation/password/region gates before any network request.
The fixed POP host/account and validated Node TLS defaults are preserved. DELE is
not in the command whitelist. CRLF/NUL injection, fragmented lines, dot stuffing,
malformed UIDL, oversized responses and operation deadlines are bounded. Failed
storage does not advance the persisted cursor; deterministic files and UIDL checks
make retries safe. Malformed MIME/date messages are skipped and counted in undated
so one hostile message cannot starve later mail; originals remain on POP.

postal-mime 4.0.7 (zero dependencies, pinned registry integrity) converts headers,
charsets, nested RFC822 attachments, HTML/text and binary attachments. Original
EML is byte-preserved after POP CRLF/dot normalization. MIME depth/header/part and
attachment count/byte limits apply. Existing Edge sanitization, download owner/RLS
checks, per-file privacy/hash checks and publish-after-all-files semantics remain.
No shared search or AI indexing path was added.

Initial range is the mailbox's existing fixed 60-day cutoff; callers cannot change
it in the request. Each click saves at most two messages, scans for up to 12 seconds
and resumes via UIDL-hash cursor. Node transport commands have three-second limits.
Bridge calls have an eight-second limit and use the batch AbortSignal. No automatic
retry or schedule was added; a user may retry after an error. All secrets/errors/
message content are excluded from result/logging. A mailbox lease remains the
server-side authority if a timed-out upload is still completing.

For Vercel payload limits, this initial route accepts raw EML up to 1MiB and total
JSON packages up to 3MiB. Larger mail is skipped/counts as oversized and retained
on POP. Full large-attachment archival requires a later streamed upload path;
the Python worker's 10MiB limits cannot be claimed for this route. HTML remains
stored untrusted and is rendered only through the existing safe viewer.

The owner UI adds a manual receipt button; no password field or browser secret
storage exists. Local code has not been deployed or pushed to main. The active
production diagnostic is preserved. No credentials or activation flags were set.

## Exact final settings, not set by this task

Vercel project elfincapes-projects/sajoansan, Production only:
- MAIL_POP_PASSWORD: the only new secret for manual receipt. Owner enters it
  directly as Type Secret, never in chat, Git, a VITE_ variable or agent shell.
  It grants persistent POP access as jhs96@eangroup.kr to this project runtime;
  project environment secrets are accessible to project server code, not one
  isolated function. A provider-specific app/POP password is preferred only if
  the provider actually supports it (not yet verified).
- MAIL_COLLECTION_ENABLED=yes: nonsecret explicit activation gate. Keep unset/no
  until folder/privacy/region and a limited import are authorized.
- VERCEL_REGION is a provider variable, never manually spoof it. The route requires
  icn1 and rejects iad1 before using a password or making any network request.

Existing onedrive-auth Edge function:
- MAIL_OWNER_SYNC_ENABLED=yes: nonsecret server access activation, default off.
- MAIL_OWNER_MAILBOX_ID: nonsecret fixed UUID of one owner-owned mailbox.
No MAIL_COLLECTOR_KEY is needed for this manual JWT-based route; the legacy Python
collector key path is unchanged. No OAuth or service key moves to Vercel. Unattended
cron cannot use a stored/refreshing human JWT: its scoped service identity remains
a separate future design/security decision. Cron remains disabled.

## Region and folder prerequisites

Vercel supports functions['api/private-mail-collect.mjs'].regions=['icn1'] without
changing other functions' region settings. This setting was NOT applied. The repo
currently sets diagnostic maxDuration only; its observed runtime is iad1. The
project's authenticated dashboard/plan is unavailable here. Hobby allows a single
Function region and Pro up to five, so coexistence of iad1/icn1 depends on the plan.
Do not change the whole project region or expand U+ countries automatically.
Changing only the collector to Seoul changes where POP authentication and password
use occur; it does not prove U+'s IP-country classification, SMS or POP enablement.
Official source: https://vercel.com/docs/functions/configuring-functions/region

Read-only DB checks: zero mailboxes and messages. Existing OneDrive connection is
the confirmed owner; configured drive is 6dace80ad4c07b59. No private-mail folder is
registered. The user's candidate link redirects to official onedrive.live.com but
anonymous reading returns 403. Folder ID/name/owner/permissions are unverified.
No Graph connector or existing read-only arbitrary-folder inspection endpoint is
available. Do not extract existing encrypted OAuth tokens, repurpose the operations
folder setup form, redeem sharing grants, or upload until authenticated folder and
item permission verification is available. Register only a dedicated private folder
on that drive and one disabled owner mailbox with initial_days=60; new schema is not
needed. Do not change sharing/permissions without separate authorization.

## Direct user navigation

Verified production app: https://sajoansan.vercel.app/portal/?view=mail
Provider dashboard navigation (authenticated screens not inspected):
- https://vercel.com/elfincapes-projects/sajoansan/settings/environment-variables
- https://supabase.com/dashboard/project/vvrppotrnpwrwpwqaiet/functions/secrets
Official Secret instructions:
https://vercel.com/docs/environment-variables/sensitive-environment-variables

After permitted code deployment, region and private destination setup, owner direct
password entry and explicit receipt enablement, first perform a login-only check,
then a small one-shot import. This task did neither. Validate originals, duplicates,
privacy and owner isolation before considering unattended scheduling.
