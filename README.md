# Guide Sources

Standalone Funaging Guide Sources app, built as a Next.js app and kept integration-ready for Main Web through `src/integrations/mainWebAdapter.ts`.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env.local` and fill Supabase values.
3. Apply SQL in `supabase/migrations/202606150001_guide_sources_mvp.sql` to your Supabase project.
4. Run `npm run build`.

## Supabase contract
The migration creates `staging_places`, `production_places`, `place_media`, `profiles`, `user_roles`, `admin_audit_logs`, `import_jobs`, and `import_logs` with RLS. Members submit to staging. Admin/editor users approve into production. Public search reads approved production rows.

## Media uploads
Default is disabled with `VITE_MEDIA_UPLOAD_ENABLED=false` / `NEXT_PUBLIC_MEDIA_UPLOAD_ENABLED=false`. The `place-media` bucket and `place_media` table are ready. Enable the flag after confirming Supabase Storage policies and quotas.

## Main Web integration
Import from `src/integrations/mainWebAdapter.ts`:
- `listApprovedPlaces(filters)`
- `getPlaceById(id)`
- `searchPlaces(filters)`
- `getPlaceMedia(placeId)`

## Admin role setup
Insert a row into `user_roles` for the signed-in Supabase user UUID with role `admin`, `editor`, or `viewer`. Admin can manage roles; editor can approve/import/manage place data; viewer can monitor.

## Validation
- `npm run typecheck` when a typecheck script is available.
- `npm run build`
- `npm test` when tests are added.

## Phase E CI / deploy validation

### Codex `ENV_BLOCKED_NPM_REGISTRY`
This Codex environment cannot complete dependency installation because npm registry access returns `403 Forbidden` for packages such as `@vitejs/plugin-react` / `vite`. As a result, `npm run build` and `npm run dev` can fail here with `vite: not found` even though the repository is configured as a Vite app. This is classified as `ENV_BLOCKED_NPM_REGISTRY`, not an app feature blocker.

### Validate locally
Use a normal development environment with npm registry access:

```bash
npm install
npm run contract
npm test
npm run build
npm run dev
```

Open the Vite dev-server URL and follow `docs/RUNTIME_VALIDATION_CHECKLIST.md` for manual browser validation, including mobile/tablet/desktop viewport checks.

### Validate in GitHub Actions
The workflow at `.github/workflows/validate.yml` installs dependencies, runs the runtime contract check, runs node tests, and performs the real Vite production build. Push a branch or open a pull request to run the workflow.

### Deploy as a Vite app
For Vercel, Netlify, or similar static hosts:

- Framework preset: **Vite**
- Install command: `npm ci` or `npm install`
- Build command: `npm run build`
- Output directory: `dist`
- Required environment variables when Supabase runtime is enabled:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_MEDIA_UPLOAD_ENABLED=false` by default

Leave Supabase variables blank only when intentionally validating local fallback mode. Enable `VITE_MEDIA_UPLOAD_ENABLED=true` only after Supabase Storage and policies are configured.
