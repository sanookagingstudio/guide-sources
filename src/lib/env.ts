const PLACEHOLDER_MARKERS = ['your-project-id', 'your_supabase', 'example', 'placeholder'];

const normalize = (value?: string) => (value || '').trim().toLowerCase();

export const isPlaceholderValue = (value?: string) => {
  const text = normalize(value);
  return text === '' || PLACEHOLDER_MARKERS.some((marker) => text.includes(marker.toLowerCase()));
};

export const env = {
  VITE_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  VITE_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
  VITE_MEDIA_UPLOAD_ENABLED: process.env.NEXT_PUBLIC_MEDIA_UPLOAD_ENABLED || process.env.VITE_MEDIA_UPLOAD_ENABLED || 'false',
};

export const hasRealSupabaseConfig = !isPlaceholderValue(env.VITE_SUPABASE_URL) && !isPlaceholderValue(env.VITE_SUPABASE_ANON_KEY) && Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);
