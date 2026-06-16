import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { normalizeCategoryLabel } from '@/lib/constants';
import { findLocalDuplicatePlaceName, listLocalPlaces, saveLocalPlace } from './localStorageProvider';
import { listLocalStagingPlaces, listLocalRejectedPlaces, listLocalDuplicateSuggestions } from './localStorageProvider';

export type PlaceStatus = 'pending' | 'approved' | 'rejected';
export type LocalMediaRecord = {
  id?: string;
  media_type: 'image' | 'video';
  file_name: string;
  data_url?: string;
  created_at?: string;
};
export type PlaceRecord = {
  id?: string; source_staging_id?: string | null; name: string; province: string; category: string; other_category?: string | null; sub_category?: string | null; google_maps_url?: string | null; phone?: string | null; line?: string | null; recommender?: string | null; suggestion?: string | null; rejection_reason?: string | null; rating: number; amenities: string[]; alerts: string[]; status?: PlaceStatus; created_at?: string; updated_at?: string; local_media?: LocalMediaRecord[];
};
export type PlaceFilters = { keyword?: string; province?: string; category?: string; sub_category?: string; amenities?: string[]; alerts?: string[]; rating?: number };

const text = (v?: string | null) => (v || '').trim();
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
    const { data, error } = await supabase.from('production_places').select('*').eq('status', 'approved').order('updated_at', { ascending: false });
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
export async function listStagingPlaces() { if (!isSupabaseConfigured) return listLocalStagingPlaces(); const { data, error } = await supabase.from('staging_places').select('*').order('updated_at', { ascending: false }); if (error) throw error; return (data || []) as PlaceRecord[]; }

export async function listRejectedPlaces() {
  if (!isSupabaseConfigured) return listLocalRejectedPlaces();
  const { data, error } = await supabase
    .from('staging_places')
    .select('*')
    .eq('status', 'rejected')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []) as PlaceRecord[];
}
export async function getPlaceById(id: string, table: 'staging_places' | 'production_places' = 'production_places') { const { data, error } = await supabase.from(table).select('*').eq('id', id).single(); if (error) throw error; return data as PlaceRecord; }
export async function findDuplicatePlaceName(name: string, excludeId?: string) { if (!isSupabaseConfigured) return findLocalDuplicatePlaceName(name, excludeId); let query = supabase.from('staging_places').select('id,name,status').ilike('name', text(name)); if (excludeId) query = query.neq('id', excludeId); const { data, error } = await query.limit(1); if (error) throw error; return data?.[0] || null; }
export async function saveStagingPlace(place: PlaceRecord) {
  const localSaved = saveLocalPlace({ ...place, status: place.status || 'pending' });
  if (!isSupabaseConfigured) return localSaved;
  try {
    const payload = { ...place, status: place.status || 'pending', updated_at: new Date().toISOString() } as Omit<PlaceRecord, 'local_media'>;
    delete (payload as any).local_media;
    const { data, error } = place.id
      ? await supabase.from('staging_places').update(payload).eq('id', place.id).select().single()
      : await supabase.from('staging_places').insert(payload).select().single();
    if (error) throw error;
    return data as PlaceRecord;
  } catch (error) {
    return localSaved;
  }
}
export async function deletePlace(id: string, table: 'staging_places' | 'production_places') {
  if (!isSupabaseConfigured) {
    const { deleteLocalPlace } = await import('./localStorageProvider');
    return deleteLocalPlace(id, table);
  }
  const { error } = await supabase.from(table).delete().eq('id', id); if (error) throw error;
}



export async function listDuplicateSuggestions() {
  if (!isSupabaseConfigured) return listLocalDuplicateSuggestions();
  return [];
}
