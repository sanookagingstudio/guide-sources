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
