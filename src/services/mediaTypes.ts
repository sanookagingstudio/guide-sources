export type PlaceMedia = {
  id?: string;
  place_id: string | null;
  staging_place_id?: string | null;
  media_type: 'image' | 'video';
  storage_bucket: string;
  storage_path: string;
  public_url?: string | null;
  caption?: string | null;
  created_at?: string;
};
