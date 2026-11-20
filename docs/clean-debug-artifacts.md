# Debug artifact cleanup (2026-11-20)

Branch `chore/clean-debug-artifacts` (off the deployed `codex-mvp`) removes **111 committed debug artifacts**:
69 `*.txt`/`*.log` build-or-RCE transcripts and 42 stale editor backups (`*.bak`, `*.debugbak`, `*.envfilebak`,
`*.p4fullchainbak`, `*.rolegatebak`, ...). The first inventory pass listed 91; the new artifact gate then found 20 more
backups under `src/` that the earlier suffix list missed, and they are removed in the same commit. The per-file list,
kind, size and secret-class verdict is in the Track C evidence files `guide_sources_dump_inventory.json` and
`guide_sources_extra_artifacts.json` (outside the repo).

## Why

- The repository is **public**; GitHub only (Vercel serves `public/` and returned 404 for the dump paths).
- 16 dumps carried personal data: 4 gmail addresses, 3 auth-user UUIDs; 8 carried local Windows paths and the local
  username.
- **No usable credential was ever committed**: 0 full JWTs, 0 `sb_secret_`/`sb_publishable_`, 0 service-role literal,
  0 PEM key, 0 provider token, 0 `postgres://user:pass@` across 4 refs with 14 patterns. No `.env*` file was ever
  committed (history-checked; only `.env.example`, all values empty).
- The dumps duplicated facts that already live in `RUNBOOK.md`, `.env.example`, `supabase/migrations/` and git history.

## Rules from now on

- `/scripts/check-debug-artifacts.mjs` (`npm run check:artifacts`) fails if any tracked file is a `*.txt`/`*.log` dump,
  a stale editor backup (`*bak`), or a committed `.env*` file other than `.env.example`.
- Debug transcripts belong outside the repo, not in a commit.

## Install / gate reality

- `npm ci` failed on the old tip (`@emnapi/wasi-threads` / `@emnapi/core` drift between `package.json` and
  `package-lock.json`); the lock file is repaired in a separate commit so a clean install works.
- `npm test` (`node --test`, 4 tests) and `npm run typecheck` already existed on the old tip. The CI workflow also called
  `npm run contract`, which did not exist. This branch adds `contract` and `check:artifacts`, replaces CI's
  `npm ci || npm install` with a real `npm ci`, and adds the artifact gate to CI.
- `npm run lint` is **still red**: 13 errors (9 `no-explicit-any`, 4 `react-hooks/set-state-in-effect`) all pre-existing
  on the deployed tip and unchanged here, because the cleanup only deletes files and never edits `src/`. Tracked as an
  open item; CI does not run lint until they are fixed.
- `next` was 16.2.9, inside the range of critical advisories (unauthenticated RCE in the Image Optimization API via
  SVG/AVIF, `use cache` RCE). Bumped to 16.4.6: `npm audit` drops from 1 critical + 8 high to 0 critical + 5 high.

## Rollback

`git revert <commit>` on this branch. Nothing was pushed or deployed by the cleanup itself. The deleted files remain in
older commits of the public repository: removing them at the tip does not un-publish them, so the history decision
(GitHub support purge vs. "treated as disclosed") stays with the Owner.
