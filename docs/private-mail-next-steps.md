# Verified state and remaining receipt setup

2026-10-17 user-provided production result (17:48:40 KST): DNS, TCP 995,
certificate/hostname-validated TLS and POP greeting succeeded in Vercel Node,
region iad1, TLSv1.2, TLS_RSA_WITH_AES_256_GCM_SHA384. This proves neither POP
account authentication nor country-policy acceptance at login. Groupware UI
showed Korea/Japan allowed and SMS/enable requirements; save/SMS completion is
unverified. No login or password was used by this task.

Read-only database checks found zero private_mailboxes and zero messages. The
existing OneDrive connection belongs to the confirmed owner, with configured
drive 6dace80ad4c07b59. Existing folder categories contain operational documents,
not private mail. No private mail destination is registered. This is not a
filesystem inspection and cannot prove a folder does not already exist in Drive.

## Direct user input and security decisions (not performed)

1. Resolve the login execution country before account authentication. Prefer a
   narrowly scoped collector function in a currently allowed country if the
   account supports it; changing Vercel execution region is an explicit security
   decision, not part of the banner-only result. Do not expand country allowlists
   automatically or assume a US greeting means US login is permitted. SMS and POP
   enablement must be completed by the owner in the actual groupware settings.
2. Proposed password storage: the owner enters MAIL_POP_PASSWORD directly into
   the existing sajoansan Vercel project's Environment Variables UI, Type Secret,
   Production only. No Preview/Development target, VITE_ prefix, client form,
   chat, command-line value, or agent inspection. This grants the production
   project runtime persistent POP access as jhs96@eangroup.kr at the fixed host;
   project secrets are available to project server code, not only one function.
   Do not create it until the persistent access/storage decision is confirmed.
   Whether U+ offers a separate POP/app password remains unverified; use one only
   if the provider explicitly supplies it. Never extract a webmail credential.
3. Select/create a dedicated private folder in the existing connected OneDrive.
   Record its drive/folder IDs in one owner-scoped disabled mailbox row, initial
   import 60 days. Verify folder/item permissions using the existing Edge Graph
   integration before enabling. No shared operations folder or shared search/AI
   index. Existing OneDrive OAuth remains in Edge; do not copy it to Node or ask
   for a new Graph scope without a demonstrated requirement. There is currently
   no private-mail setup form: the operations connections form is not this setup.
4. Existing private-mail-sync requires MAIL_COLLECTOR_KEY (32+ characters) and
   MAIL_COLLECTOR_MAILBOX_ID in Edge. A new random collector key has NOT been
   generated. Proposed persistent key is limited by server code to this single
   mailbox and begin/seen/ingest/end; it is not a Supabase service key or Graph
   token. A future Supabase scheduled request and Vercel worker need this scoped
   server-only capability. Establish the final key delivery/rotation path before
   storing it; no copying any token into chat or Git. Keep cron disabled.

## Verified navigation and limits

The production mail screen is https://sajoansan.vercel.app/portal/?view=mail .
The diagnostic button already exists. No password-entry or collector setup route
has been deployed. Provider dashboard paths below are intended navigation targets,
not authenticated pages inspected by this task:

- Vercel: https://vercel.com/elfincapes-projects/sajoansan/settings/environment-variables
- Edge secrets: https://supabase.com/dashboard/project/vvrppotrnpwrwpwqaiet/functions/secrets

Vercel's official Secret-variable instructions:
https://vercel.com/docs/environment-variables/sensitive-environment-variables

## Local Node port status

Based on user main d221851, a separate feat/mail-node-collector worktree adds an
inert read-only POP protocol and bounded UIDL batch core. It has no API route,
environment reader, network connection initializer, credential storage or cron.
The command whitelist excludes DELE and rejects CRLF/NUL injection. Byte limits,
dot unstuffing, UIDL validation, duplicate skipping, cursor/batch limits and
partial-ingest failure handling are exercised against fake transport/bridge.
A total batch deadline bounds every awaited POP/bridge/parser operation, closes
the POP transport and aborts the shared signal. Future bridge/parser adapters
must honor that signal; a timed-out upload must still obey the existing server
lease/publish checks. CPU-bound MIME parsing also needs input limits.

Remaining implementation before a production collector can run:

- Integrate a reviewed Node MIME parser/packager equivalent to the Python worker,
  preserving raw EML, charset handling, nested messages, attachment count/byte
  limits, deterministic names and existing Edge HTML/attachment defenses.
- Add TLS transport/write adapter based on the user's verified Node implementation
  with existing certificate/hostname verification and bounded socket lifecycle.
- Add mailbox-scoped bridge client and durable collection lease lifecycle using
  existing private_mail_begin/publish functions, bounded retry, deadline-aware
  cursor and end reporting. No new database tables are necessary.
- Add a disabled server route, owner setup/status flow and fake MIME/Graph/partial
  failure integration tests. Current 30-second diagnostics cannot be assumed to
  support the Python worker's 240-second batch or existing 10MB/base64 payloads;
  account for Vercel request/function limits and use smaller bounded transfers.
- After region, private folder and secret decisions, do one explicit login-only
  validation without fetching mail, then a small approved one-shot import. Check
  original retention, dedup, owner isolation and file privacy. Only then separately
  enable the proposed ten-minute recurring execution. No current cron is active.

Do not report the Node collector complete: only the protocol/batch core is ported.
The existing Python worker and its MIME package remain the functional reference.
