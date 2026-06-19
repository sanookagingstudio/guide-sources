import type { PlaceFilters, PlaceRecord } from './placesService';

const PLACE_KEY = 'guide_sources_places';
const ROLE_KEY = 'guide_sources_local_user_roles';
const AUDIT_KEY = 'guide_sources_local_audit_logs';

const canUseStorage = () => typeof window !== 'undefined' && Boolean(window.localStorage);

const text = (value?: string | null) => (value || '').trim();

export type LocalUser = {
  user_id: string;
  display_name?: string;
  email?: string;
  role: 'admin' | 'editor' | 'viewer';
  status: 'active' | 'disabled';
  created_at: string;
};

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

const readRoles = (): LocalUser[] => {
  if (!canUseStorage()) return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(ROLE_KEY) || '[]');
    return raw.map((item: any) => ({
      user_id: item.user_id,
      display_name: item.display_name || '',
      email: item.email || '',
      role: item.role || 'viewer',
      status: item.status || 'active',
      created_at: item.created_at || new Date().toISOString(),
    })) as LocalUser[];
  } catch {
    return [];
  }
};

const writeRoles = (rows: LocalUser[]) => {
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
  return applyLocalFilters(readPlaces().filter((p) => p.status === 'approved'), filters);
}

export function listLocalStagingPlaces() {
  return readPlaces()
    .filter((p) => (p.status || 'pending') === 'pending')
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
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

export function listLocalUsers(): LocalUser[] {
  return readRoles().filter((u) => u.status === 'active');
}

export function addLocalUser(display_name: string, email: string, role: 'admin' | 'editor' | 'viewer'): LocalUser {
  const rows = readRoles();
  const user_id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const newUser: LocalUser = {
    user_id,
    display_name: text(display_name),
    email: text(email),
    role,
    status: 'active',
    created_at: new Date().toISOString(),
  };
  rows.unshift(newUser);
  writeRoles(rows);
  logLocalAdminAction('add_user', 'user', user_id, { display_name, email, role });
  return newUser;
}

export function updateLocalUserRole(user_id: string, role: 'admin' | 'editor' | 'viewer'): LocalUser | null {
  const rows = readRoles();
  const index = rows.findIndex((item) => item.user_id === user_id);
  if (index < 0) return null;
  rows[index] = { ...rows[index], role };
  writeRoles(rows);
  logLocalAdminAction('update_user_role', 'user', user_id, { role });
  return rows[index];
}

export function disableLocalUser(user_id: string): LocalUser | null {
  const rows = readRoles();
  const index = rows.findIndex((item) => item.user_id === user_id);
  if (index < 0) return null;
  rows[index] = { ...rows[index], status: 'disabled' };
  writeRoles(rows);
  logLocalAdminAction('disable_user', 'user', user_id, {});
  return rows[index];
}

export function deleteLocalUser(user_id: string): boolean {
  const rows = readRoles();
  const filtered = rows.filter((item) => item.user_id !== user_id);
  if (filtered.length === rows.length) return false;
  writeRoles(filtered);
  logLocalAdminAction('delete_user', 'user', user_id, {});
  return true;
}

export function upsertLocalUserRole(user_id: string, role: 'admin' | 'editor' | 'viewer') {
  const rows = readRoles();
  const index = rows.findIndex((item) => item.user_id === user_id);
  if (index >= 0) {
    rows[index] = { ...rows[index], role };
  } else {
    rows.unshift({ user_id, display_name: '', email: '', role, status: 'active', created_at: new Date().toISOString() });
  }
  writeRoles(rows);
  logLocalAdminAction('upsert_role', 'user_role', user_id, { role });
  return rows[index >= 0 ? index : 0];
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




export function listLocalRejectedPlaces() {
  return readPlaces()
    .filter((p) => p.status === 'rejected')
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
}


export type LocalDuplicateSuggestion = {
  id: string;
  score: number;
  reasons: string[];
  primary: PlaceRecord;
  candidate: PlaceRecord;
};

const normalizeDuplicateText = (value?: string | null) =>
  text(value).toLowerCase().replace(/\s+/g, '').replace(/[\-_.(),]/g, '');

const sameNonEmpty = (a?: string | null, b?: string | null) =>
  Boolean(text(a)) && normalizeDuplicateText(a) === normalizeDuplicateText(b);

const duplicateScore = (a: PlaceRecord, b: PlaceRecord) => {
  let score = 0;
  const reasons: string[] = [];

  const nameA = normalizeDuplicateText(a.name);
  const nameB = normalizeDuplicateText(b.name);

  if (nameA && nameA === nameB) {
    score += 70;
    reasons.push('ชื่อเหมือนกัน');
  } else if (nameA && nameB && (nameA.includes(nameB) || nameB.includes(nameA))) {
    score += 35;
    reasons.push('ชื่อคล้ายกัน');
  }

  if (sameNonEmpty(a.google_maps_url, b.google_maps_url)) {
    score += 80;
    reasons.push('Google Maps URL เดียวกัน');
  }

  if (sameNonEmpty(a.phone, b.phone)) {
    score += 40;
    reasons.push('เบอร์โทรเหมือนกัน');
  }

  if (text(a.province) && text(a.province) === text(b.province)) {
    score += 10;
    reasons.push('จังหวัดเดียวกัน');
  }

  if (text(a.category) && text(a.category) === text(b.category)) {
    score += 10;
    reasons.push('หมวดเดียวกัน');
  }

  return { score, reasons };
};

export function listLocalDuplicateSuggestions() {
  const rows = readPlaces()
    .filter((place) => place.status === 'pending' || place.status === 'approved')
    .filter((place) => text(place.name));

  const suggestions: LocalDuplicateSuggestion[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const result = duplicateScore(rows[i], rows[j]);
      if (result.score >= 60) {
        suggestions.push({
          id: `${rows[i].id || rows[i].name}__${rows[j].id || rows[j].name}`,
          score: Math.min(result.score, 100),
          reasons: result.reasons,
          primary: rows[i],
          candidate: rows[j],
        });
      }
    }
  }

  return suggestions
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);
}
