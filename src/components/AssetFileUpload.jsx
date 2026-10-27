import { useRef, useState } from 'react';
import { Upload, Button, Progress, Space, Typography, Alert, Tag, App } from 'antd';
import { UploadOutlined, DeleteOutlined } from '@ant-design/icons';
import { adminApi } from '../features/api/adminApi';
import {
  MULTIPART_THRESHOLD,
  acceptFor,
  checkFile,
  fmtBytes,
  isAbortError,
  kindForTarget,
  probeMedia,
  uploadErrorText,
  uploadFile,
} from '../lib/assetUpload';
import AssetPreview from './AssetPreview';

const { Text } = Typography;

const VIDEO_HINT =
  'MP4, WebM or MOV. Use H.264 MP4 for best compatibility — iPhone HEVC (H.265) uploads fine but plays black in Chrome on most Windows PCs.';

/**
 * Controlled asset-file uploader. Form value is the confirmed S3 `s3_key`.
 * Validates the pick against the target's type and the server's `limits`,
 * auto-picks single vs multipart by file size, shows overall (and per-part for
 * multipart) progress, retries the remaining parts on failure, and aborts the
 * multipart session on cancel. Needs `assetType` to presign into the right slot.
 *
 * `onFileInfo(info)` reports what the browser could read from the picked file
 * — `{ bytes, content_type, width, height, duration_ms, decodable, frame }`
 * (frame: a JPEG Blob of a still, videos only) — once its upload is confirmed,
 * and `null` when the file is removed. The server cannot decode media, so this
 * is the only source of the asset's dimensions and duration.
 */
export default function AssetFileUpload({ value, onChange, assetType, disabled, onFileInfo }) {
  const { message } = App.useApp();
  const [presign] = adminApi.endpoints.uploadPresign.useMutation();
  const [confirm] = adminApi.endpoints.uploadConfirm.useMutation();
  const [initiate] = adminApi.endpoints.multipartInitiate.useMutation();
  const [presignParts] = adminApi.endpoints.multipartPresignParts.useMutation();
  const [complete] = adminApi.endpoints.multipartComplete.useMutation();
  const [abortMultipart] = adminApi.endpoints.multipartAbort.useMutation();
  const { data: limits } = adminApi.endpoints.uploadLimits.useQuery();

  const [status, setStatus] = useState('idle'); // idle | uploading | error
  const [pct, setPct] = useState(0);
  const [mode, setMode] = useState(null); // single | multipart
  const [partInfo, setPartInfo] = useState(null); // { current, total }
  const [error, setError] = useState(null);
  const [undecodable, setUndecodable] = useState(false);

  const xhrsRef = useRef(new Set());
  const sessionRef = useRef({});
  const fileRef = useRef(null);
  const probeRef = useRef(null); // Promise of probeMedia() for fileRef.current
  const cancelRef = useRef(false);

  const target = { type: 'asset', asset_type: assetType };
  const kind = kindForTarget(target);

  const resetTransient = () => {
    setStatus('idle');
    setPct(0);
    setMode(null);
    setPartInfo(null);
    setError(null);
    xhrsRef.current.clear();
    cancelRef.current = false;
  };

  const runUpload = async () => {
    const file = fileRef.current;
    if (!file) return;
    if (!assetType) {
      message.error('Choose an asset type before uploading.');
      return;
    }
    cancelRef.current = false;
    setStatus('uploading');
    setError(null);
    setPct(0);
    setMode(file.size > MULTIPART_THRESHOLD ? 'multipart' : 'single');

    try {
      const key = await uploadFile({
        file,
        target,
        session: sessionRef.current,
        presign,
        confirm,
        initiate,
        presignParts,
        complete,
        onProgress: (p) => setPct(Math.round(p * 100)),
        onPart: (info) => setPartInfo(info),
        registerXhr: (xhr) => {
          xhrsRef.current.add(xhr);
        },
        shouldAbort: () => cancelRef.current,
      });
      const info = await probeRef.current;
      onChange?.(key);
      onFileInfo?.(info || null);
      setStatus('idle');
      setPct(100);
      setPartInfo(null);
      xhrsRef.current.clear();
      fileRef.current = null;
      sessionRef.current = {};
      message.success('File uploaded');
    } catch (err) {
      if (isAbortError(err)) {
        resetTransient();
        return;
      }
      setError(uploadErrorText(err));
      setStatus('error');
    }
  };

  const onSelect = (file) => {
    const problem = checkFile(file, kind, limits);
    if (problem) {
      message.error(problem);
      return Upload.LIST_IGNORE;
    }
    sessionRef.current = {}; // fresh multipart session for a new file
    fileRef.current = file;
    setUndecodable(false);
    // Read dimensions / duration / a still frame while the bytes go up.
    probeRef.current = probeMedia(file, kind).then((info) => {
      if (kind === 'video' && info.decodable === false) setUndecodable(true);
      return info;
    });
    runUpload();
    return false; // prevent AntD's default upload
  };

  const cancel = async () => {
    cancelRef.current = true;
    xhrsRef.current.forEach((xhr) => {
      try {
        xhr.abort();
      } catch {
        /* ignore */
      }
    });
    // An unaborted multipart upload's parts are billed until the bucket sweeps them.
    const s = sessionRef.current;
    if (s?.key && s?.upload_id) {
      try {
        await abortMultipart({ key: s.key, upload_id: s.upload_id }).unwrap();
      } catch {
        /* best-effort cleanup */
      }
    }
    sessionRef.current = {};
    fileRef.current = null;
    setUndecodable(false);
    resetTransient();
  };

  const undecodableAlert = undecodable && (
    <Alert
      type="warning"
      showIcon
      message="This browser cannot play this video"
      description="It will upload, but viewers on the same kind of device will see a black frame and no preview could be taken from it. It is most likely HEVC (H.265) — re-export as H.264 MP4 before saving."
    />
  );

  const hint = kind === 'video' && (
    <Text type="secondary" style={{ fontSize: 12 }}>
      {VIDEO_HINT}
      {limits?.video?.max_bytes ? ` Up to ${fmtBytes(limits.video.max_bytes)}.` : ''}
    </Text>
  );

  // ---- uploading / error states ----
  if (status === 'uploading' || status === 'error') {
    const resumable = mode === 'multipart' && sessionRef.current?.upload_id;
    return (
      <Space direction="vertical" style={{ width: 360 }}>
        <Progress percent={pct} status={status === 'error' ? 'exception' : 'active'} />
        <Space size={8} wrap>
          {mode && <Tag color={mode === 'multipart' ? 'purple' : 'blue'}>{mode}</Tag>}
          {fileRef.current && <Text type="secondary">{fmtBytes(fileRef.current.size)}</Text>}
          {mode === 'multipart' && partInfo && (
            <Text type="secondary">
              part {partInfo.current}/{partInfo.total}
            </Text>
          )}
        </Space>
        {undecodableAlert}
        {status === 'error' && (
          <Alert
            type="error"
            showIcon
            message={error}
            description={
              resumable
                ? 'Already-uploaded parts are kept — Retry resumes the rest.'
                : 'Nothing was saved. Retry uploads the file again from the start.'
            }
          />
        )}
        <Space>
          {status === 'error' && (
            <Button type="primary" onClick={runUpload}>
              Retry
            </Button>
          )}
          <Button danger onClick={cancel}>
            Cancel
          </Button>
        </Space>
      </Space>
    );
  }

  const picker = (label, size) => (
    <Upload
      accept={acceptFor(kind)}
      showUploadList={false}
      beforeUpload={onSelect}
      disabled={disabled || !assetType}
    >
      <Button size={size} icon={<UploadOutlined />} disabled={disabled || !assetType}>
        {label}
      </Button>
    </Upload>
  );

  // ---- has a file (idle, value set) ----
  if (value) {
    return (
      <Space direction="vertical" size={8}>
        <AssetPreview s3Key={value} assetType={assetType} />
        <Text type="secondary" style={{ fontSize: 11, wordBreak: 'break-all' }}>
          {value}
        </Text>
        {undecodableAlert}
        {!disabled && (
          <Space size={4}>
            {picker('Replace', 'small')}
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => {
                setUndecodable(false);
                onChange?.(undefined);
                onFileInfo?.(null);
              }}
            >
              Remove
            </Button>
          </Space>
        )}
        {!disabled && hint}
      </Space>
    );
  }

  // ---- empty ----
  return (
    <Space direction="vertical" size={4}>
      {picker('Upload file')}
      {!assetType && <Text type="secondary">Select an asset type first.</Text>}
      {hint}
    </Space>
  );
}
