import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/serverEnv';
import { gsClubUrl, gsClubAnonKey, gsClubServiceKey } from '@/lib/gsClubAuthority';
import { assertIsolatedEnv } from '@/lib/envGuard';

// DEF-24 / GS-08: member submission is its own surface.
//
// The admin adapter (/api/funaging/tourism-gs) stays admin|editor only: members
// must never reach the moderation listing or rejection_reason. This route:
//   * requires an authenticated identity (any role, including none);
//   * forces status='pending' and records submitted_by server-side;
//   * accepts only a field allow-list (no id, no status, no rejection_reason);
//   * answers the duplicate check with a boolean, never with rows;
//   * writes through the Guide Sources service client, keeping GS the single writer.

assertIsolatedEnv();

const MEMBER_COLUMNS = new Set([
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
]);

const MAX_TEXT = 500;

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function asText(value: unknown, max = MAX_TEXT): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string').slice(0, 30);
}

function sanitizeMemberRow(input: unknown): Record<string, unknown> | { error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'invalid_row' };
  const body = input as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!MEMBER_COLUMNS.has(key)) return { error: `column_not_allowed:${key}` };
  }
  const name = asText(body.name, 200);
  const province = asText(body.province, 100);
  const category = asText(body.category, 100);
  if (!name) return { error: 'name_required' };
  if (!province) return { error: 'province_required' };
  if (!category || category.startsWith('--')) return { error: 'category_required' };

  const ratingRaw = Number(body.rating ?? 5);
  const rating = Number.isFinite(ratingRaw) ? Math.min(5, Math.max(1, Math.round(ratingRaw))) : 5;

  return {
    name,
    province,
    category,
    other_category: asText(body.other_category, 100),
    sub_category: asText(body.sub_category, 100),
    google_maps_url: asText(body.google_maps_url),
    phone: asText(body.phone, 50),
    recommender: asText(body.recommender, 200),
    suggestion: asText(body.suggestion, 2000),
    rating,
    amenities: asStringArray(body.amenities),
    alerts: asStringArray(body.alerts),
  };
}

async function requireMember(request: NextRequest) {
  const url = gsClubUrl() || serverEnv.SUPABASE_URL;
  const anonKey = gsClubAnonKey() || serverEnv.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { error: json(500, { error: 'auth env missing' }) };

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: json(401, { error: 'authentication_required' }) };

  const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return { error: json(401, { error: 'invalid_session' }) };
  return { userId: data.user.id };
}

function writeClient() {
  const url = serverEnv.FUNAGING_CORE_SUPABASE_URL;
  const service = serverEnv.FUNAGING_CORE_SUPABASE_SERVICE_ROLE_KEY;
  const schema = serverEnv.FUNAGING_TOURISM_SCHEMA || 'tourism_gs';
  if (!url || !service) return null;
  return createClient(url, service, { db: { schema }, auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(request: NextRequest) {
  const auth = await requireMember(request);
  if ('error' in auth) return auth.error;

  const name = (request.nextUrl.searchParams.get('name') || '').trim();
  if (!name) return json(400, { error: 'name_required' });

  const client = writeClient();
  if (!client) return json(500, { error: 'tourism_gs adapter env missing' });

  const { count, error } = await client
    .from('staging_places')
    .select('id', { count: 'exact', head: true })
    .ilike('name', name);
  if (error) return json(500, { error: error.message });

  // Boolean only: a member must never learn anything else about the queue.
  return json(200, { exists: (count ?? 0) > 0 });
}

export async function POST(request: NextRequest) {
  const auth = await requireMember(request);
  if ('error' in auth) return auth.error;

  const client = writeClient();
  if (!client) return json(500, { error: 'tourism_gs adapter env missing' });

  const body = await request.json().catch(() => ({}));
  const row = sanitizeMemberRow(body);
  if ('error' in row) return json(400, row);

  const { count, error: duplicateError } = await client
    .from('staging_places')
    .select('id', { count: 'exact', head: true })
    .ilike('name', String(row.name));
  if (duplicateError) return json(500, { error: duplicateError.message });
  if ((count ?? 0) > 0) return json(409, { error: 'duplicate_name' });

  const { data, error } = await client
    .from('staging_places')
    .insert({
      ...row,
      id: randomUUID(),
      status: 'pending',
      submitted_by: auth.userId,
    })
    .select('id,status,name')
    .single();

  if (error) return json(500, { error: error.message });
  return json(201, { id: data?.id, status: data?.status, name: data?.name });
}
