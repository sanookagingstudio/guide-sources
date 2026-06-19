import { isSupabaseConfigured, supabase } from '@/lib/supabase';
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
  await supabase.from('admin_audit_logs').insert({ admin_user_id: userData.user?.id, action, entity_type: entityType, entity_id: entityId, details });
}
export async function approvePlace(place: PlaceRecord) {
  if (!isSupabaseConfigured) return approveLocalPlace(place);
  const payload = { ...place, source_staging_id: place.id, status: 'approved', updated_at: new Date().toISOString() }; delete payload.id; const { data, error } = await supabase.from('production_places').upsert(payload, { onConflict: 'source_staging_id' }).select().single(); if (error) throw error; await supabase.from('staging_places').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('id', place.id); await logAdminAction('approve', 'place', place.id, { name: place.name }); return data as PlaceRecord;
}
export async function rejectPlace(id: string, reason: string) {
  if (!isSupabaseConfigured) return rejectLocalPlace(id, reason);
  const { error } = await supabase.from('staging_places').update({ status: 'rejected', rejection_reason: reason, updated_at: new Date().toISOString() }).eq('id', id); if (error) throw error; await logAdminAction('reject', 'place', id, { reason });
}
export async function listAuditLogs() { if (!isSupabaseConfigured) return listLocalAuditLogs(); const { data, error } = await supabase.from('admin_audit_logs').select('*').order('created_at', { ascending: false }).limit(50); if (error) throw error; return data || []; }
export async function listUserRoles() { if (!isSupabaseConfigured) return listLocalUserRoles(); const { data, error } = await supabase.from('user_roles').select('*').order('created_at', { ascending: false }); if (error) throw error; return data || []; }
export async function upsertUserRole(user_id: string, role: AdminRole) { if (!isSupabaseConfigured) return upsertLocalUserRole(user_id, role); const { error } = await supabase.from('user_roles').upsert({ user_id, role }); if (error) throw error; await logAdminAction('upsert_role', 'user_role', user_id, { role }); }

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






