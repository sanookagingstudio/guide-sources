import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { getTourismGsBrowserClient, hasTourismGsConfig } from '@/lib/tourismGs';
import { normalizeCategoryLabel } from '@/lib/constants';
import { findLocalDuplicatePlaceName, listLocalPlaces, saveLocalPlace } from './localStorageProvider';
import { listLocalStagingPlaces, listLocalRejectedPlaces, listLocalDuplicateSuggestions } from './localStorageProvider';

export type PlaceStatus = 'pending' | 'approved' | 'rejected';
export type LocalMediaRecord = {
  id?: string;
  media_type: 'image' | 'video';
  file_name: string;
  data_url?: string;
  media_url?: string;
  media_caption?: string;
  created_at?: string;
};
export type PlaceRecord = {
  id?: string; source_staging_id?: string | null; name: string; province: string; category: string; other_category?: string | null; sub_category?: string | null; google_maps_url?: string | null; phone?: string | null; line?: string | null; recommender?: string | null; suggestion?: string | null; rejection_reason?: string | null; rating: number; amenities: string[]; alerts: string[]; status?: PlaceStatus; created_at?: string; updated_at?: string; local_media?: LocalMediaRecord[]; contributor_name?: string | null; line_display_name?: string | null; email?: string | null; media_type?: 'image' | 'video' | null; media_url?: string | null; media_caption?: string | null; source_channel?: string | null;
};
export type PlaceFilters = { keyword?: string; province?: string; category?: string; sub_category?: string; amenities?: string[]; alerts?: string[]; rating?: number };

const text = (v?: string | null) => (v || '').trim();

function knowledgeReadClient() {
  return getTourismGsBrowserClient() || (isSupabaseConfigured ? supabase : null);
}

async function gsAdminToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}

async function tourismGsAdminFetch(path: string, init: RequestInit = {}) {
  const token = await gsAdminToken();
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'tourism_gs adapter failed');
  return payload;
}
export function applyLocalFilters<T extends PlaceRecord>(places: T[], filters: PlaceFilters) {
  const keyword = text(filters.keyword).toLowerCase();
  return places.filter((p) => {
    const haystack = [p.name, p.province, p.category, p.other_category, p.sub_category, p.phone, p.recommender, p.suggestion, ...(p.amenities || []), ...(p.alerts || [])].join(' ').toLowerCase();
    const normalizedCategory = normalizeCategoryLabel(p.category || '');
    return (
      (!keyword || haystack.includes(keyword))
      && (!filters.province || p.province === filters.province)
      && (!filters.category || normalizedCategory === filters.category)
      && (!filters.sub_category || p.sub_category === filters.sub_category)
      && (!filters.rating || Number(p.rating) >= filters.rating)
      && (!filters.amenities?.length || filters.amenities.every((a) => p.amenities?.includes(a)))
      && (!filters.alerts?.length || filters.alerts.every((a) => p.alerts?.includes(a)))
    );
  });
}
export async function listApprovedPlaces(filters: PlaceFilters = {}, options?: { onWarning?: (message: string) => void }) {
  const localRows = listLocalPlaces(filters);
  if (!isSupabaseConfigured) return localRows;

  try {
    const client = knowledgeReadClient();
    if (!client) return localRows;
    const { data, error } = await client.from('production_places').select('*').eq('status', 'approved').order('updated_at', { ascending: false });
    if (error) throw error;
    const remoteRows = applyLocalFilters((data || []) as PlaceRecord[], filters);
    const mergedRemote = remoteRows.map((remote) => {
      const local = localRows.find((place) => place.id === remote.id);
      return local?.local_media ? { ...remote, local_media: local.local_media } : remote;
    });
    const merged = [...mergedRemote, ...localRows.filter((place) => !remoteRows.some((row) => row.id === place.id))];
    return merged;
  } catch (error) {
    options?.onWarning?.('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ จึงใช้ข้อมูลในเบราว์เซอร์แทน');
    return localRows;
  }
}
export async function listStagingPlaces() {
  if (!isSupabaseConfigured) return listLocalStagingPlaces();
  if (hasTourismGsConfig) {
    const payload = await tourismGsAdminFetch('/api/funaging/tourism-gs?table=staging_places&status=pending');
    return (payload.data || []) as PlaceRecord[];
  }
  const { data, error } = await supabase.from('staging_places').select('*').eq('status', 'pending').order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []) as PlaceRecord[];
}

export async function listRejectedPlaces() {
  if (!isSupabaseConfigured) return listLocalRejectedPlaces();
  if (hasTourismGsConfig) {
    const payload = await tourismGsAdminFetch('/api/funaging/tourism-gs?table=staging_places&status=rejected');
    return (payload.data || []) as PlaceRecord[];
  }
  const { data, error } = await supabase
    .from('staging_places')
    .select('*')
    .eq('status', 'rejected')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []) as PlaceRecord[];
}
export async function getPlaceById(id: string, table: 'staging_places' | 'production_places' = 'production_places') {
  const client = knowledgeReadClient();
  if (!client) throw new Error('knowledge client missing');
  const { data, error } = await client.from(table).select('*').eq('id', id).single();
  if (error) throw error;
  return data as PlaceRecord;
}
export async function findDuplicatePlaceName(name: string, excludeId?: string) {
  if (!isSupabaseConfigured) return findLocalDuplicatePlaceName(name, excludeId);
  if (hasTourismGsConfig) {
    const payload = await tourismGsAdminFetch('/api/funaging/tourism-gs?table=staging_places');
    const rows = (payload.data || []) as Array<{ id: string; name: string; status: string }>;
    const hit = rows.find((row) => row.name?.toLowerCase() === text(name).toLowerCase() && row.id !== excludeId);
    return hit || null;
  }
  const client = knowledgeReadClient();
  if (!client) return null;
  let query = client.from('staging_places').select('id,name,status').ilike('name', text(name));
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

// DEF-24 / GS-08: member-facing submissions never touch the admin adapter.
// They use a dedicated endpoint that forces status=pending and exposes only a
// boolean duplicate check, so a member cannot read the moderation queue.
async function memberFetch(path: string, init: RequestInit = {}) {
  const token = await gsAdminToken();
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, payload } as const;
}

export async function checkMemberDuplicateName(name: string, excludeId?: string): Promise<PlaceRecord | null> {
  if (!isSupabaseConfigured || !hasTourismGsConfig) return findDuplicatePlaceName(name, excludeId);
  const res = await memberFetch(`/api/funaging/member-submissions?name=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(String(res.payload.error || `duplicate check failed (${res.status})`));
  return res.payload.exists ? ({ id: '', name, status: 'pending' } as PlaceRecord) : null;
}

export async function submitMemberPlace(
  place: PlaceRecord
): Promise<{ record: PlaceRecord; syncState: PlaceSyncState; error?: string }> {
  if (!isSupabaseConfigured || !hasTourismGsConfig) return saveStagingPlaceDetailed(place);
  const payload = {
    name: place.name || '',
    province: place.province || '',
    category: place.category || '',
    other_category: place.other_category || null,
    sub_category: place.sub_category || null,
    google_maps_url: place.google_maps_url || null,
    phone: place.phone || null,
    recommender: place.recommender || null,
    suggestion: place.suggestion || null,
    rating: Number(place.rating || 5),
    amenities: Array.isArray(place.amenities) ? place.amenities : [],
    alerts: Array.isArray(place.alerts) ? place.alerts : [],
  };
  try {
    const res = await memberFetch('/api/funaging/member-submissions', { method: 'POST', body: JSON.stringify(payload) });
    if (!res.ok) {
      return { record: place, syncState: 'failed', error: String(res.payload.error || `submit failed (${res.status})`) };
    }
    return {
      record: { ...place, id: String(res.payload.id || place.id || ''), status: 'pending' },
      syncState: 'synced',
    };
  } catch (e) {
    return { record: place, syncState: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}
export async function saveStagingPlaceDetailed(
  place: PlaceRecord
): Promise<{ record: PlaceRecord; syncState: PlaceSyncState; error?: string }> {
  const localSaved = saveLocalPlace({ ...place, status: place.status || 'pending' });
  if (!isSupabaseConfigured) {
    return { record: localSaved, syncState: 'local-only', error: 'supabase_not_configured' };
  }
  try {
    const forInsert = !place.id;
    const payload = toSafeStagingPayload(place, forInsert);
    if (hasTourismGsConfig) {
      const result = place.id
        ? await tourismGsAdminFetch('/api/funaging/tourism-gs', { method: 'PATCH', body: JSON.stringify({ table: 'staging_places', id: place.id, row: payload }) })
        : await tourismGsAdminFetch('/api/funaging/tourism-gs', { method: 'POST', body: JSON.stringify({ table: 'staging_places', row: payload }) });
      return { record: result.data as PlaceRecord, syncState: 'synced' };
    }
    const { data, error } = place.id
      ? await supabase.from('staging_places').update(payload).eq('id', place.id).select().single()
      : await supabase.from('staging_places').insert(payload).select().single();
    if (error) throw error;
    return { record: data as PlaceRecord, syncState: 'synced' };
  } catch (error) {
    return {
      record: localSaved,
      syncState: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function saveStagingPlace(place: PlaceRecord) {
  return (await saveStagingPlaceDetailed(place)).record;
}
export async function deletePlace(id: string, table: 'staging_places' | 'production_places') {
  if (!isSupabaseConfigured) {
    const { deleteLocalPlace } = await import('./localStorageProvider');
    return deleteLocalPlace(id, table);
  }
  if (hasTourismGsConfig) {
    const token = await gsAdminToken();
    const response = await fetch(`/api/funaging/tourism-gs?table=${table}&id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'tourism_gs delete failed');
    return;
  }
  const { error } = await supabase.from(table).delete().eq('id', id); if (error) throw error;
}



export async function listDuplicateSuggestions() {
  if (!isSupabaseConfigured) return listLocalDuplicateSuggestions();
  return [];
}

/** Columns that may be written to tourism_gs.staging_places. Mirrors the live DDL. */
export const STAGING_WRITABLE_COLUMNS = [
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
  'updated_at',
] as const;

export type PlaceSyncState = 'synced' | 'local-only' | 'failed';

function toSafeStagingPayload(place: PlaceRecord, forInsert: boolean) {
  const payload: Record<string, unknown> = {
    name: place.name,
    province: place.province,
    category: place.category,
    other_category: place.other_category ?? null,
    sub_category: place.sub_category ?? null,
    google_maps_url: place.google_maps_url ?? null,
    phone: place.phone ?? null,
    recommender: place.recommender ?? null,
    suggestion: place.suggestion ?? null,
    rating: typeof place.rating === 'number' ? place.rating : 5,
    amenities: place.amenities ?? [],
    alerts: place.alerts ?? [],
    status: (place.status ?? 'pending') as PlaceStatus,
    rejection_reason: place.rejection_reason ?? null,
    updated_at: new Date().toISOString(),
  };
  // id is NOT NULL with no default on the live table, so an insert must supply it.
  if (forInsert) payload.id = place.id || globalThis.crypto.randomUUID();
  const unknown = Object.keys(payload).filter(
    (k) => !(STAGING_WRITABLE_COLUMNS as readonly string[]).includes(k)
  );
  if (unknown.length) throw new Error(`STAGING_PAYLOAD_COLUMN_DRIFT:${unknown.join(',')}`);
  return payload;
}

export async function createPendingPlace(place: PlaceRecord) {
  return saveStagingPlace({
    ...place,
    status: 'pending',
    source_channel: place.source_channel || 'line_or_public_link',
  });
}


