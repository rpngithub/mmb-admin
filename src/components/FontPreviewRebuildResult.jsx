import { useMemo } from 'react';
import { Alert, Table, Tag, Typography, Tooltip } from 'antd';
import { describePreviewReason } from '../lib/fontPreview';

const { Text } = Typography;

const FIX_TAG = {
  yes: { color: 'orange', label: 'Fixable' },
  retry: { color: 'blue', label: 'Retry' },
  no: { color: 'default', label: 'Expected' },
};
const FIX_RANK = { yes: 0, retry: 1, no: 2 };

/**
 * Outcome of POST /admin/fonts/previews/rebuild: a summary line plus every font
 * still left without a preview and why. The `reason` lives only in this
 * response (not on the font row), so the panel stays up until dismissed —
 * admins work through the fixable rows from it.
 */
export default function FontPreviewRebuildResult({ result, force, onClose }) {
  const missing = useMemo(
    () =>
      (result?.fonts || [])
        .filter((f) => !f.preview_s3_key)
        .sort(
          (a, b) =>
            FIX_RANK[describePreviewReason(a.reason).fix] -
              FIX_RANK[describePreviewReason(b.reason).fix] ||
            String(a.family || '').localeCompare(String(b.family || '')),
        ),
    [result],
  );

  if (!result) return null;
  const processed = result.processed ?? result.fonts?.length ?? 0;
  const withPreview = result.with_preview ?? processed - missing.length;
  const fixable = missing.filter((f) => describePreviewReason(f.reason).fix !== 'no').length;

  const summary =
    processed === 0
      ? 'Every font already has a preview — nothing to build.'
      : `${withPreview} of ${processed} ${processed === 1 ? 'font has' : 'fonts have'} a preview.`;

  return (
    <Alert
      type={fixable ? 'warning' : 'success'}
      showIcon
      closable
      onClose={onClose}
      style={{ marginBottom: 16 }}
      message={
        <span>
          {force ? 'Rebuilt all previews. ' : 'Built missing previews. '}
          {summary}
          {fixable > 0 && ` ${fixable} can be fixed by changing files.`}
        </span>
      }
      description={
        missing.length > 0 && (
          <Table
            rowKey="uid"
            size="small"
            pagination={missing.length > 10 ? { pageSize: 10, size: 'small' } : false}
            dataSource={missing}
            style={{ marginTop: 8 }}
            columns={[
              { title: 'Family', dataIndex: 'family', key: 'family' },
              {
                title: 'Owner',
                dataIndex: 'is_library',
                key: 'is_library',
                width: 90,
                render: (v) => (v ? <Tag color="purple">Library</Tag> : <Tag>User</Tag>),
              },
              {
                title: 'Why no preview',
                dataIndex: 'reason',
                key: 'reason',
                render: (reason) => {
                  const r = describePreviewReason(reason);
                  const fix = FIX_TAG[r.fix];
                  return (
                    <span>
                      <Tag color={fix.color}>{fix.label}</Tag>
                      <Tooltip title={<Text code style={{ color: 'inherit' }}>{reason}</Text>}>
                        <Text strong>{r.label}</Text>
                      </Tooltip>
                      <div>
                        <Text type="secondary">{r.detail}</Text>
                      </div>
                    </span>
                  );
                },
              },
            ]}
          />
        )
      }
    />
  );
}
