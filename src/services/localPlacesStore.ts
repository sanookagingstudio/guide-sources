import type { PlaceFilters, PlaceRecord } from './placesService';

const KEY = 'guide_sources_local_places';
const memory: PlaceRecord[] = [];
const canUseStorage = () => typeof window !== 'undefined' && Boolean(window.localStorage);
const read = (): PlaceRecord[] => {
  if (!canUseStorage()) return memory;
  try { return JSON.parse(window.localStorage.getItem(KEY) || '[]') as PlaceRecord[]; } catch { return []; }
};
const write = (rows: PlaceRecord[]) => {
  memory.splice(0, memory.length, ...rows);
  if (canUseStorage()) window.localStorage.setItem(KEY, JSON.stringify(rows));
};
export function listLocalPlaces(filters: PlaceFilters = {}) { const keyword = (filters.keyword || '').toLowerCase(); return read().filter((p) => { const haystack = [p.name, p.province, p.category, p.sub_category, p.suggestion, ...(p.amenities || []), ...(p.alerts || [])].join(' ').toLowerCase(); return (p.status === 'approved' || p.status === 'pending') && (!keyword || haystack.includes(keyword)) && (!filters.province || p.province === filters.province) && (!filters.category || p.category === filters.category) && (!filters.sub_category || p.sub_category === filters.sub_category) && (!filters.rating || p.rating >= filters.rating) && (!filters.amenities?.length || filters.amenities.every((a) => p.amenities.includes(a))) && (!filters.alerts?.length || filters.alerts.every((a) => p.alerts.includes(a))); }); }
export function findLocalDuplicatePlaceName(name: string, excludeId?: string) { return read().find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase() && p.id !== excludeId) || null; }
export function saveLocalPlace(place: PlaceRecord) { const rows = read(); const saved = { ...place, id: place.id || `local-${Date.now()}`, status: place.status || 'pending', updated_at: new Date().toISOString(), created_at: place.created_at || new Date().toISOString() }; const index = rows.findIndex((p) => p.id === saved.id); if (index >= 0) rows[index] = saved; else rows.unshift(saved); write(rows); return saved; }
export function clearLocalPlacesForTests() { write([]); }
