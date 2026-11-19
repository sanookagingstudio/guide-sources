import { createClient } from '@supabase/supabase-js';
import { serverEnv } from './serverEnv';

/** V7: GS AUTH/RBAC/STORAGE authority on Club plane A. Knowledge remains tourism_gs. */
export function gsClubUrl() {
  return serverEnv.FUNAGING_CORE_SUPABASE_URL || serverEnv.SUPABASE_URL;
}
export function gsClubServiceKey() {
  return serverEnv.FUNAGING_CORE_SUPABASE_SERVICE_ROLE_KEY || serverEnv.SUPABASE_SERVICE_ROLE_KEY;
}
export function gsClubAnonKey() {
  return serverEnv.FUNAGING_CORE_SUPABASE_ANON_KEY || serverEnv.SUPABASE_ANON_KEY;
}
export function gsRbacClient() {
  return createClient(gsClubUrl(), gsClubServiceKey(), {
    db: { schema: 'tourism_gs' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function gsAuthClient() {
  return createClient(gsClubUrl(), gsClubAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function mapGsUserIdToClub(gsUserId: string, map: Record<string, string>) {
  return map[gsUserId] || gsUserId;
}
