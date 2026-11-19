import { createClient } from '@supabase/supabase-js';

const PLACEHOLDER_MARKERS = ['your-project-id', 'your_supabase', 'example', 'placeholder'];

function isPlaceholder(value?: string) {
  const text = (value || '').trim().toLowerCase();
  return text === '' || PLACEHOLDER_MARKERS.some((marker) => text.includes(marker));
}

export const tourismGsEnv = {
  url:
    process.env.NEXT_PUBLIC_FUNAGING_CORE_SUPABASE_URL ||
    process.env.FUNAGING_CORE_SUPABASE_URL ||
    '',
  anonKey:
    process.env.NEXT_PUBLIC_FUNAGING_CORE_SUPABASE_ANON_KEY ||
    process.env.FUNAGING_CORE_SUPABASE_ANON_KEY ||
    '',
  schema: process.env.NEXT_PUBLIC_FUNAGING_TOURISM_SCHEMA || process.env.FUNAGING_TOURISM_SCHEMA || 'tourism_gs',
};

export const hasTourismGsConfig =
  !isPlaceholder(tourismGsEnv.url) && !isPlaceholder(tourismGsEnv.anonKey) && Boolean(tourismGsEnv.url && tourismGsEnv.anonKey);

let cached: any = null;

export function getTourismGsBrowserClient(): any {
  if (!hasTourismGsConfig) return null;
  if (!cached) {
    cached = createClient(tourismGsEnv.url, tourismGsEnv.anonKey, {
      db: { schema: tourismGsEnv.schema },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
