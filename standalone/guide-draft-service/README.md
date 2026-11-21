# Standalone guide-draft service (P2C-GUIDE)

A dependency-free Node ESM service that implements the **deployed** bridge contract
`guide-source-draft@1.0.0` (the one in `src/lib/bridge-store.ts` and
`src/app/api/bridge/*`) over **mock adapters only**.

Why: plan V2 asks for every system to be buildable and testable against its contract with no
live connection. This package is that build for guide-sources' one integration contract, so the
contract can be exercised in CI and by other systems' contract tests without touching Supabase,
Postgres or the production deployment.

## What it serves

| Method | Path | Live flag (default OFF) |
|---|---|---|
| POST | `/api/bridge/drafts` | `GUIDE_LIVE_DRAFT_CREATE` |
| GET | `/api/bridge/drafts[?qa=1]` | `GUIDE_LIVE_DRAFT_READ` |
| GET | `/api/bridge/drafts/:id` | `GUIDE_LIVE_DRAFT_READ` |
| POST | `/api/bridge/drafts/:id/purge` | `GUIDE_LIVE_DRAFT_PURGE` |
| GET | `/api/bridge/health` | — (public, read-only) |
| GET | `/health`, `/version` | — (standalone process health/contract) |

Auth mirrors the live app: header `x-guide-sources-service-token` against
`GUIDE_SOURCES_SERVICE_TOKEN`; unset token = 503 `BRIDGE_NOT_CONFIGURED`, wrong token = 401.
The token is never logged, written or echoed.

## Adapters

- Store: `mock-file` (`FileDraftStore`) — atomic JSON document, re-read on each operation, so
  durability across instances/restarts is part of the adapter contract. Set
  `GUIDE_MOCK_STORE_DIR` to choose the directory (default: `<tmp>/guide-sources-standalone/mock-store`).
- No Postgres/Supabase adapter exists here. Setting `GUIDE_LIVE_STORE_URL` makes the process
  refuse to start (exit 2) instead of silently reaching a live system.

## Commands

```powershell
npm --prefix standalone/guide-draft-service run build   # tsc -> dist/
npm --prefix standalone/guide-draft-service run test    # node --test tests/*.test.mjs
npm --prefix standalone/guide-draft-service run ci      # build + contract tests (what CI runs)
```

CI: `.github/workflows/guide-standalone-contract.yml`.

DoD: `tools/dod/planv2/P2C-GUIDE.mjs` (Track C) re-reads both contract files for drift, runs the
CI command, and drives the built server over real HTTP including the flag-on refusal and the
flag-off rollback.

## Connect day

See `docs/GUIDE_CONNECT_DAY.md`. Nothing here is deployed; production is unchanged.
