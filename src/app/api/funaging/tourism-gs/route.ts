import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/serverEnv';
import { gsRbacClient, gsClubUrl, gsClubAnonKey, gsClubServiceKey } from '@/lib/gsClubAuthority';
import { assertIsolatedEnv } from '@/lib/envGuard';

// Fail closed before touching any data if this is a test-mode process that is
// pointed at a non-loopback (i.e. production) Supabase project.
assertIsolatedEnv();

const TABLES = new Set(['staging_places', 'production_places']);

const PLACE_STATUSES = new Set(['pending', 'approved', 'rejected']);

/** Server-side allow-list: the client may not write columns outside this set. */
const WRITABLE_PLACE_COLUMNS = new Set([
  'id',
  'name',
  'province',
  'category',
  'other_category',
  'sub_category',
  'google_maps_url',
  'phone',
  'recommender',
  'suggestion',
  'rating',
  'amenities',
  'alerts',
  'status',
  'rejection_reason',
  'source_staging_id',
  'updated_at',
]);

function sanitizePlaceRow(input: unknown, forInsert: boolean): Record<string, unknown> | { error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'invalid_row' };
  const row = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const allowed = WRITABLE_PLACE_COLUMNS.has(key) && (key !== 'id' || forInsert);
    if (!allowed) return { error: `column_not_allowed:${key}` };
    out[key] = value;
  }
  if (typeof out.status === 'string' && !PLACE_STATUSES.has(out.status)) return { error: 'invalid_status' };
  // DEF-18: a client may supply the primary key, but it must be a uuid when present.
  // The insert path assigns one server-side when the caller omits it.
  if (forInsert && out.id !== undefined && (typeof out.id !== 'string' || !out.id)) return { error: 'invalid_id' };
  return out;
}

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function coreEnv() {
  const url = serverEnv.FUNAGING_CORE_SUPABASE_URL;
  const service = serverEnv.FUNAGING_CORE_SUPABASE_SERVICE_ROLE_KEY;
  const anon = serverEnv.FUNAGING_CORE_SUPABASE_ANON_KEY;
  const schema = serverEnv.FUNAGING_TOURISM_SCHEMA || 'tourism_gs';
  return { url, service, anon, schema };
}

function coreClient(key: string, schema: string, url: string) {
  return createClient(url, key, {
    db: { schema },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireGsAdmin(request: NextRequest) {
  const { url, anonKey, serviceRoleKey } = {
    url: gsClubUrl() || serverEnv.SUPABASE_URL,
    anonKey: gsClubAnonKey() || serverEnv.SUPABASE_ANON_KEY,
    serviceRoleKey: gsClubServiceKey() || serverEnv.SUPABASE_SERVICE_ROLE_KEY,
  };
  if (!url || !anonKey || !serviceRoleKey) {
    return { error: json(500, { error: 'GS auth server env missing' }) };
  }
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: json(401, { error: 'Missing bearer token' }) };

  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) {
    return { error: json(401, { error: userError?.message || 'Invalid session' }) };
  }
  const service = gsRbacClient();
  const { data: roleRows, error: roleError } = await service
    .from('gs_user_roles')
    .select('role')
    .eq('user_id', userData.user.id);
  if (roleError) return { error: json(500, { error: roleError.message }) };
  const roles = (roleRows || []).map((row) => row.role);
  if (!roles.includes('admin') && !roles.includes('editor')) {
    return { error: json(403, { error: 'Editor or admin role required' }) };
  }
  return { ok: true as const };
}

export async function GET(request: NextRequest) {
  const table = request.nextUrl.searchParams.get('table') || 'production_places';
  const status = request.nextUrl.searchParams.get('status');
  if (!TABLES.has(table)) return json(400, { error: 'invalid table' });
  const core = coreEnv();
  if (!core.url || !core.anon) return json(500, { error: 'Club tourism_gs adapter env missing' });

  if (table === 'production_places') {
    const client = coreClient(core.anon, core.schema, core.url);
    let q = client.from(table).select('*').order('updated_at', { ascending: false });
    if (status) q = q.eq('status', status);
    else q = q.eq('status', 'approved');
    const { data, error } = await q;
    if (error) return json(500, { error: error.message });
    return json(200, { data: data || [], authority: 'club_tourism_gs' });
  }

  const admin = await requireGsAdmin(request);
  if ('error' in admin) return admin.error;
  if (!core.service) return json(500, { error: 'Club service role missing for staging adapter' });
  const client = coreClient(core.service, core.schema, core.url);
  let q = client.from(table).select('*').order('updated_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return json(500, { error: error.message });
  return json(200, { data: data || [], authority: 'club_tourism_gs' });
}

export async function POST(request: NextRequest) {
  const admin = await requireGsAdmin(request);
  if ('error' in admin) return admin.error;
  const core = coreEnv();
  if (!core.url || !core.service) return json(500, { error: 'Club tourism_gs adapter env missing' });
  const body = await request.json().catch(() => ({}));
  const table = String(body.table || 'staging_places');
  if (!TABLES.has(table)) return json(400, { error: 'invalid table' });
  const row = sanitizePlaceRow(body.row, true);
  if ('error' in row) return json(400, row);
  // DEF-18: production_places.id has a default in the live schema but the
  // adapter must not depend on it; assign a uuid when the caller omits one.
  if (!row.id) row.id = randomUUID();
  const client = coreClient(core.service, core.schema, core.url);
  const { data, error } = await client.from(table).insert(row).select().single();
  if (error) return json(500, { error: error.message });
  return json(200, { data, authority: 'club_tourism_gs' });
}

export async function PATCH(request: NextRequest) {
  const admin = await requireGsAdmin(request);
  if ('error' in admin) return admin.error;
  const core = coreEnv();
  if (!core.url || !core.service) return json(500, { error: 'Club tourism_gs adapter env missing' });
  const body = await request.json().catch(() => ({}));
  const table = String(body.table || 'staging_places');
  const id = String(body.id || '');
  if (!TABLES.has(table) || !id) return json(400, { error: 'invalid table or id' });
  const row = sanitizePlaceRow(body.row, false);
  if ('error' in row) return json(400, row);
  const client = coreClient(core.service, core.schema, core.url);
  const { data, error } = await client.from(table).update(row).eq('id', id).select().single();
  if (error) return json(500, { error: error.message });
  return json(200, { data, authority: 'club_tourism_gs' });
}

export async function DELETE(request: NextRequest) {
  const admin = await requireGsAdmin(request);
  if ('error' in admin) return admin.error;
  const core = coreEnv();
  if (!core.url || !core.service) return json(500, { error: 'Club tourism_gs adapter env missing' });
  const table = request.nextUrl.searchParams.get('table') || '';
  const id = request.nextUrl.searchParams.get('id') || '';
  if (!TABLES.has(table) || !id) return json(400, { error: 'invalid table or id' });
  const client = coreClient(core.service, core.schema, core.url);
  const { error } = await client.from(table).delete().eq('id', id);
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true, authority: 'club_tourism_gs' });
}
