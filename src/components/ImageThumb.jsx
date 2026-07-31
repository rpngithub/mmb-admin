import { Typography } from 'antd';
import { imageUrl, useCdnBaseUrl } from '../lib/cdn';

const { Text } = Typography;

/**
 * Small CDN-backed image thumbnail for table cells. Resolves cdn_base_url from
 * the public config feed and lazy-loads so off-screen rows don't fetch. Renders
 * an em-dash when there's no key/base — pass `placeholder` where a missing image
 * is a problem worth showing (e.g. a template with no thumbnail).
 */
export default function ImageThumb({ k, size = 32, alt = '', placeholder }) {
  const base = useCdnBaseUrl();
  const url = imageUrl(base, k);
  if (!url) return placeholder ?? <Text type="secondary">—</Text>;
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      style={{ width: size, height: size, objectFit: 'contain', borderRadius: 4 }}
    />
  );
}
