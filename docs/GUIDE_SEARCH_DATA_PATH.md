# Guide Sources search data path (fixed 2026-11-22)

## Symptom (found by Track F's pattern audit, 2026-11-22)

On production, typing in the public Search box changed nothing: the page loaded 0 cards, the count read
"ผลการค้นหา 0 รายการ", no empty state was shown and every read of
`/rest/v1/production_places?select=*&status=eq.approved` answered **404**.

## Root cause

The browser client asked PostgREST for `public.production_places`. The DEC-014 two-project rule keeps the
guide tables in the **Club** project but in the **`tourism_gs`** schema; there is no
`public.production_places` (`information_schema.tables` in `public` = 0 rows for that name). PostgREST
therefore answered `404 PGRST205 ... Could not find the table 'public.production_places'`, the service
fell back to browser localStorage (empty on a fresh browser), and the filter had nothing to filter.

`tourism_gs` **is** exposed by PostgREST: the same query with `Accept-Profile: tourism_gs` answers 200
with the 4 approved rows (`production_places`, policies `gs_prod_anon_select_approved` for `anon` and
`gs_prod_auth_select` for `authenticated`).

## Fix

* `src/lib/supabase.ts` - new `TOURISM_SCHEMA` (from `NEXT_PUBLIC_FUNAGING_TOURISM_SCHEMA`, default
  `tourism_gs`, shape-validated) and `tourismFrom(table)` = `supabase.schema(TOURISM_SCHEMA).from(table)`.
* `src/services/placesService.ts` - approved-place reads (`listApprovedPlaces`, `getPlaceById` for
  `production_places`) go through `tourismFrom`; no `supabase.from('production_places')` remains.
* `src/components/SearchTab.tsx` - when nothing matches, the panel says so explicitly
  ("ไม่พบสถานที่ที่ตรงกับเงื่อนไข ...") instead of rendering an empty page with no answer.

Staging/media/admin tables keep their old path and their localStorage fallback: they are not part of the
public answer, and `tourism_gs.staging_places` / `place_media` currently expose no grant to `anon` or
`authenticated` (a separate decision, not this fix).

## Proof

`node tools/dod/requests/GUIDE-SEARCH-TOURISM-SCHEMA.mjs` (Track C copy:
`D:\FUNAGING_TEMP\tracks\C\dod\requests\GUIDE-SEARCH-TOURISM-SCHEMA.mjs`) - a real Chromium run against
the locally built app and against https://guide-sources.vercel.app:

* the approved-place request carries `Accept-Profile: tourism_gs` and answers 200;
* 4 real cards, and the count heading equals the rendered cards;
* typing a real place name narrows the list to the matching card;
* a no-match query renders 0 cards **and** the explicit empty state;
* 0 page errors; no credential recorded.

Fail-on-old-code control: the pre-fix code (same browser probe) answered `404` with
`acceptProfile: public`, 0 cards, and typing "ABBEY" left the page unchanged
(`tracks\C\evidence\guide_search_negative_control.txt`).

## Deploy / rollback

| | |
|---|---|
| Production fix | `dpl_ACohzLNJwcwrAZPRRGfF7sbMaNSk` (CLI, from this commit on `codex-mvp`) |
| Rollback target (recorded first) | `dpl_8Tzao5scWLz92HDf5UWUHjPk7Jms` (commit `b94546c`, serves the dead search) |
| Deploy-Lock records | `tracks\deploy_records\2569-11-21T210538Z_C_GUIDE-SEARCH-TOURISM-SCHEMA…` and the provenance rebuild record |

Rollback: `vercel rollback dpl_8Tzao5scWLz92HDf5UWUHjPk7Jms --yes` (or a later recorded target).
