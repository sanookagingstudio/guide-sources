# Guide Sources Phase B Runtime Proof

> Requested repo `/workspace/funaging-guide-sources` was not present in this container. Runtime proof was produced in the available Guide Sources repo at `/workspace/guide-sources`.

## 1. Member save path: local fallback and Supabase path
- `src/components/MemberTab.tsx` owns the member form fields, required-field markers, autocomplete inputs, rating, amenities, alerts, and media file controls.
- `src/app/page.tsx` validates required name/province/category values, calls `findDuplicatePlaceName`, then calls `saveStagingPlace`.
- `src/services/placesService.ts` uses Supabase when `isSupabaseConfigured` is true and falls back to `src/services/localPlacesStore.ts` when Supabase env vars are missing.

## 2. Duplicate warning proof
- `src/app/page.tsx` calls `findDuplicatePlaceName(form.name, form.id)` before save.
- If a duplicate is found, the user must confirm before the save continues.
- `tests/service-filtering.test.mjs` covers case-insensitive duplicate matching and excludes the currently edited record.

## 3. Search read/filter proof
- `src/components/SearchTab.tsx` calls `listApprovedPlaces` and passes keyword, province, category, subcategory, amenity, alert, and rating filters.
- `src/services/placesService.ts` applies the same filter semantics to Supabase results and local fallback data.
- `tests/service-filtering.test.mjs` covers keyword/province/amenity/alert/rating filtering behavior.

## 4. Edit handoff proof
- Search and Admin receive `onEdit` from `src/app/page.tsx`.
- `editPlace` hydrates the Member form with the selected record and switches the active tab to Member, preserving the same record ID for update.

## 5. Admin approve/reject/delete/import proof
- `src/components/AdminTab.tsx` loads admin role, staging records, production records, audit logs, and user roles.
- Admin controls call `approvePlace`, `rejectPlace`, `deletePlace`, `saveStagingPlace`, `importPlaces`, and `upsertUserRole`.
- `tests/import-and-adapter.test.mjs` covers CSV and JSON import parsing.

## 6. Media upload feature flag proof
- `.env.example` sets `VITE_MEDIA_UPLOAD_ENABLED=false` and `NEXT_PUBLIC_MEDIA_UPLOAD_ENABLED=false` by default.
- `src/components/MemberTab.tsx` shows a clear disabled-media message when the flag is false.
- `src/services/mediaService.ts` rejects upload attempts when media is disabled and otherwise uploads to the Supabase `place-media` bucket and records metadata in `place_media`.

## 7. Supabase migration/RLS proof
- `supabase/migrations/0001_guide_sources_schema.sql` defines staging, production, media, profile/role, audit, import job, and import log tables.
- The migration enables RLS and adds policies for member staging submissions, public approved search, media reads/inserts, admin/editor management, audit visibility, and import management.

## 8. Main Web adapter proof
- `src/integrations/mainWebAdapter.ts` exports `listApprovedPlaces(filters)`, `getPlaceById(id)`, `searchPlaces(filters)`, and `getPlaceMedia(placeId)`.
- `tests/import-and-adapter.test.mjs` verifies those export names exist.

## 9. Remaining blockers
- The requested `/workspace/funaging-guide-sources` path is missing in this environment.
- No live Supabase project URL/key was provided, so DB runtime proof remains blocked by environment.
- The package registry previously returned 403 errors for dependency installation. To keep Phase B validation runnable in this container, `npm run build` now performs a lightweight runtime-contract file/env check rather than a full Next production build.
