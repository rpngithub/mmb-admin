import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Collapse,
  Drawer,
  Popconfirm,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  useAssetsMissingFilesScanMutation,
  useAssetsMissingFilesDeleteMutation,
} from '../features/api/adminApi';

const { Text, Paragraph } = Typography;

// The types the audit accepts — `font` is not an asset type here.
const AUDIT_TYPES = ['icon', 'emoji', 'shape', 'bg', 'audio', 'video', 'animated'];
const typeOptions = AUDIT_TYPES.map((t) => ({ label: t, value: t }));

const UNCATEGORISED = 0;
const EMPTY_FILTERS = { category_id: null, asset_type: null };

const isTrue = (v) => v === true || v === 1 || v === '1';

// Which column came back 404 → the word an admin reads on the tag.
const MISSING_LABEL = { s3_key: 'file', thumbnail_s3_key: 'thumbnail' };

const HELP_TEXT =
  'An asset whose file or preview is not in S3 shows an empty card in the app. Scan to list them, check the list, then delete. Rows the check could not reach are listed separately and are never deleted. This removes the asset RECORD only — no files in S3 are touched.';

/**
 * "in Festive Icons of type icon" — the scope a scan (and therefore its delete)
 * ran under, worded for the confirm and the empty state. Empty filters read as
 * "across all assets" so the confirm never leaves the scope implicit.
 */
function describeScope(filters, categories) {
  const parts = [];
  if (filters.category_id != null) {
    const name =
      filters.category_id === UNCATEGORISED
        ? 'Uncategorised'
        : categories.find((c) => c.id === filters.category_id)?.name || `category #${filters.category_id}`;
    parts.push(`in ${name}`);
  }
  if (filters.asset_type) parts.push(`of type ${filters.asset_type}`);
  return parts.length ? parts.join(' ') : 'across all assets';
}

const sameFilters = (a, b) => a.category_id === b.category_id && a.asset_type === b.asset_type;

/**
 * Missing-files audit for the Assets screen. The API walks the assets table,
 * HEADs every key against S3 and reports what is confirmed gone; this drawer
 * renders that report and, on confirmation, asks the API to delete exactly
 * those rows under the SAME filters the shown scan used. Nothing here decides
 * what is missing — `data.missing` is rendered as returned.
 *
 * Mounted permanently by the page (the Drawer itself is what opens/closes), so
 * the last filters survive a close; the report does not — a stale count must
 * never reach the delete confirm.
 */
export default function MissingFilesDrawer({ open, onClose, categories, canDelete, listTotal }) {
  const { message } = App.useApp();
  const [scan, scanState] = useAssetsMissingFilesScanMutation();
  const [remove, removeState] = useAssetsMissingFilesDeleteMutation();

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  // { kind: 'scan' | 'deleted', filters, data } — the filters are the ones the
  // report was produced under, which is what the delete re-uses.
  const [report, setReport] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  const busy = scanState.isLoading || removeState.isLoading;

  const handleClose = () => {
    setReport(null);
    setErrorMsg(null);
    onClose?.();
  };

  const runScan = async () => {
    setErrorMsg(null);
    const snapshot = { ...filters };
    try {
      const data = await scan(snapshot).unwrap();
      setReport({ kind: 'scan', filters: snapshot, data });
    } catch (err) {
      // Silent mutation → the readable 400s (bad filter, S3 unreachable) land here.
      setReport(null);
      setErrorMsg(err?.message || 'Scan failed.');
    }
  };

  const runDelete = async () => {
    if (!report || report.kind !== 'scan') return;
    setErrorMsg(null);
    try {
      const data = await remove(report.filters).unwrap();
      setReport({ kind: 'deleted', filters: report.filters, data });
      const n = data?.summary?.deleted ?? 0;
      message.success(`Deleted ${n} ${n === 1 ? 'asset' : 'assets'}.`);
    } catch (err) {
      // Nothing was deleted on an error (the API re-scans first). Keep the scan
      // on screen so they can retry, but say why it failed.
      setErrorMsg(err?.message || 'Delete failed.');
    }
  };

  const copyKey = async (key) => {
    try {
      await navigator.clipboard.writeText(key);
      message.success('S3 key copied');
    } catch {
      message.error('Could not copy — select the key and copy it instead.');
    }
  };

  const summary = report?.data?.summary || {};
  const missingRows = report?.data?.missing || [];
  const unverifiedRows = report?.data?.unverified || [];
  const notes = report?.data?.notes || [];
  const missingCount = summary.missing ?? missingRows.length;

  // The delete must run under exactly the filters the shown report used. If the
  // selects have moved since the scan, force a re-scan rather than guessing.
  const filtersMoved = Boolean(report) && !sameFilters(filters, report.filters);
  const scope = report ? describeScope(report.filters, categories) : '';

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name', render: (v) => <Text strong>{v}</Text> },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      render: (c) => c?.name || <Text type="secondary">—</Text>,
    },
    {
      title: 'Type',
      dataIndex: 'asset_type',
      key: 'asset_type',
      width: 100,
      render: (v) => <Tag>{v}</Tag>,
    },
    {
      title: 'Premium',
      dataIndex: 'is_premium',
      key: 'is_premium',
      width: 100,
      render: (v) => (isTrue(v) ? <Tag color="gold">Premium</Tag> : <Text type="secondary">—</Text>),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v) => <Tag color={v === 'active' ? 'green' : 'default'}>{v || '—'}</Tag>,
    },
    {
      title: 'Missing',
      dataIndex: 'missing',
      key: 'missing',
      width: 160,
      render: (list) =>
        Array.isArray(list) && list.length ? (
          <Space size={4} wrap>
            {list.map((col) => (
              <Tooltip key={col} title={`${col} came back 404`}>
                <Tag color="red" style={{ marginInlineEnd: 0 }}>
                  {MISSING_LABEL[col] || col}
                </Tag>
              </Tooltip>
            ))}
          </Space>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
  ];

  // The keys are long: shown on expand, each with a copy so someone can go and
  // look in the bucket themselves.
  const expandedRowRender = (row) => (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      <KeyLine label="s3_key" value={row.s3_key} missing={row.missing?.includes('s3_key')} onCopy={copyKey} />
      <KeyLine
        label="thumbnail_s3_key"
        value={row.thumbnail_s3_key}
        missing={row.missing?.includes('thumbnail_s3_key')}
        onCopy={copyKey}
      />
    </Space>
  );

  const rowTable = (rows) => (
    <Table
      rowKey="uid"
      size="small"
      columns={columns}
      dataSource={rows}
      expandable={{ expandedRowRender }}
      scroll={{ x: 'max-content' }}
      pagination={rows.length > 20 ? { pageSize: 20, showSizeChanger: true } : false}
    />
  );

  return (
    <Drawer
      title="Find missing files"
      open={open}
      onClose={handleClose}
      width={960}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            {filtersMoved && (
              <Text type="warning">
                <WarningOutlined /> Filters changed since this scan — scan again before deleting.
              </Text>
            )}
          </div>
          <Space>
            <Button onClick={handleClose}>Close</Button>
            {canDelete && report?.kind === 'scan' && (
              <Popconfirm
                title="Delete these assets?"
                description={`Delete ${missingCount} ${missingCount === 1 ? 'asset' : 'assets'} ${scope} whose file or thumbnail is not in S3? This cannot be undone.`}
                okText="Delete"
                okButtonProps={{ danger: true }}
                onConfirm={runDelete}
                disabled={missingCount === 0 || filtersMoved || busy}
              >
                <Button
                  danger
                  type="primary"
                  icon={<DeleteOutlined />}
                  loading={removeState.isLoading}
                  disabled={missingCount === 0 || filtersMoved || scanState.isLoading}
                >
                  Delete {missingCount} {missingCount === 1 ? 'asset' : 'assets'}
                </Button>
              </Popconfirm>
            )}
          </Space>
        </div>
      }
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Alert type="info" showIcon message={HELP_TEXT} />

        <Space wrap>
          <Select
            allowClear
            placeholder="All categories"
            style={{ width: 220 }}
            value={filters.category_id ?? undefined}
            onChange={(v) => setFilters((f) => ({ ...f, category_id: v ?? null }))}
            showSearch
            optionFilterProp="label"
            options={[
              { label: 'Uncategorised', value: UNCATEGORISED },
              ...categories.map((c) => ({ label: c.name, value: c.id })),
            ]}
          />
          <Select
            allowClear
            placeholder="All types"
            style={{ width: 150 }}
            value={filters.asset_type ?? undefined}
            onChange={(v) => setFilters((f) => ({ ...f, asset_type: v ?? null }))}
            options={typeOptions}
          />
          <Button
            type="primary"
            icon={<FileSearchOutlined />}
            onClick={runScan}
            loading={scanState.isLoading}
            disabled={removeState.isLoading}
          >
            Scan
          </Button>
          {scanState.isLoading && (
            <Text type="secondary">Checking every file against S3 — a few seconds…</Text>
          )}
        </Space>

        {errorMsg && (
          <Alert type="error" showIcon message={errorMsg} closable onClose={() => setErrorMsg(null)} />
        )}

        {report && (
          <>
            <Space size="large" wrap>
              <Statistic
                title="Scanned"
                value={summary.scanned ?? 0}
                // The page's unfiltered total, when it has one — so a narrowed
                // scan visibly covers fewer rows than the list.
                suffix={listTotal != null ? <Text type="secondary">/ {listTotal} in list</Text> : null}
              />
              <Statistic
                title={report.kind === 'deleted' ? 'Confirmed missing' : 'Missing'}
                value={summary.missing ?? 0}
                valueStyle={{ color: (summary.missing ?? 0) > 0 ? '#cf1322' : undefined }}
              />
              <Statistic
                title="Unverified"
                value={summary.unverified ?? 0}
                valueStyle={{ color: (summary.unverified ?? 0) > 0 ? '#d46b08' : undefined }}
              />
              {report.kind === 'deleted' && (
                <Statistic title="Deleted" value={summary.deleted ?? 0} valueStyle={{ color: '#cf1322' }} />
              )}
            </Space>

            <Text type="secondary">Scope: {scope}.</Text>

            {notes.map((n, i) => (
              <Alert key={i} type="warning" showIcon message={n} />
            ))}

            {report.kind === 'deleted' && (
              <Alert
                type="success"
                showIcon
                message={`Deleted ${summary.deleted ?? 0} ${(summary.deleted ?? 0) === 1 ? 'asset' : 'assets'} ${scope}.`}
                description={
                  (summary.deleted ?? 0) < (summary.missing ?? 0)
                    ? 'The check was re-run before deleting; rows whose files turned up in the meantime were kept.'
                    : 'Only the asset records were removed — nothing in S3 was touched.'
                }
              />
            )}

            {missingRows.length === 0 ? (
              report.kind === 'scan' && (
                <Alert
                  type="success"
                  showIcon
                  message="Every asset's files are in S3."
                  description={
                    unverifiedRows.length > 0
                      ? 'Among the rows that could be checked — see the unverified list below.'
                      : report.filters.category_id != null || report.filters.asset_type
                        ? `Within the current scope (${scope}).`
                        : undefined
                  }
                />
              )
            ) : (
              <div>
                <Paragraph strong style={{ marginBottom: 8 }}>
                  {report.kind === 'deleted'
                    ? `Deleted (${missingRows.length})`
                    : `Missing (${missingRows.length})`}
                </Paragraph>
                {rowTable(missingRows)}
              </div>
            )}

            {unverifiedRows.length > 0 && (
              <Collapse
                size="small"
                items={[
                  {
                    key: 'unverified',
                    label: `Could not be checked — not deleted (${unverifiedRows.length})`,
                    children: (
                      <>
                        <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                          S3 answered with something other than 404 for these (credentials,
                          throttling, network). They are never deleted — re-run the scan later.
                        </Paragraph>
                        {rowTable(unverifiedRows)}
                      </>
                    ),
                  },
                ]}
              />
            )}
          </>
        )}
      </Space>
    </Drawer>
  );
}

function KeyLine({ label, value, missing, onCopy }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Text type="secondary" style={{ width: 140 }}>
        {label}
      </Text>
      {value ? (
        <>
          <Text code type={missing ? 'danger' : undefined} style={{ wordBreak: 'break-all' }}>
            {value}
          </Text>
          <Button size="small" icon={<CopyOutlined />} onClick={() => onCopy(value)}>
            Copy key
          </Button>
        </>
      ) : (
        <Text type="secondary">—</Text>
      )}
    </div>
  );
}
