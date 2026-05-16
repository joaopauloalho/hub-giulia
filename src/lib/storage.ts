import { supabase } from './supabase';

const SIGNED_URL_TTL_SECONDS = 60 * 30;

export function storagePathFromValue(value: string | null | undefined, bucket: string) {
  if (!value) return '';
  if (!value.startsWith('http')) return value;

  try {
    const url = new URL(value);
    const [, path = ''] = url.pathname.split(`/${bucket}/`);
    return decodeURIComponent(path);
  } catch {
    return '';
  }
}

export async function createSignedStorageUrl(bucket: string, storedValue: string | null | undefined) {
  const path = storagePathFromValue(storedValue, bucket);
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error) throw error;
  return data.signedUrl;
}
