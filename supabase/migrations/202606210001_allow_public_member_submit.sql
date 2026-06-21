-- Add RLS policy for public member submissions
drop policy if exists "public submit staging" on public.staging_places;
create policy "public submit staging" on public.staging_places
for insert to anon, authenticated
with check (
  status = 'pending' 
  and rejection_reason is null
  and (
    (auth.role() = 'anon' and submitted_by is null) 
    or 
    (auth.role() = 'authenticated' and (submitted_by is null or submitted_by = auth.uid()))
  )
);