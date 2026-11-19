-- tourism_gs canonical schema (Guide Sources knowledge plane)
--
-- Why this file exists:
--   The 2026-06 migrations (0001_guide_sources_schema.sql / 202606150001_*)
--   create the same tables in `public`. The live database no longer uses that
--   shape: knowledge was migrated to the `tourism_gs` schema of the Club/Core
--   project ("Migrated Guide Sources knowledge into Club plane A. Logical owner
--   GUIDE_SOURCES."). Those older migrations are HISTORICAL - do not apply them
--   to a new environment.
--
-- Provenance:
--   Columns, defaults and constraints are transcribed from the retained
--   production schema export prod-schema-25691104-183832.sql (582,276 bytes,
--   2026-11-04 18:39), lines 32-38, 86-93, 8771-8903, 10189-10210,
--   12961-12987, 15007-15033.
--
-- This migration is additive and idempotent. It does not drop or rewrite data.

create schema if not exists tourism_gs;

-- Supabase provides anon / authenticated / service_role. Guard their creation so
-- this migration can also be applied to a plain PostgreSQL instance for testing.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

comment on schema tourism_gs is
  'Migrated Guide Sources knowledge into Club plane A. Logical owner GUIDE_SOURCES. Physical plane A. Adapter required for apps.';

do $$ begin
  create type tourism_gs.gs_role as enum ('admin', 'editor', 'viewer');
exception when duplicate_object then null; end $$;

create table if not exists tourism_gs.staging_places (
  id uuid not null,
  submitted_by uuid,
  name text not null,
  province text not null,
  category text not null,
  other_category text,
  sub_category text,
  google_maps_url text,
  phone text,
  recommender text,
  suggestion text,
  rating integer,
  amenities jsonb not null default '[]'::jsonb,
  alerts jsonb not null default '[]'::jsonb,
  status text not null,
  rejection_reason text,
  created_at timestamptz,
  updated_at timestamptz,
  source_staging_id uuid,
  constraint staging_places_pkey primary key (id)
);

create table if not exists tourism_gs.production_places (
  like tourism_gs.staging_places including defaults including constraints including indexes
);

create table if not exists tourism_gs.gs_backup_staging_places_before_repair (
  like tourism_gs.staging_places including defaults including constraints including indexes
);

create table if not exists tourism_gs.gs_profiles (
  id uuid not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gs_profiles_pkey primary key (id)
);

create table if not exists tourism_gs.gs_user_roles (
  user_id uuid not null,
  role tourism_gs.gs_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gs_user_roles_pkey primary key (user_id, role)
);

create table if not exists tourism_gs.gs_admin_audit_logs (
  id uuid not null default gen_random_uuid(),
  admin_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint gs_admin_audit_logs_pkey primary key (id)
);

create table if not exists tourism_gs.place_media (
  id uuid not null default gen_random_uuid(),
  place_id uuid,
  staging_place_id uuid,
  media_type text,
  storage_bucket text not null default 'place-media',
  storage_path text not null,
  public_url text,
  caption text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint place_media_pkey primary key (id)
);

comment on table tourism_gs.gs_user_roles is
  'Guide Sources RBAC migrated to Club plane A. Logical owner GUIDE_SOURCES.';

-- Defence in depth: every exposed table is deny-by-default for browser roles.
alter table tourism_gs.staging_places enable row level security;
alter table tourism_gs.production_places enable row level security;
alter table tourism_gs.gs_backup_staging_places_before_repair enable row level security;
alter table tourism_gs.gs_profiles enable row level security;
alter table tourism_gs.gs_user_roles enable row level security;
alter table tourism_gs.gs_admin_audit_logs enable row level security;
alter table tourism_gs.place_media enable row level security;

revoke all on tourism_gs.staging_places from anon, authenticated;
revoke all on tourism_gs.gs_backup_staging_places_before_repair from anon, authenticated;
revoke all on tourism_gs.gs_profiles from anon, authenticated;
revoke all on tourism_gs.gs_user_roles from anon, authenticated;
revoke all on tourism_gs.gs_admin_audit_logs from anon, authenticated;
revoke all on tourism_gs.place_media from anon, authenticated;

-- Public tourism directory: anonymous callers see approved rows only.
grant usage on schema tourism_gs to anon, authenticated;
grant select on tourism_gs.production_places to anon, authenticated;

-- The adapter writes with the service role (the only role with write privilege on
-- staging_places in production). Granted here so a non-Supabase instance behaves
-- the same way.
grant usage on schema tourism_gs to service_role;
grant all on all tables in schema tourism_gs to service_role;

drop policy if exists gs_prod_anon_select_approved on tourism_gs.production_places;
create policy gs_prod_anon_select_approved on tourism_gs.production_places
  for select to anon using (status = 'approved');

-- Authenticated staff need full read for the admin screens.
-- NOTE (open finding S1): this policy is `using (true)` in production and lets
-- every authenticated user read unapproved rows and rejection_reason.
-- Tightening it is a policy change and is NOT part of this migration.
drop policy if exists gs_prod_auth_select on tourism_gs.production_places;
create policy gs_prod_auth_select on tourism_gs.production_places
  for select to authenticated using (true);
