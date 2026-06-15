import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { findLocalDuplicatePlaceName, listLocalPlaces, saveLocalPlace } from './localPlacesStore';

export type PlaceStatus = 'pending' | 'approved' | 'rejected';
export type PlaceRecord = {
  id?: string; source_staging_id?: string | null; name: string; province: string; category: string; other_category?: string | null; sub_category?: string | null; google_maps_url?: string | null; phone?: string | null; recommender?: string | null; suggestion?: string | null; rating: number; amenities: string[]; alerts: string[]; status?: PlaceStatus; created_at?: string; updated_at?: string;
};
export type PlaceFilters = { keyword?: string; province?: string; category?: string; sub_category?: string; amenities?: string[]; alerts?: string[]; rating?: number };

const text = (v?: string | null) => (v || '').trim();
export function applyLocalFilters<T extends PlaceRecord>(places: T[], filters: PlaceFilters) {
  const keyword = text(filters.keyword).toLowerCase();
  return places.filter((p) => {
    const haystack = [p.name, p.province, p.category, p.other_category, p.sub_category, p.phone, p.recommender, p.suggestion, ...(p.amenities || []), ...(p.alerts || [])].join(' ').toLowerCase();
    return (!keyword || haystack.includes(keyword)) && (!filters.province || p.province === filters.province) && (!filters.category || p.category === filters.category) && (!filters.sub_category || p.sub_category === filters.sub_category) && (!filters.rating || Number(p.rating) >= filters.rating) && (!filters.amenities?.length || filters.amenities.every((a) => p.amenities?.includes(a))) && (!filters.alerts?.length || filters.alerts.every((a) => p.alerts?.includes(a)));
  });
}
export async function listApprovedPlaces(filters: PlaceFilters = {}) {
  if (!isSupabaseConfigured) return listLocalPlaces(filters);
  const { data, error } = await supabase.from('production_places').select('*').eq('status', 'approved').order('updated_at', { ascending: false });
  if (error) throw error;
  return applyLocalFilters((data || []) as PlaceRecord[], filters);
}
export async function listStagingPlaces() { if (!isSupabaseConfigured) return listLocalPlaces({}); const { data, error } = await supabase.from('staging_places').select('*').order('updated_at', { ascending: false }); if (error) throw error; return (data || []) as PlaceRecord[]; }
export async function getPlaceById(id: string, table: 'staging_places' | 'production_places' = 'production_places') { const { data, error } = await supabase.from(table).select('*').eq('id', id).single(); if (error) throw error; return data as PlaceRecord; }
export async function findDuplicatePlaceName(name: string, excludeId?: string) { if (!isSupabaseConfigured) return findLocalDuplicatePlaceName(name, excludeId); let query = supabase.from('staging_places').select('id,name,status').ilike('name', text(name)); if (excludeId) query = query.neq('id', excludeId); const { data, error } = await query.limit(1); if (error) throw error; return data?.[0] || null; }
export async function saveStagingPlace(place: PlaceRecord) { if (!isSupabaseConfigured) return saveLocalPlace(place); const payload = { ...place, status: place.status || 'pending', updated_at: new Date().toISOString() }; const { data, error } = place.id ? await supabase.from('staging_places').update(payload).eq('id', place.id).select().single() : await supabase.from('staging_places').insert(payload).select().single(); if (error) throw error; return data as PlaceRecord; }
export async function deletePlace(id: string, table: 'staging_places' | 'production_places') { const { error } = await supabase.from(table).delete().eq('id', id); if (error) throw error; }
