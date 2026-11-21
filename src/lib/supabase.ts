import { createClient } from '@supabase/supabase-js';
import { env, hasRealSupabaseConfig } from './env';

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = hasRealSupabaseConfig;

export const supabase = createClient(
  isSupabaseConfigured ? supabaseUrl : 'https://placeholder.supabase.co',
  isSupabaseConfigured ? supabaseAnonKey : 'placeholder-anon-key',
  { auth: { persistSession: typeof window !== 'undefined' } },
);

// The guide-sources tables live in the `tourism_gs` schema of the Club project
// (DEC-014): there is NO `public.production_places`, so a plain
// `supabase.from('production_places')` asked PostgREST for a table that does not
// exist and the public search answered nothing (found 2026-11-22 by Track F's
// pattern audit). PostgREST exposes `tourism_gs`, so the read must select that
// schema explicitly (`Accept-Profile: tourism_gs`). Keep the name overridable so
// a preview/staging schema can be pointed at without a code change.
export const TOURISM_SCHEMA = (() => {
  const candidate = String(process.env.NEXT_PUBLIC_FUNAGING_TOURISM_SCHEMA || '').trim();
  return /^[a-z_][a-z0-9_]*$/i.test(candidate) ? candidate : 'tourism_gs';
})();

export const tourismFrom = (table: string) => supabase.schema(TOURISM_SCHEMA).from(table);
