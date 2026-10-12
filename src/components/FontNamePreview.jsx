import { useEffect, useRef, useState } from 'react';
import { Typography, Tag, Tooltip } from 'antd';
import { useCdnBaseUrl } from '../lib/cdn';
import { loadFontPreview } from '../lib/fontPreview';

const { Text } = Typography;

/**
 * A font's `family` drawn in its own typeface, from its name-preview WOFF2.
 *
 * The preview is only fetched once the row scrolls into view (the fonts table is
 * unpaginated). The file holds just the letters of `family`, so exactly that
 * string is rendered — nothing else. No key → UI font plus a "No preview" tag;
 * a key that fails to load (usually the bucket's CORS rule) → UI font, silently.
 */
export default function FontNamePreview({ font, showMissingTag = true }) {
  const cdnBase = useCdnBaseUrl();
  const key = font?.preview_s3_key || null;
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState({ key: null, name: null });

  useEffect(() => {
    if (!key || visible) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [key, visible]);

  useEffect(() => {
    if (!key || !visible || !cdnBase) return undefined;
    let alive = true;
    loadFontPreview(cdnBase, key).then((name) => {
      if (alive) setLoaded({ key, name });
    });
    return () => {
      alive = false;
    };
  }, [key, visible, cdnBase]);

  // Ignore a face loaded for a previous key (rename / new files).
  const faceName = loaded.key === key ? loaded.name : null;

  return (
    <span ref={ref} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Text
        strong={!faceName}
        style={faceName ? { fontFamily: `'${faceName}', sans-serif`, fontSize: 18 } : undefined}
      >
        {font?.family}
      </Text>
      {!key && showMissingTag && (
        <Tooltip title="No name preview yet — run Build missing previews to see why.">
          <Tag style={{ marginInlineEnd: 0 }}>No preview</Tag>
        </Tooltip>
      )}
    </span>
  );
}
