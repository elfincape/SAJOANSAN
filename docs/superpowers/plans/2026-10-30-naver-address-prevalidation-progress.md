# Ledger — 2026-10-30-naver-address-prevalidation.md

Base: 3326b5c. Existing task-specific branch fix/naver-delivery-order and checkout retained as explicitly requested. Photo investigation is read-only and independent; no Naver file conflicts.

Ruling: execute the detailed requested flow directly without another design approval question — user explicitly authorized implementation, verification and existing-scope deployment; developer requires using existing authorization rather than redundant approval gates.

Pre-flight: model → validation UI/RPC must share exact trimmed address keys and current-course identity. RPC → worker passes only a stored validation-job reference; trusted tokens are read server-side and checked again. Input edit → capture preservation compares routing values, not metadata-only fields. Output uses original/current address mapping, not changed-input text falsely labelled original.

UI context loader unavailable (uninstalled engine requiring external cache/network); PRODUCT.md/DESIGN.md read directly. No new engine/dependency installed.

Task 1: RED missing model → GREEN check-address-preflight.mjs. Original blank delivery source roles, shared explicit edits, immutable input, per-course gating and stale queries checked.

Task 2: RED missing browser validator → GREEN existing browser tests. Candidate classes and cached trusted point validation reuse the existing resolver.

Task 3–5: implemented initial contract/worker/UI; worker RED no validation dispatch → GREEN per-address continuation/provider-pause tests. TypeScript/Vite build green. SQL live rollback verification, output original/current mapping and final review remain.

Ruling: exact matching historical results may be reused from older same-owner/same-center jobs when the immediate previous file differs — otherwise an unrelated upload would cause unnecessary repeated validation/capture. A current explicit previous result takes precedence, including its failure state. Changed course routing never reuses a prior image.

Ruling: deploy compatible backend/RPC support first, then frontend-only changes after worker readiness — avoids old workers claiming validation jobs during a Git-triggered mixed-version rollout. Existing deployment authorization covers both phases; no extra approval request.

Tasks 3–6 local verification: actual DB migration+contract checks executed in one BEGIN/ROLLBACK, no persistent schema or user-result changes. Dedup/order, trimmed targeted retry, blocked unverified route, valid queue, changed-route stale-image rejection, historical matching image reuse, owner/center rejection and RLS read checks passed. Existing four naver-browser suites pass, domain preflight and edited-address optimized Excel provenance checks pass; final TS/Vite build passes. Fresh whole-branch reviewer in progress. Photo correction remains separate/uncommitted, excluded from Naver deployment.

Fresh review P1: resolver compared full URL index3 (p) to pathname token; same-label stale token could pass. Fixed by parsing URL.pathname index3 and added in-memory delayed-token regression; browser suite green. Review continues.
