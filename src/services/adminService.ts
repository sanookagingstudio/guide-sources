import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { hasTourismGsConfig, getTourismGsBrowserClient } from '@/lib/tourismGs';
import type { PlaceRecord } from './placesService';
import { 
  approveLocalPlace, 
  listLocalAuditLogs, 
  listLocalUserRoles, 
  logLocalAdminAction, 
  rejectLocalPlace, 
  upsertLocalUserRole,
  addLocalUser,
  updateLocalUserRole,
  disableLocalUser,
  deleteLocalUser,
  listLocalUsers,
  type LocalUser,
} from './localStorageProvider';
export type AdminRole = 'admin' | 'editor' | 'viewer';

async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}

async function adminUsersApi(method: string, body?: unknown) {
  const token = await getAccessToken();
  const response = await fetch('/api/admin/users', {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Admin users API failed');
  return payload;
}
export type { LocalUser };
export async function getCurrentAdminRole() {
  if (!isSupabaseConfigured) return 'admin';

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token || '';

  if (!token) return null;

  const response = await fetch('/api/admin/me', {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'Admin role check failed');
  }

  return (payload.role || null) as AdminRole | null;
}
export async function logAdminAction(action: string, entityType: string, entityId?: string, details?: unknown) {
  if (!isSupabaseConfigured) { logLocalAdminAction(action, entityType, entityId, details); return; }
  const { data: userData } = await supabase.auth.getUser();
  const rbac = getTourismGsBrowserClient();
  if (rbac) { /* DEF-14: audit rows are written server-side by /api/funaging/tourism-gs; the browser must not write this table (RLS denies it). */ }
  else await supabase.from('admin_audit_logs').insert({ admin_user_id: userData.user?.id, action, entity_type: entityType, entity_id: entityId, details });
}
export async function approvePlace(place: PlaceRecord) {
  if (!isSupabaseConfigured) return approveLocalPlace(place);
  const payload = {
    source_staging_id: place.id || null,
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
    status: 'approved',
    updated_at: new Date().toISOString()
  };

  if (hasTourismGsConfig) {
    const token = await getAccessToken();
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
    const prod = await fetch('/api/funaging/tourism-gs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ table: 'production_places', row: payload }),
    });
    const prodBody = await prod.json().catch(() => ({}));
    if (!prod.ok) throw new Error('Approve production insert failed: ' + (prodBody.error || prod.status));
    if (place.id) {
      const staging = await fetch('/api/funaging/tourism-gs', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ table: 'staging_places', id: place.id, row: { status: 'approved', updated_at: new Date().toISOString() } }),
      });
      const stagingBody = await staging.json().catch(() => ({}));
      if (!staging.ok) throw new Error('Approve staging update failed: ' + (stagingBody.error || staging.status));
    }
    return prodBody.data as PlaceRecord;
  }

  const { data, error } = await supabase
    .from('production_places')
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw new Error('Approve production insert failed: ' + error.message);
  }

  const stagingResult = await supabase
    .from('staging_places')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', place.id);

  if (stagingResult.error) {
    throw new Error('Approve staging update failed: ' + stagingResult.error.message);
  }

  return data as PlaceRecord;
}
export async function rejectPlace(id: string, reason: string) {
  if (!isSupabaseConfigured) return rejectLocalPlace(id, reason);
  if (hasTourismGsConfig) {
    const token = await getAccessToken();
    const response = await fetch('/api/funaging/tourism-gs', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ table: 'staging_places', id, row: { status: 'rejected', rejection_reason: reason, updated_at: new Date().toISOString() } }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'reject adapter failed');
    await logAdminAction('reject', 'place', id, { reason });
    return;
  }
  const { error } = await supabase.from('staging_places').update({ status: 'rejected', rejection_reason: reason, updated_at: new Date().toISOString() }).eq('id', id); if (error) throw error; await logAdminAction('reject', 'place', id, { reason });
}
export async function listAuditLogs() { if (!isSupabaseConfigured) return listLocalAuditLogs(); const rbac = getTourismGsBrowserClient(); const client = rbac || supabase; const table = rbac ? 'gs_admin_audit_logs' : 'admin_audit_logs'; const { data, error } = await client.from(table).select('*').order('created_at', { ascending: false }).limit(50); if (error) throw error; return data || []; }
export async function listUserRoles() { if (!isSupabaseConfigured) return listLocalUserRoles(); const rbac = getTourismGsBrowserClient(); const client = rbac || supabase; const table = rbac ? 'gs_user_roles' : 'user_roles'; const { data, error } = await client.from(table).select('*').order('created_at', { ascending: false }); if (error) throw error; return data || []; }
export async function upsertUserRole(user_id: string, role: AdminRole) { if (!isSupabaseConfigured) return upsertLocalUserRole(user_id, role); const rbac = getTourismGsBrowserClient(); const client = rbac || supabase; const table = rbac ? 'gs_user_roles' : 'user_roles'; const { error } = await client.from(table).upsert({ user_id, role }); if (error) throw error; await logAdminAction('upsert_role', 'user_role', user_id, { role }); }

export async function addUser(display_name: string, email: string, role: AdminRole, password?: string): Promise<LocalUser> {
  if (!isSupabaseConfigured) return addLocalUser(display_name, email, role);

  const payload = await adminUsersApi('POST', { display_name, email, role, password });
  await logAdminAction('create_or_update_auth_user_role', 'user_role', payload.user?.user_id, { email, role });
  return payload.user as LocalUser;
}

export async function updateUserRole(user_id: string, role: AdminRole): Promise<LocalUser | null> {
  if (!isSupabaseConfigured) return updateLocalUserRole(user_id, role);

  await adminUsersApi('PATCH', { user_id, role });
  await logAdminAction('update_user_role', 'user_role', user_id, { role });

  return {
    user_id,
    display_name: '',
    email: '',
    role,
    status: 'active',
    created_at: new Date().toISOString(),
  };
}

export async function disableUser(user_id: string): Promise<LocalUser | null> {
  if (!isSupabaseConfigured) return disableLocalUser(user_id);

  await adminUsersApi('PUT', { user_id, action: 'disable' });
  await logAdminAction('disable_auth_user', 'user', user_id, {});

  return {
    user_id,
    display_name: '',
    email: '',
    role: 'viewer',
    status: 'disabled',
    created_at: new Date().toISOString(),
  };
}

export async function deleteUser(user_id: string): Promise<boolean> {
  if (!isSupabaseConfigured) return deleteLocalUser(user_id);

  await adminUsersApi('DELETE', { user_id });
  await logAdminAction('delete_user_role', 'user_role', user_id, {});

  return true;
}

export async function listUsers(): Promise<LocalUser[]> {
  if (!isSupabaseConfigured) return listLocalUsers();

  const payload = await adminUsersApi('GET');
  const rows = Array.isArray(payload.users) ? payload.users : [];

  return rows.map((user: any) => {
    const email = String(user.email || '').trim();
    const displayName = String(user.display_name || '').trim() || email.split('@')[0] || 'User';
    return {
      user_id: String(user.user_id || ''),
      display_name: displayName,
      email,
      role: (user.role || 'viewer') as AdminRole,
      status: user.status || 'active',
      created_at: user.created_at || new Date().toISOString(),
    };
  });
}







