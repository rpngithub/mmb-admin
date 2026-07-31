import { useEffect, useState } from 'react';
import { Typography } from 'antd';
import { imageUrl, useCdnBaseUrl } from '../lib/cdn';

const { Text } = Typography;

const IMAGE_TYPES = new Set(['icon', 'emoji', 'shape', 'bg']);
const VIDEO_TYPES = new Set(['video', 'animated']);

/**
 * Render an asset's file by asset_type: image types → <img>, video/animated →
 * <video>, audio → <audio>, font → loaded font sample, else a download link.
 * URL is `${cdn_base_url}/${s3_key}`.
 */
export default function AssetPreview({ s3Key, assetType, name, size = 120 }) {
  const base = useCdnBaseUrl();
  const url = imageUrl(base, s3Key);
  if (!url) return <Text type="secondary">No file</Text>;

  if (IMAGE_TYPES.has(assetType)) {
    return (
      <img
        src={url}
        alt={name || ''}
        loading="lazy"
        style={{
          maxWidth: size * 2,
          maxHeight: size,
          objectFit: 'contain',
          border: '1px solid #f0f0f0',
          borderRadius: 6,
          background: '#fafafa',
        }}
      />
    );
  }
  if (VIDEO_TYPES.has(assetType)) {
    return <video src={url} controls style={{ maxWidth: size * 2, maxHeight: size }} />;
  }
  if (assetType === 'audio') {
    return <audio src={url} controls />;
  }
  if (assetType === 'font') {
    return <FontPreview url={url} />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      Open file
    </a>
  );
}

function FontPreview({ url }) {
  const [family, setFamily] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!url || typeof FontFace === 'undefined') return undefined;
    const fam = `asset-font-${Math.random().toString(36).slice(2)}`;
    const face = new FontFace(fam, `url(${url})`);
    face
      .load()
      .then((loaded) => {
        if (cancelled) return;
        document.fonts.add(loaded);
        setFamily(fam);
      })
      .catch(() => {
        /* font failed to load — fall back to default family */
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div>
      <div style={{ fontFamily: family || 'inherit', fontSize: 22, lineHeight: 1.4 }}>
        The quick brown fox 1234
      </div>
      {!family && <Text type="secondary">Loading font…</Text>}
    </div>
  );
}
