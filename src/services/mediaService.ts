import { MEDIA_UPLOAD_ENABLED } from '@/lib/constants';
import { hasRealSupabaseConfig, isPlaceholderValue } from '@/lib/env';
import { supabase } from '@/lib/supabase';

export type PlaceMedia = { id?: string; place_id: string; staging_place_id?: string | null; media_type: 'image' | 'video'; storage_bucket: string; storage_path: string; public_url?: string | null; caption?: string | null; created_at?: string };

const mediaDisabled = () => !hasRealSupabaseConfig || !MEDIA_UPLOAD_ENABLED || isPlaceholderValue(process.env.NEXT_PUBLIC_SUPABASE_URL) || isPlaceholderValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) || isPlaceholderValue(process.env.VITE_SUPABASE_URL) || isPlaceholderValue(process.env.VITE_SUPABASE_ANON_KEY);

export async function listPlaceMedia(placeId: string) {
  if (mediaDisabled()) return [];
  const { data, error } = await supabase.from('place_media').select('*').or(`place_id.eq.${placeId},staging_place_id.eq.${placeId}`).order('created_at');
  if (error) throw error;
  return (data || []) as PlaceMedia[];
}

export async function uploadPlaceMedia(placeId: string, file: File, mediaType: 'image' | 'video', staging = true) {
  if (!MEDIA_UPLOAD_ENABLED || mediaDisabled()) throw new Error('Media upload is not enabled yet.');
  const ext = file.name.split('.').pop() || 'bin';
  const path = `${placeId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from('place-media').upload(path, file, { upsert: false, contentType: file.type });
  if (uploadError) throw uploadError;
  const { data: publicData } = supabase.storage.from('place-media').getPublicUrl(path);
  const row = { place_id: staging ? null : placeId, staging_place_id: staging ? placeId : null, media_type: mediaType, storage_bucket: 'place-media', storage_path: path, public_url: publicData.publicUrl };
  const { data, error } = await supabase.from('place_media').insert(row).select().single();
  if (error) throw error;
  return data as PlaceMedia;
}
