import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  Button,
  Space,
  Typography,
  Progress,
  Alert,
  Tag,
  Select,
  Collapse,
  App,
} from 'antd';
import {
  InboxOutlined,
  UploadOutlined,
  ClearOutlined,
  CheckCircleTwoTone,
  FileZipOutlined,
} from '@ant-design/icons';
import JSZip from 'jszip';
import { adminApi } from '../features/api/adminApi';
import { MULTIPART_THRESHOLD, uploadSingle, uploadMultipart } from '../lib/assetUpload';
import ImageThumb from './ImageThumb';

const { Text, Paragraph } = Typography;

const TYPE_BY_EXT = {
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
};
const basename = (p) => p.split('/').pop();
const guessType = (name) => TYPE_BY_EXT[name.split('.').pop().toLowerCase()] || 'application/octet-stream';
const THUMB_RE = /^thumbnail\.(png|jpe?g|webp|gif|svg)$/i;
const IMAGE_RE = /\.(png|jpe?g|webp|gif|svg)$/i;
const ASSETS_DIR_RE = /(^|\/)assets\//i;
const THUMB_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';
const THUMB_MAX_MB = 5;

const EXPECTED_STRUCTURE = `template-bundle.zip
├─ template.json      ← exactly one .json file, in the ZIP root
├─ thumbnail.jpg      ← .jpg / .png / .webp — used as the card cover
└─ assets/
   ├─ background.png
   ├─ logo.svg
   └─ Inter-Bold.woff2`;

// Files are flattened to their basename under templates/<uid>/, so two entries
// sharing a basename (case-insensitive) would overwrite each other on S3.
function duplicateBasenames(list) {
  const counts = new Map();
  list.forEach((e) => {
    const k = e.name.toLowerCase();
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  return [...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name);
}

/**
 * Many exporters wrap everything in a single top-level folder. Treat that
 * folder as the ZIP root so "not in the root" warnings don't fire on it.
 */
function commonRoot(list) {
  const firsts = list.map((e) => (e.path.includes('/') ? e.path.split('/')[0] : null));
  if (firsts.some((f) => f === null)) return '';
  return new Set(firsts).size === 1 ? `${firsts[0]}/` : '';
}

/**
 * Convention checks — every one of these is a warning, never a blocker: the
 * server flattens the ZIP anyway, so layout only matters for humans.
 */
function structureWarnings(list, contentEntry) {
  const root = commonRoot(list);
  const rel = (p) => (root && p.startsWith(root) ? p.slice(root.length) : p);
  const atRoot = (p) => !rel(p).includes('/');
  const warnings = [];

  if (!atRoot(contentEntry.path)) {
    warnings.push(
      `The template document "${contentEntry.name}" is not in the ZIP root (found at ${contentEntry.path}). It still uploads, but the convention is one .json at the root.`,
    );
  }

  const rootThumb = list.find((e) => THUMB_RE.test(e.name) && atRoot(e.path));
  const images = list.filter((e) => IMAGE_RE.test(e.name));
  if (images.length === 0) {
    warnings.push(
      'This ZIP contains no image — the template cannot be published without a thumbnail. Add thumbnail.jpg (or .png / .webp) to the ZIP root.',
    );
  } else if (!rootThumb) {
    warnings.push(
      'No thumbnail.jpg / .png / .webp in the ZIP root — pick which image to use as the thumbnail below.',
    );
  }

  const stray = list.filter(
    (e) =>
      e.path !== contentEntry.path &&
      e.path !== rootThumb?.path &&
      !ASSETS_DIR_RE.test(e.path),
  );
  if (stray.length) {
    const shown = stray.slice(0, 4).map((e) => e.name).join(', ');
    warnings.push(
      `${stray.length} file${stray.length > 1 ? 's are' : ' is'} outside the assets/ folder (${shown}${
        stray.length > 4 ? ', …' : ''
      }). They upload fine, but assets belong under assets/.`,
    );
  }

  return warnings;
}

function StructureGuide() {
  return (
    <Collapse
      ghost
      size="small"
      defaultActiveKey={['guide']}
      items={[
        {
          key: 'guide',
          label: <Text strong>Expected ZIP structure</Text>,
          children: (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  background: '#fafafa',
                  border: '1px solid #f0f0f0',
                  borderRadius: 6,
                  fontSize: 12,
                  lineHeight: 1.7,
                  overflowX: 'auto',
                }}
              >
                {EXPECTED_STRUCTURE}
              </pre>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Every file is stored flat under <Text code>templates/&lt;uid&gt;/</Text>, so folders are
                a convention only — but <Text strong>every filename must be unique</Text> across the
                whole ZIP, otherwise files overwrite each other.
              </Text>
            </Space>
          ),
        },
      ]}
    />
  );
}

/**
 * Replace only the thumbnail, without re-uploading the whole ZIP. The image is
 * PUT to templates/<uid>/<name> via the same template_file presign target, then
 * bundle/confirm is called with only `thumbnail_filename` (content omitted, so
 * the saved template document is left untouched).
 */
function ThumbnailReplace({ uid, onDone }) {
  const { message } = App.useApp();
  const [presign] = adminApi.endpoints.uploadPresign.useMutation();
  const [bundleConfirm] = adminApi.endpoints.templateBundleConfirm.useMutation();
  const [busy, setBusy] = useState(false);

  const beforeUpload = (file) => {
    if (!THUMB_ACCEPT.split(',').includes(file.type)) {
      message.error('Please choose a PNG, JPG, WebP or SVG image.');
      return Upload.LIST_IGNORE;
    }
    if (file.size / 1024 / 1024 > THUMB_MAX_MB) {
      message.error(`Image must be smaller than ${THUMB_MAX_MB} MB.`);
      return Upload.LIST_IGNORE;
    }
    return true;
  };

  const customRequest = async ({ file, onSuccess, onError }) => {
    setBusy(true);
    try {
      const { upload_url, required_headers } = await presign({
        target: { type: 'template_file', template_uid: uid },
        filename: file.name,
        content_type: file.type,
      }).unwrap();
      const res = await fetch(upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type, ...(required_headers || {}) },
        body: file,
      });
      if (!res.ok) throw new Error(`S3 upload failed (${res.status})`);
      await bundleConfirm({ uid, thumbnail_filename: file.name }).unwrap();
      onSuccess?.({}, file);
      message.success('Thumbnail updated');
      onDone?.();
    } catch (err) {
      onError?.(err);
      // The confirm endpoint is `silent`, so we own the messaging. Surface the
      // field-level details[] too — a "content required" here means the
      // content-optional bundle/confirm change isn't deployed to this env yet.
      const details = Array.isArray(err?.details) ? err.details : [];
      const detailText = details
        .map((d) => `${d.field ? `${d.field}: ` : ''}${d.message}`)
        .join('; ');
      message.error(
        [err?.message || 'Could not update the thumbnail.', detailText].filter(Boolean).join(' — '),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Upload
      accept={THUMB_ACCEPT}
      showUploadList={false}
      beforeUpload={beforeUpload}
      customRequest={customRequest}
      disabled={busy}
    >
      <Button size="small" loading={busy}>
        Replace thumbnail only
      </Button>
    </Upload>
  );
}

/**
 * Bundle ingest: unzip the designer ZIP in the browser, upload each file direct
 * to S3 under templates/<uid>/ (single or multipart by size, NO per-file
 * confirm), then POST bundle/confirm with the parsed content JSON + the chosen
 * thumbnail filename — which flips all the objects pending→active server-side.
 *
 * The thumbnail is admin-chosen from any image in the ZIP; `thumbnail.*` at the
 * root is only the default. The ZIP filename itself is never sent to the server
 * (only its extracted files are), so the post-upload summary is session-local.
 */
export default function TemplateBundlePanel({ uid, thumbnailKey, hasContent, onConfirmed }) {
  const { message, modal } = App.useApp();
  const [presign] = adminApi.endpoints.uploadPresign.useMutation();
  const [initiate] = adminApi.endpoints.multipartInitiate.useMutation();
  const [presignParts] = adminApi.endpoints.multipartPresignParts.useMutation();
  const [complete] = adminApi.endpoints.multipartComplete.useMutation();
  const [bundleConfirm] = adminApi.endpoints.templateBundleConfirm.useMutation();
  const [bundleReset] = adminApi.endpoints.templateBundleReset.useMutation();

  const [zip, setZip] = useState(null);
  const [zipName, setZipName] = useState(null);
  const [entries, setEntries] = useState([]); // [{ path, name }]
  const [contentPath, setContentPath] = useState(undefined);
  const [thumbPath, setThumbPath] = useState(undefined);
  const [thumbPreview, setThumbPreview] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [lastUpload, setLastUpload] = useState(null); // session-local receipt
  const [phase, setPhase] = useState('idle'); // idle|ready|uploading|error
  const [progress, setProgress] = useState({ pct: 0, current: null });
  const [error, setError] = useState(null);

  const xhrRef = useRef(null);
  const cancelRef = useRef(false);

  const resetSelection = (errMsg = null) => {
    setZip(null);
    setZipName(null);
    setEntries([]);
    setContentPath(undefined);
    setThumbPath(undefined);
    setWarnings([]);
    setPhase('idle');
    setProgress({ pct: 0, current: null });
    setError(errMsg);
  };

  const clearSelection = () => resetSelection(null);

  // Local preview of the chosen thumbnail, straight out of the ZIP.
  useEffect(() => {
    if (!zip || !thumbPath) {
      setThumbPreview(null);
      return undefined;
    }
    const entry = zip.file(thumbPath);
    if (!entry) {
      setThumbPreview(null);
      return undefined;
    }
    let url = null;
    let cancelled = false;
    entry
      .async('blob')
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setThumbPreview(url);
      })
      .catch(() => {
        /* preview is best-effort */
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [zip, thumbPath]);

  const imageOptions = useMemo(
    () =>
      entries
        .filter((e) => IMAGE_RE.test(e.name))
        .map((e) => ({ label: e.path, value: e.path })),
    [entries],
  );

  const onZip = async (file) => {
    setError(null);
    try {
      const loaded = await JSZip.loadAsync(file);
      const list = [];
      loaded.forEach((path, entry) => {
        if (!entry.dir) list.push({ path, name: basename(path) });
      });
      if (!list.length) return resetSelection('The ZIP is empty.');

      // Expect exactly one JSON — that single file is the template document.
      const jsons = list.filter((e) => e.name.toLowerCase().endsWith('.json'));
      if (jsons.length === 0) {
        return resetSelection('No .json file found — the template document is required.');
      }
      if (jsons.length > 1) {
        return resetSelection(
          `Expected exactly one .json (the template document) but found ${jsons.length}: ${jsons
            .map((j) => j.name)
            .join(', ')}.`,
        );
      }

      // No two files may flatten to the same name under templates/<uid>/.
      const dupes = duplicateBasenames(list);
      if (dupes.length) {
        return resetSelection(
          `Duplicate file name(s) in the ZIP: ${dupes.join(
            ', ',
          )}. Every file must have a unique name (they are stored flat under templates/<uid>/).`,
        );
      }

      // Default the thumbnail to a conventional thumbnail.* , else the first image.
      const images = list.filter((e) => IMAGE_RE.test(e.name));
      const thumb = images.find((e) => THUMB_RE.test(e.name)) || images[0];

      setZip(loaded);
      setZipName(file.name);
      setEntries(list);
      setContentPath(jsons[0].path); // the lone JSON is the content doc
      setThumbPath(thumb?.path);
      setWarnings(structureWarnings(list, jsons[0]));
      setLastUpload(null);
      setPhase('ready');
      return false;
    } catch (err) {
      resetSelection(err?.message || 'Could not read the ZIP.');
    }
    return false; // never let AntD upload the zip itself
  };

  const startUpload = async () => {
    if (!contentPath) {
      message.error('No template document detected — re-select the ZIP.');
      return;
    }
    cancelRef.current = false;
    setPhase('uploading');
    setError(null);
    const total = entries.length;
    const receipt = {
      zipName,
      fileCount: total,
      contentName: basename(contentPath),
      thumbName: thumbPath ? basename(thumbPath) : null,
      at: new Date(),
    };

    try {
      for (let i = 0; i < total; i += 1) {
        if (cancelRef.current) throw new DOMException('Cancelled', 'AbortError');
        const e = entries[i];
        const blob = await zip.file(e.path).async('blob');
        const f = new File([blob], e.name, { type: guessType(e.name) });
        setProgress({ pct: Math.round((i / total) * 100), current: `${e.name} (${i + 1}/${total})` });

        const target = { type: 'template_file', template_uid: uid };
        const onProgress = (p) =>
          setProgress((pr) => ({ ...pr, pct: Math.round(((i + p) / total) * 100) }));
        const registerXhr = (x) => {
          xhrRef.current = x;
        };

        if (f.size > MULTIPART_THRESHOLD) {
          await uploadMultipart({
            file: f,
            target,
            session: {},
            initiate,
            presignParts,
            complete,
            onProgress,
            registerXhr,
          });
        } else {
          await uploadSingle({ file: f, target, presign, onProgress, registerXhr });
        }
      }

      // all files uploaded → read + validate content JSON, then confirm
      const contentStr = await zip.file(contentPath).async('string');
      try {
        JSON.parse(contentStr);
      } catch {
        throw new Error('The selected content file is not valid JSON.');
      }
      await bundleConfirm({
        uid,
        content: contentStr,
        thumbnail_filename: thumbPath ? basename(thumbPath) : undefined,
      }).unwrap();

      setProgress({ pct: 100, current: null });
      // Keep a visible receipt instead of dropping back to an empty dropzone.
      clearSelection();
      setLastUpload(receipt);
      message.success('Bundle uploaded and confirmed');
      onConfirmed?.();
    } catch (err) {
      if (err?.name === 'AbortError') {
        setPhase('ready');
        return;
      }
      setError(err?.message || 'Bundle upload failed.');
      setPhase('error');
    }
  };

  const cancel = () => {
    cancelRef.current = true;
    try {
      xhrRef.current?.abort();
    } catch {
      /* ignore */
    }
  };

  const onReset = () => {
    modal.confirm({
      title: 'Reset bundle?',
      content: `This wipes every file under templates/${uid}/ so you can re-upload cleanly.`,
      okText: 'Reset',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await bundleReset(uid).unwrap();
          clearSelection();
          setLastUpload(null);
          message.success('Bundle reset');
          onConfirmed?.();
        } catch {
          // error notification handled by baseQuery
        }
      },
    });
  };

  const uploading = phase === 'uploading';
  const selecting = phase === 'ready' || phase === 'error';
  const assetCount = entries.filter((e) => ASSETS_DIR_RE.test(e.path)).length;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Space size={16} wrap>
        <Tag color={hasContent ? 'green' : 'default'}>
          {hasContent ? 'Content saved' : 'No content yet'}
        </Tag>
        <Tag color={thumbnailKey ? 'green' : 'warning'}>
          {thumbnailKey ? 'Thumbnail set' : 'No thumbnail'}
        </Tag>
        {thumbnailKey && (
          <Space>
            <Text type="secondary">Current thumbnail:</Text>
            <ImageThumb k={thumbnailKey} size={40} />
          </Space>
        )}
        {!uploading && <ThumbnailReplace uid={uid} onDone={onConfirmed} />}
        <Button size="small" icon={<ClearOutlined />} danger onClick={onReset} disabled={uploading}>
          Reset bundle
        </Button>
      </Space>

      <StructureGuide />

      <Paragraph type="secondary" style={{ margin: 0 }}>
        Upload the designer ZIP. It is unzipped in your browser; each file is sent straight to S3 and
        then confirmed together with the parsed content JSON.
      </Paragraph>

      {phase === 'idle' && lastUpload && (
        <Alert
          type="success"
          showIcon
          icon={<FileZipOutlined />}
          message={
            <Space size={8} wrap>
              <Text strong>{lastUpload.zipName || 'Bundle'}</Text>
              <Text type="secondary">uploaded &amp; confirmed</Text>
            </Space>
          }
          description={
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Text>
                {lastUpload.fileCount} file{lastUpload.fileCount > 1 ? 's' : ''} · content:{' '}
                <Text code>{lastUpload.contentName}</Text>
                {lastUpload.thumbName ? (
                  <>
                    {' '}
                    · thumbnail: <Text code>{lastUpload.thumbName}</Text>
                  </>
                ) : (
                  <Text type="warning"> · no thumbnail chosen</Text>
                )}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {lastUpload.at.toLocaleString()}
              </Text>
              <Button size="small" style={{ marginTop: 4 }} onClick={() => setLastUpload(null)}>
                Upload a different ZIP
              </Button>
            </Space>
          }
        />
      )}

      {phase === 'idle' && !lastUpload && hasContent && (
        <Alert
          type="info"
          showIcon
          message="This template already has a bundle on file"
          description={
            <Text type="secondary">
              The content JSON is saved
              {thumbnailKey ? ' and a thumbnail is set' : ' but no thumbnail is set'}. The original ZIP
              filename is not stored on the server, so it can&apos;t be shown here. Uploading again
              replaces the content.
            </Text>
          }
        />
      )}

      {phase === 'idle' && !lastUpload && (
        <Upload.Dragger accept=".zip" showUploadList={false} beforeUpload={onZip}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">Click or drag the template ZIP here</p>
        </Upload.Dragger>
      )}

      {selecting && entries.length > 0 && (
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <Text>
            <FileZipOutlined /> <Text strong>{zipName}</Text> &mdash; {entries.length} file
            {entries.length > 1 ? 's' : ''}
            {assetCount > 0 && <Text type="secondary"> · {assetCount} under assets/</Text>}
          </Text>

          {contentPath ? (
            <Space size={6}>
              <CheckCircleTwoTone twoToneColor="#52c41a" />
              <Text>
                Content: <Text code>{basename(contentPath)}</Text>
              </Text>
            </Space>
          ) : (
            <Alert
              type="warning"
              showIcon
              message="No template.json found in the ZIP — the bundle can't be confirmed without it."
            />
          )}

          <div>
            <Text type="secondary">Thumbnail</Text>
            <Space align="start" style={{ width: '100%', marginTop: 4 }} size={12}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  flex: '0 0 auto',
                  border: '1px dashed #d9d9d9',
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#fafafa',
                  overflow: 'hidden',
                }}
              >
                {thumbPreview ? (
                  <img
                    src={thumbPreview}
                    alt="thumbnail preview"
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    none
                  </Text>
                )}
              </div>
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                style={{ flex: 1, minWidth: 260 }}
                value={thumbPath}
                onChange={(v) => setThumbPath(v)}
                options={imageOptions}
                placeholder={
                  imageOptions.length ? 'Pick the thumbnail image' : 'No image in this ZIP'
                }
                disabled={imageOptions.length === 0}
              />
            </Space>
          </div>

          {warnings.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message="This ZIP doesn't follow the expected structure"
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              }
            />
          )}

          <Space style={{ marginTop: 4 }}>
            <Button
              type="primary"
              icon={<UploadOutlined />}
              disabled={!contentPath}
              onClick={startUpload}
            >
              Upload &amp; confirm
            </Button>
            <Button onClick={clearSelection}>Choose a different ZIP</Button>
          </Space>
        </Space>
      )}

      {uploading && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Progress percent={progress.pct} status="active" />
          {progress.current && <Text type="secondary">Uploading {progress.current}</Text>}
          <Button danger onClick={cancel}>
            Cancel
          </Button>
        </Space>
      )}

      {error && <Alert type="error" showIcon message={error} />}
    </Space>
  );
}
