# GUIDE CONNECT DAY - `guide-source-draft@1.0.0`

Status today: **standalone, mock adapters, no live connection.**
`standalone/guide-draft-service` implements the deployed contract and passes its contract tests in
CI (`.github/workflows/guide-standalone-contract.yml`). Production (`codex-mvp` on Vercel) is
unchanged by this package; it keeps serving its own Postgres-backed routes.

## The rule

Connect day is taken **one route at a time**. Each route has its own flag, default OFF:

| Route | Flag | Today | At connect day |
|---|---|---|---|
| `drafts.create` | `GUIDE_LIVE_DRAFT_CREATE` | mock file adapter | live adapter wired, then flag ON |
| `drafts.read` | `GUIDE_LIVE_DRAFT_READ` | mock file adapter | live adapter wired, then flag ON |
| `drafts.purge` | `GUIDE_LIVE_DRAFT_PURGE` | mock file adapter | live adapter wired, then flag ON |

While a flag is OFF the route serves the mock adapter. While a flag is ON and the live adapter is
not built, the route answers an honest `501 LIVE_ADAPTER_NOT_BUILT` for **that route only** - it
never falls back to a fabricated answer and never reaches a live system by accident.

## What connect day needs, per route

1. A live adapter behind the same store interface (`src/store.ts`): the Postgres/Supabase
   implementation of `put/get/list/deleteQa`, keeping the QA-only delete predicate
   (`DELETE ... AND qa = true`).
2. The service token for that deployment, read from the DPAPI vault
   (`Get-FunagingSecret`, name only here: `GUIDE_SOURCES_SERVICE_TOKEN`); never written to a file,
   never printed.
3. An E2E run against the real target with the flag OFF (proves the refusal) and ON (proves
   create -> read-back -> purge with a `QA-*` draft only, plus idempotent re-send).
4. The same `guide-source-draft@1.0.0` contract fields; `tools/dod/planv2/P2C-GUIDE.mjs` re-reads
   `src/lib/bridge-store.ts` and `standalone/guide-draft-service/src/contract.ts` and fails on
   drift, so the adapter cannot ship with an older contract.

## Rollback (flag-off rollback)

Set the route's flag back to `0` (or remove it) and restart/redeploy. The mock adapter takes over
again, the 501 disappears, and no data migration is required: the mock store and the live store are
separate stores, and the contract is the same. This is the rollback path the DoD check executes
(`GUIDE_LIVE_DRAFT_CREATE=1` -> 501, then `0` -> 201).

## Not part of connect day

- Publishing the standalone package (it is not deployed; production serves the Next.js app).
- Any change to the live admin/search UI.
- Secrets: nothing in this package reads or stores a credential.
