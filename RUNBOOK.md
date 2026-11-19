# RUNBOOK - Guide sources (Next.js)

Status: ECO-6, 2026-11-19. Owner-only actions live in `D:\FUNAGING_TEMP\eco_owner\OWNER_BATCH_ECO5.md`.

## At a glance

| | |
|---|---|
| System | Guide sources (tourism guide content + admin) |
| Production | https://guide-sources.vercel.app (Vercel project `guide-sources`) |
| Data | Supabase Guide-sources `hfoliiqijjkmarggjawp` |
| Repo | `D:\FUNAGING_WEB\01_ACTIVE\guide-sources__9CC897324B2F`, default branch `main`, working branch `feat/r5-gs-tourism-gs-repair` |
| Deploy model | Next.js on Vercel; the project is Git-linked (a feature-branch push on 2026-11-19 produced a preview deployment) |

## !! Auto-deploy warning
Never push `main` until the Owner disables Git auto-deploy (batch item 2): "push main = deploy".
A feature-branch push creates a **preview** deployment only - that is the allowed way to publish work for review.

## Deploy (Owner only)
```powershell
npm ci
npm run build
vercel deploy --prod --yes --scope team_UkIW1iwLo9j1Shy7ArPdFXMI
```
Rollback: `vercel rollback <previous dpl_ id> --scope team_UkIW1iwLo9j1Shy7ArPdFXMI`.

## Secrets (NAMES ONLY)
`FUNAGING_CORE_SUPABASE_URL`, `FUNAGING_CORE_SUPABASE_ANON_KEY`, `FUNAGING_CORE_SUPABASE_SERVICE_ROLE_KEY`,
`FUNAGING_TOURISM_SCHEMA`, `NEXT_PUBLIC_FUNAGING_CORE_SUPABASE_URL`, `NEXT_PUBLIC_FUNAGING_CORE_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_MEDIA_UPLOAD_ENABLED`.

## Health checks
`/` 200, `/api/admin/me` 401 without a session, `/api/funaging/member-submissions` 401 without a session.

## Tests
```powershell
npm test                 # node --test tests/*.test.mjs
npm run typecheck
npm run lint
```

## Branches and deploys (ECO-7, 2026-11-19)

| | |
|---|---|
| Deployed to production | `codex-mvp` (also the head of `feat/r5-gs-tourism-gs-repair`) at `d16eed8` |
| Local HEAD | the RUNBOOK commit is on `docs/eco-7-branches` (based on `feat/r5-gs-tourism-gs-repair` at `25c9141`); `main` is at `648fbe92` |
| Vercel Git integration | **connected** - a branch push builds a preview, a push to the deployed branch builds production |
| Rule | **do not push `main`** while the project is Git-connected (push feature/doc branches only) |

Why: on 2026-11-19 a push to `main` of `sanook-master-v2` deployed `funaging` to production six times in 17 minutes.
The same projects build any branch that is pushed, so a docs commit on `main` would either deploy or fail the
production build.

### Reconcile `main` with the deployed branch later (Owner, after disabling Git auto-deploy)
`powershell
git fetch origin
git checkout main
git merge --ff-only origin/main
git merge --no-ff <deployed-branch> -m "merge(<deployed-branch>): reconcile main with production"
# run the repo's own suite and require 0 failures, then:
git push origin main      # only with the Vercel Git integration disconnected
`
Rollback for any accidental deploy: `vercel rollback <previous dpl_ id> --scope team_UkIW1iwLo9j1Shy7ArPdFXMI`.

