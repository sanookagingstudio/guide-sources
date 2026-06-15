import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { PlaceRecord } from './placesService';
import { approveLocalPlace, listLocalAuditLogs, listLocalUserRoles, logLocalAdminAction, rejectLocalPlace, upsertLocalUserRole } from './localStorageProvider';
export type AdminRole = 'admin' | 'editor' | 'viewer';
export async function getCurrentAdminRole() {
  if (!isSupabaseConfigured) return 'admin';
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', userId).in('role', ['admin','editor','viewer']).maybeSingle();
  if (error) throw error;
  return data?.role as AdminRole | null;
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
