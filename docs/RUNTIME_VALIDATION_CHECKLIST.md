# Guide Sources Runtime Validation Checklist

Use this checklist after dependencies install successfully in a normal local or CI environment.

## Setup
1. Copy `.env.example` to `.env.local`.
2. Leave Supabase values blank to validate local fallback mode, or fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to validate Supabase mode.
3. Keep `VITE_MEDIA_UPLOAD_ENABLED=false` unless the Supabase Storage bucket and policies are ready.
4. Run `npm install`, `npm run build`, and `npm run dev`.
5. Open the Vite URL printed by the dev server.

## Manual Browser Matrix

| Area | Viewport | Steps | Expected Result | Pass/Fail | Notes |
|---|---:|---|---|---|---|
| Member save | Desktop 1024px+ | Open Member tab, enter required name/province/category, submit. | Record saves; success message appears; app moves/refetches Search. |  |  |
| Duplicate warning | Desktop 1024px+ | Save a place, return to Member, enter same name, submit. | Duplicate warning/confirm appears before save. |  |  |
| Edit existing | Desktop 1024px+ | From Search or Admin, click edit on a saved record, change a field, submit. | Member opens with same record; update preserves record identity. |  |  |
| Province autocomplete | Mobile 375px | Focus province field and type a Thai province prefix. | Browser datalist suggestions appear and selected value is accepted. |  |  |
| Category autocomplete | Mobile 375px | Open category selector and choose each major category. | Category selection updates the form; “other” category reveals custom field. |  |  |
| Search keyword | Desktop 1024px+ | Search for a saved place name or suggestion text. | Matching records remain visible; non-matches disappear. |  |  |
| Search province | Tablet 768px | Filter by a saved record’s province. | Only matching province records show. |  |  |
| Search category | Tablet 768px | Filter by a saved record’s category. | Only matching category records show. |  |  |
| Search rating | Desktop 1024px+ | Select a minimum rating. | Only records at or above the selected rating show. |  |  |
| Search amenities | Desktop 1024px+ | Filter by a checked amenity. | Only records containing that amenity show. |  |  |
| Search alerts | Desktop 1024px+ | Filter by a checked alert. | Only records containing that alert show. |  |  |
| Search edit handoff | Desktop 1024px+ | Click Search card edit. | Member tab opens with selected record populated. |  |  |
| Admin approve | Desktop 1024px+ | In Supabase/admin-role mode, approve a staging record. | Record appears in production/searchable list; audit log updates. |  |  |
| Admin reject | Desktop 1024px+ | Reject a staging record with a reason. | Staging record status becomes rejected; audit log updates. |  |  |
| Admin delete | Desktop 1024px+ | Delete a staging or production record. | Record is removed from that list. |  |  |
| Admin import CSV | Desktop 1024px+ | Paste valid CSV into import box and import. | Rows are imported into staging/local fallback where supported. |  |  |
| Admin import JSON | Desktop 1024px+ | Paste valid JSON array into import box and import. | Rows are imported into staging/local fallback where supported. |  |  |
| Media disabled mode | Mobile 375px | Leave media flag false and click/select image/video upload. | Clear “media upload not enabled yet” message appears; no fake upload success. |  |  |
| Mobile layout | 375px | Visit all three tabs. | Inputs, filters, cards, and admin controls remain usable without horizontal clipping. |  |  |
| Tablet layout | 768px | Visit all three tabs. | Grid/flex layout adapts and remains usable. |  |  |
| Desktop layout | 1024px+ | Visit all three tabs. | Two-column/search/admin content remains readable and usable. |  |  |

## Evidence to Capture
- Screenshot: Member tab at 375px.
- Screenshot: Search tab with filters and at least one result at 1024px+.
- Screenshot: Admin tab at 1024px+.
- Terminal output: `npm run build`, `npm test`, `npm run contract`.
- If Supabase is configured, record IDs for staging/production rows used during validation.
