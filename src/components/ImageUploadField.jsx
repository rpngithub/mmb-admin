import { useState } from 'react';
import { Upload, Button, Space, Spin, App } from 'antd';
import { PlusOutlined, DeleteOutlined, LoadingOutlined } from '@ant-design/icons';
import {
  useUploadPresignMutation,
  useUploadConfirmMutation,
} from '../features/api/adminApi';
import { imageUrl, useCdnBaseUrl } from '../lib/cdn';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';
const MAX_MB = 5;

/**
 * Controlled image upload bound to a Form.Item. Its form value is the confirmed
 * S3 `key` (string) or undefined. Upload runs the 3-step direct-to-S3 flow:
 *
 *   1. POST /admin/uploads/presign  → { key, upload_url, required_headers }
 *   2. PUT upload_url (bytes go browser→S3 directly; native fetch, no auth)
 *   3. POST /admin/uploads/confirm  → flips pending→active
 *
 * The resolved `key` is then stored via onChange; the caller persists it onto
 * the category. Preview is rendered from `${cdn_base_url}/${key}`.
 */
export default function ImageUploadField({ value, onChange, slot, disabled }) {
  const { message } = App.useApp();
  const cdnBase = useCdnBaseUrl();
  const [presign] = useUploadPresignMutation();
  const [confirm] = useUploadConfirmMutation();
  const [uploading, setUploading] = useState(false);

  const beforeUpload = (file) => {
    const okType = file.type && ACCEPT.split(',').includes(file.type);
    if (!okType) {
      message.error('Please choose a PNG, JPG, WebP or SVG image.');
      return Upload.LIST_IGNORE;
    }
    if (file.size / 1024 / 1024 > MAX_MB) {
      message.error(`Image must be smaller than ${MAX_MB} MB.`);
      return Upload.LIST_IGNORE;
    }
    return true;
  };

  const doUpload = async (file) => {
    // 1. presign
    const { key, upload_url, required_headers } = await presign({
      target: { type: 'image_slot', slot },
      filename: file.name,
      content_type: file.type,
    }).unwrap();

    // 2. PUT bytes straight to S3 (no Authorization header — presigned URL).
    const res = await fetch(upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type, ...(required_headers || {}) },
      body: file,
    });
    if (!res.ok) throw new Error(`S3 upload failed (${res.status})`);

    // 3. confirm: pending → active
    await confirm([key]).unwrap();
    return key;
  };

  const customRequest = async ({ file, onSuccess, onError }) => {
    setUploading(true);
    try {
      const key = await doUpload(file);
      onChange?.(key);
      onSuccess?.({}, file);
      message.success('Image uploaded');
    } catch (err) {
      onError?.(err);
      message.error(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const previewUrl = imageUrl(cdnBase, value);

  if (value) {
    return (
      <Space direction="vertical" size={8}>
        <div
          style={{
            width: 96,
            height: 96,
            border: '1px solid #f0f0f0',
            borderRadius: 8,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#fafafa',
          }}
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="preview"
              loading="lazy"
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          ) : (
            <span style={{ fontSize: 11, color: '#999', padding: 4, wordBreak: 'break-all' }}>
              {value}
            </span>
          )}
        </div>
        {!disabled && (
          <Space size={4}>
            <Upload
              accept={ACCEPT}
              showUploadList={false}
              beforeUpload={beforeUpload}
              customRequest={customRequest}
              disabled={uploading}
            >
              <Button size="small" loading={uploading}>
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

  return (
    <Upload
      accept={ACCEPT}
      listType="picture-card"
      showUploadList={false}
      beforeUpload={beforeUpload}
      customRequest={customRequest}
      disabled={disabled || uploading}
    >
      <div>
        {uploading ? <Spin indicator={<LoadingOutlined />} /> : <PlusOutlined />}
        <div style={{ marginTop: 8 }}>Upload</div>
      </div>
    </Upload>
  );
}
