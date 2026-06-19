create extension if not exists "pgcrypto";

do $$ begin create type place_status as enum ('pending','approved','rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type app_role as enum ('admin','editor','viewer'); exception when duplicate_object then null; end $$;

create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, display_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.user_roles (user_id uuid not null references auth.users(id) on delete cascade, role app_role not null default 'viewer', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (user_id, role));

create table if not exists public.staging_places (
  id uuid primary key default gen_random_uuid(), submitted_by uuid references auth.users(id) on delete set null, name text not null, province text not null, category text not null, other_category text, sub_category text, google_maps_url text, phone text, recommender text, suggestion text, rating int not null default 5 check (rating between 1 and 5), amenities text[] not null default '{}', alerts text[] not null default '{}', status place_status not null default 'pending', rejection_reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.production_places (like public.staging_places including defaults including constraints including indexes);
alter table public.production_places add column if not exists source_staging_id uuid unique references public.staging_places(id) on delete set null;

create table if not exists public.place_media (id uuid primary key default gen_random_uuid(), place_id uuid references public.production_places(id) on delete cascade, staging_place_id uuid references public.staging_places(id) on delete cascade, media_type text not null check (media_type in ('image','video')), storage_bucket text not null default 'place-media', storage_path text not null, public_url text, caption text, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), check (place_id is not null or staging_place_id is not null));
create table if not exists public.admin_audit_logs (id uuid primary key default gen_random_uuid(), admin_user_id uuid references auth.users(id) on delete set null, action text not null, entity_type text not null, entity_id uuid, details jsonb not null default '{}', created_at timestamptz not null default now());
create table if not exists public.import_jobs (id uuid primary key default gen_random_uuid(), created_by uuid references auth.users(id) on delete set null, source_type text not null check (source_type in ('csv','json')), status text not null default 'queued', total_rows int not null default 0, imported_rows int not null default 0, error_rows int not null default 0, created_at timestamptz not null default now(), completed_at timestamptz);
create table if not exists public.import_logs (id uuid primary key default gen_random_uuid(), import_job_id uuid references public.import_jobs(id) on delete cascade, row_number int, status text not null, message text, raw_payload jsonb, created_at timestamptz not null default now());

create or replace function public.has_admin_role(required app_role default 'viewer') returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.user_roles where user_id = auth.uid() and (role = 'admin' or role = required)); $$;

alter table public.profiles enable row level security; alter table public.user_roles enable row level security; alter table public.staging_places enable row level security; alter table public.production_places enable row level security; alter table public.place_media enable row level security; alter table public.admin_audit_logs enable row level security; alter table public.import_jobs enable row level security; alter table public.import_logs enable row level security;

drop policy if exists "member submit staging" on public.staging_places; create policy "member submit staging" on public.staging_places for insert to authenticated with check (submitted_by is null or submitted_by = auth.uid());
drop policy if exists "member read own staging" on public.staging_places; create policy "member read own staging" on public.staging_places for select to authenticated using (submitted_by = auth.uid() or public.has_admin_role('viewer'));
drop policy if exists "member update own pending staging" on public.staging_places; create policy "member update own pending staging" on public.staging_places for update to authenticated using ((submitted_by = auth.uid() and status = 'pending') or public.has_admin_role('editor'));
drop policy if exists "public read approved" on public.production_places; create policy "public read approved" on public.production_places for select to anon, authenticated using (status = 'approved');
drop policy if exists "admin full staging" on public.staging_places; create policy "admin full staging" on public.staging_places for all to authenticated using (public.has_admin_role('editor')) with check (public.has_admin_role('editor'));
drop policy if exists "admin full production" on public.production_places; create policy "admin full production" on public.production_places for all to authenticated using (public.has_admin_role('editor')) with check (public.has_admin_role('editor'));
drop policy if exists "public read media" on public.place_media; create policy "public read media" on public.place_media for select to anon, authenticated using (true);
drop policy if exists "member insert media" on public.place_media; create policy "member insert media" on public.place_media for insert to authenticated with check (true);
drop policy if exists "admin manage all" on public.user_roles; create policy "admin manage all" on public.user_roles for all to authenticated using (public.has_admin_role('admin')) with check (public.has_admin_role('admin'));
drop policy if exists "admin audit read" on public.admin_audit_logs; create policy "admin audit read" on public.admin_audit_logs for all to authenticated using (public.has_admin_role('viewer')) with check (public.has_admin_role('editor'));
drop policy if exists "admin import jobs" on public.import_jobs; create policy "admin import jobs" on public.import_jobs for all to authenticated using (public.has_admin_role('editor')) with check (public.has_admin_role('editor'));
drop policy if exists "admin import logs" on public.import_logs; create policy "admin import logs" on public.import_logs for all to authenticated using (public.has_admin_role('editor')) with check (public.has_admin_role('editor'));

insert into storage.buckets (id, name, public) values ('place-media', 'place-media', true) on conflict (id) do nothing;
