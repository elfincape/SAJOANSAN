# Private POP mailbox implementation

Approved scope: code and mock verification only. No POP login, remote server access,
production SQL, OAuth consent, schedule activation or deployment.

Architecture: a bounded Python standard-library POP3S worker on Ubuntu calls a
dedicated server action in the existing onedrive-auth function. Existing encrypted
OneDrive connection and refresh lock are reused. Raw EML, decoded body and attachments
live in a dedicated private folder. Two necessary metadata tables hold mailbox
configuration/status and UIDL/message/file references; no content enters shared
search, embeddings, notifications or assistant context.

- [x] Add owner-only RLS SQL and service-only lease functions; test ownership and expiry.
- [x] Implement read-only POP collector, size/batch/runtime limits, MIME normalization,
  bounded retries, explicit activation gate and deterministic idempotency.
- [x] Extend existing OneDrive function: collector secret gate, UUID ownership checks,
  immutable verified files, atomic publish after all files exist; safe HTML downloads.
- [x] Add personal mail within the existing portal, server search, paginated list,
  body and explicit attachment download; loading/error/empty states.
- [x] Verify fake POP/Graph, partial failure, duplicates, hostile HTML and files,
  RLS fixture and Vite build; document exact deployment prerequisites.

Defaults prepared only: 30 days initial range, 10 minute timer. Account
jhs96@eangroup.kr, POP mail.onnet21.com:995 with system CA verification; never DELE.
Recent range uses sender Date (POP has no authoritative delivery timestamp); undated
mail is skipped and counted. Late delivery with an old Date is a documented limitation.
No passwords or tokens in frontend, repository or diagnostic messages.
