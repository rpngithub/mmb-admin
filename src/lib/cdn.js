import { usePublicConfigQuery } from '../features/api/adminApi';

/**
 * Build a public asset URL from the CDN base and a stored S3 key.
 *   imageUrl(cdn_base_url, icon_s3_key) → `${base}/${key}`
 * Returns null when either part is missing (nothing to render).
 */
export function imageUrl(base, key) {
  if (!base || !key) return null;
  return `${String(base).replace(/\/+$/, '')}/${String(key).replace(/^\/+/, '')}`;
}

/**
 * Resolve `cdn_base_url` from the public GET /config feed. Cached app-wide by
 * RTK Query, so calling this from multiple widgets does not refetch.
 */
export function useCdnBaseUrl() {
  const { data } = usePublicConfigQuery();
  return data?.cdn_base_url || '';
}
