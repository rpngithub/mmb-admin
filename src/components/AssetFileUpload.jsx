import { useRef, useState } from 'react';
import { Upload, Button, Progress, Space, Typography, Alert, Tag, App } from 'antd';
import { UploadOutlined, DeleteOutlined } from '@ant-design/icons';
import { adminApi } from '../features/api/adminApi';
import {
  MULTIPART_THRESHOLD,
  uploadSingle,
  uploadMultipart,
  isAbortError,
} from '../lib/assetUpload';
import AssetPreview from './AssetPreview';

const { Text } = Typography;

const fmtSize = (bytes) => {
  if (bytes == null) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

/**
 * Controlled asset-file uploader. Form value is the confirmed S3 `s3_key`.
 * Auto-picks single vs multipart by file size, shows overall (and per-part for
 * multipart) progress, retries the remaining parts on failure, and aborts the
 * multipart session on cancel. Needs `assetType` to presign into the right slot.
 */
export default function AssetFileUpload({ value, onChange, assetType, disabled }) {
  const { message } = App.useApp();
  const [presign] = adminApi.endpoints.uploadPresign.useMutation();
  const [confirm] = adminApi.endpoints.uploadConfirm.useMutation();
  const [initiate] = adminApi.endpoints.multipartInitiate.useMutation();
  const [presignParts] = adminApi.endpoints.multipartPresignParts.useMutation();
  const [complete] = adminApi.endpoints.multipartComplete.useMutation();
  const [abortMultipart] = adminApi.endpoints.multipartAbort.useMutation();

  const [status, setStatus] = useState('idle'); // idle | uploading | error
  const [pct, setPct] = useState(0);
  const [mode, setMode] = useState(null); // single | multipart
  const [partInfo, setPartInfo] = useState(null); // { current, total }
  const [error, setError] = useState(null);

  const xhrRef = useRef(null);
  const sessionRef = useRef({});
  const fileRef = useRef(null);
  const cancelRef = useRef(false);

  const resetTransient = () => {
    setStatus('idle');
    setPct(0);
    setMode(null);
    setPartInfo(null);
    setError(null);
    xhrRef.current = null;
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

    const useMultipart = file.size > MULTIPART_THRESHOLD;
    setMode(useMultipart ? 'multipart' : 'single');

    try {
      let key;
      if (useMultipart) {
        key = await uploadMultipart({
          file,
          target: { type: 'asset', asset_type: assetType },
          session: sessionRef.current,
          initiate,
          presignParts,
          complete,
          confirm,
          onProgress: (p) => setPct(Math.round(p * 100)),
          onPart: (info) => setPartInfo(info),
          registerXhr: (xhr) => {
            xhrRef.current = xhr;
          },
          shouldAbort: () => cancelRef.current,
        });
      } else {
        key = await uploadSingle({
          file,
          target: { type: 'asset', asset_type: assetType },
          presign,
          confirm,
          onProgress: (p) => setPct(Math.round(p * 100)),
          registerXhr: (xhr) => {
            xhrRef.current = xhr;
          },
        });
      }
      onChange?.(key);
      setStatus('idle');
      setPct(100);
      setPartInfo(null);
      fileRef.current = null;
      sessionRef.current = {};
      message.success('File uploaded');
    } catch (err) {
      if (isAbortError(err)) {
        resetTransient();
        return;
      }
      setError(err?.message || 'Upload failed');
      setStatus('error');
    }
  };

  const onSelect = (file) => {
    sessionRef.current = {}; // fresh multipart session for a new file
    fileRef.current = file;
    runUpload();
    return false; // prevent AntD's default upload
  };

  const cancel = async () => {
    cancelRef.current = true;
    try {
      xhrRef.current?.abort();
    } catch {
      /* ignore */
    }
    const s = sessionRef.current;
    if (mode === 'multipart' && s?.key && s?.upload_id) {
      try {
        await abortMultipart({ key: s.key, upload_id: s.upload_id }).unwrap();
      } catch {
        /* best-effort cleanup */
      }
    }
    sessionRef.current = {};
    fileRef.current = null;
    resetTransient();
  };

  // ---- uploading / error states ----
  if (status === 'uploading' || status === 'error') {
    return (
      <Space direction="vertical" style={{ width: 360 }}>
        <Progress percent={pct} status={status === 'error' ? 'exception' : 'active'} />
        <Space size={8} wrap>
          {mode && <Tag color={mode === 'multipart' ? 'purple' : 'blue'}>{mode}</Tag>}
          {fileRef.current && <Text type="secondary">{fmtSize(fileRef.current.size)}</Text>}
          {mode === 'multipart' && partInfo && (
            <Text type="secondary">
              part {partInfo.current}/{partInfo.total}
            </Text>
          )}
        </Space>
        {status === 'error' && (
          <Alert
            type="error"
            showIcon
            message={error}
            description={
              mode === 'multipart'
                ? 'Already-uploaded parts are kept — Retry resumes the rest.'
                : undefined
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

  // ---- has a file (idle, value set) ----
  if (value) {
    return (
      <Space direction="vertical" size={8}>
        <AssetPreview s3Key={value} assetType={assetType} />
        <Text type="secondary" style={{ fontSize: 11, wordBreak: 'break-all' }}>
          {value}
        </Text>
        {!disabled && (
          <Space size={4}>
            <Upload showUploadList={false} beforeUpload={onSelect} disabled={!assetType}>
              <Button size="small" icon={<UploadOutlined />} disabled={!assetType}>
                Replace
              </Button>
            </Upload>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onChange?.(undefined)}
            >
              Remove
            </Button>
          </Space>
        )}
      </Space>
    );
  }

  // ---- empty ----
  return (
    <Space direction="vertical" size={4}>
      <Upload showUploadList={false} beforeUpload={onSelect} disabled={disabled || !assetType}>
        <Button icon={<UploadOutlined />} disabled={disabled || !assetType}>
          Upload file
        </Button>
      </Upload>
      {!assetType && <Text type="secondary">Select an asset type first.</Text>}
    </Space>
  );
}
