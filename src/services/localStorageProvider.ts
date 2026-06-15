import type { PlaceFilters, PlaceRecord } from './placesService';

const PLACE_KEY = 'guide_sources_places';
const ROLE_KEY = 'guide_sources_local_user_roles';
const AUDIT_KEY = 'guide_sources_local_audit_logs';

const canUseStorage = () => typeof window !== 'undefined' && Boolean(window.localStorage);

const text = (value?: string | null) => (value || '').trim();

export const readPlaces = (): PlaceRecord[] => {
  if (!canUseStorage()) return [];
  try {
    return JSON.parse(window.localStorage.getItem(PLACE_KEY) || '[]') as PlaceRecord[];
  } catch {
    return [];
  }
};

const writePlaces = (rows: PlaceRecord[]) => {
  if (canUseStorage()) window.localStorage.setItem(PLACE_KEY, JSON.stringify(rows));
};

const readRoles = () => {
  if (!canUseStorage()) return [];
  try {
    return JSON.parse(window.localStorage.getItem(ROLE_KEY) || '[]') as Array<{ user_id: string; role: string; created_at?: string }>;
  } catch {
    return [];
  }
};

const writeRoles = (rows: Array<{ user_id: string; role: string; created_at?: string }>) => {
  if (canUseStorage()) window.localStorage.setItem(ROLE_KEY, JSON.stringify(rows));
};

const readAudit = () => {
  if (!canUseStorage()) return [];
  try {
    return JSON.parse(window.localStorage.getItem(AUDIT_KEY) || '[]') as Array<{ id: string; created_at: string; action: string; entity_type: string; entity_id?: string; details?: unknown }>;
  } catch {
    return [];
  }
};

const writeAudit = (rows: Array<{ id: string; created_at: string; action: string; entity_type: string; entity_id?: string; details?: unknown }>) => {
  if (canUseStorage()) window.localStorage.setItem(AUDIT_KEY, JSON.stringify(rows));
};

export function applyLocalFilters<T extends PlaceRecord>(places: T[], filters: PlaceFilters) {
  const keyword = text(filters.keyword).toLowerCase();
  return places.filter((p) => {
    const haystack = [p.name, p.province, p.category, p.other_category, p.sub_category, p.phone, p.recommender, p.suggestion, ...(p.amenities || []), ...(p.alerts || [])].join(' ').toLowerCase();
    return (!keyword || haystack.includes(keyword)) && (!filters.province || p.province === filters.province) && (!filters.category || p.category === filters.category) && (!filters.sub_category || p.sub_category === filters.sub_category) && (!filters.rating || Number(p.rating) >= filters.rating) && (!filters.amenities?.length || filters.amenities.every((a) => p.amenities?.includes(a))) && (!filters.alerts?.length || filters.alerts.every((a) => p.alerts?.includes(a)));
  });
}

export function listLocalPlaces(filters: PlaceFilters = {}) {
  return applyLocalFilters(readPlaces().filter((p) => p.status === 'approved' || p.status === 'pending'), filters);
}

export function listLocalStagingPlaces() {
  return [...readPlaces()].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
}

export function findLocalDuplicatePlaceName(name: string, excludeId?: string) {
  return readPlaces().find((p) => p.name.trim().toLowerCase() === text(name).toLowerCase() && p.id !== excludeId) || null;
}

export function saveLocalPlace(place: PlaceRecord) {
  const rows = readPlaces();
  const saved = {
    ...place,
    id: place.id || `local-${Date.now()}`,
    status: place.status || 'pending',
    created_at: place.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as PlaceRecord;
  const index = rows.findIndex((p) => p.id === saved.id);
  if (index >= 0) rows[index] = saved; else rows.unshift(saved);
  writePlaces(rows);
  return saved;
}

export function approveLocalPlace(place: PlaceRecord) {
  const saved = saveLocalPlace({ ...place, status: 'approved' });
  logLocalAdminAction('approve', 'place', saved.id, { name: saved.name });
  return saved;
}

export function rejectLocalPlace(id: string, reason: string) {
  const rows = readPlaces();
  const index = rows.findIndex((item) => item.id === id);
  if (index < 0) return null;
  rows[index] = { ...rows[index], status: 'rejected', rejection_reason: reason, updated_at: new Date().toISOString() };
  writePlaces(rows);
  logLocalAdminAction('reject', 'place', id, { reason });
  return rows[index];
}

export function deleteLocalPlace(id: string, table: 'staging_places' | 'production_places') {
  const rows = readPlaces().filter((item) => {
    const isStaging = item.status !== 'approved';
    return !(item.id === id && (table === 'staging_places' ? isStaging : item.status === 'approved'));
  });
  writePlaces(rows);
  logLocalAdminAction('delete', table, id, {});
}

export function importLocalPlaces(raw: string) {
  const trimmed = raw.trim();
  const rows = trimmed.startsWith('[')
    ? JSON.parse(trimmed) as PlaceRecord[]
    : trimmed
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(1)
        .map((line) => {
          const [name, province, category, rating] = line.split(',').map((cell) => cell.trim());
          return { name, province, category, rating: Number(rating || 5), amenities: [], alerts: [], status: 'pending' } as PlaceRecord;
        });

  const imported = rows.map((row) => saveLocalPlace({ ...row, status: 'pending' }));
  logLocalAdminAction('import', 'places', undefined, { count: imported.length, source: trimmed.startsWith('[') ? 'json' : 'csv' });
  return { imported: imported.length, total: rows.length };
}

export function listLocalAuditLogs() {
  return readAudit().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

export function listLocalUserRoles() {
  return readRoles();
}

export function upsertLocalUserRole(user_id: string, role: 'admin' | 'editor' | 'viewer') {
  const rows = readRoles();
  const index = rows.findIndex((item) => item.user_id === user_id);
  const updated = { user_id, role, created_at: rows[index]?.created_at || new Date().toISOString() };
  if (index >= 0) rows[index] = updated; else rows.unshift(updated);
  writeRoles(rows);
  logLocalAdminAction('upsert_role', 'user_role', user_id, { role });
  return updated;
}

export function logLocalAdminAction(action: string, entityType: string, entityId?: string, details?: unknown) {
  const rows = readAudit();
  rows.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
  });
  writeAudit(rows.slice(0, 100));
}

export function clearLocalStorageForDemo() {
  if (canUseStorage()) {
    window.localStorage.removeItem(PLACE_KEY);
    window.localStorage.removeItem(ROLE_KEY);
    window.localStorage.removeItem(AUDIT_KEY);
  }
}
