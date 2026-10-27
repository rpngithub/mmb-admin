import { useState } from 'react';
import { Upload, Button, Space, Spin, App } from 'antd';
import { PlusOutlined, DeleteOutlined, LoadingOutlined } from '@ant-design/icons';
import {
  useUploadPresignMutation,
  useUploadConfirmMutation,
  useUploadLimitsQuery,
} from '../features/api/adminApi';
import { IMAGE_ACCEPT, checkFile, uploadErrorText, uploadSingle } from '../lib/assetUpload';
import { imageUrl, useCdnBaseUrl } from '../lib/cdn';

/**
 * Controlled image upload bound to a Form.Item. Its form value is the confirmed
 * S3 `key` (string) or undefined. Upload runs the size-bound direct-to-S3 flow
 * (lib/assetUpload):
 *
 *   1. POST /admin/uploads/presign  → { key, upload_url, required_headers, limits }
 *   2. PUT upload_url (bytes go browser→S3 directly; no auth)
 *   3. POST /admin/uploads/confirm  → flips pending→active, or deletes the file
 *
 * Every image slot takes JPG/PNG/WebP/GIF/SVG up to the server's image cap
 * (`limits.image.max_bytes`, 25 MB by default). The resolved `key` is then
 * stored via onChange; the caller persists it onto the record. Preview is
 * rendered from `${cdn_base_url}/${key}`.
 *
 * `onUploaded(file, key)` fires after a successful upload, for callers that
 * also record the file's metadata.
 */
export default function ImageUploadField({ value, onChange, slot, disabled, onUploaded }) {
  const { message } = App.useApp();
  const cdnBase = useCdnBaseUrl();
  const [presign] = useUploadPresignMutation();
  const [confirm] = useUploadConfirmMutation();
  const { data: limits } = useUploadLimitsQuery();
  const [uploading, setUploading] = useState(false);

  const beforeUpload = (file) => {
    const problem = checkFile(file, 'image', limits);
    if (problem) {
      message.error(problem);
      return Upload.LIST_IGNORE;
    }
    return true;
  };

  const customRequest = async ({ file, onSuccess, onError }) => {
    setUploading(true);
    try {
      const key = await uploadSingle({
        file,
        target: { type: 'image_slot', slot },
        presign,
        confirm,
      });
      onChange?.(key);
      onUploaded?.(file, key);
      onSuccess?.({}, file);
      message.success('Image uploaded');
    } catch (err) {
      onError?.(err);
      message.error(uploadErrorText(err));
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
              accept={IMAGE_ACCEPT}
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
      accept={IMAGE_ACCEPT}
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
