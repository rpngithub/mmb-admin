import { useMemo, useState } from 'react';
import {
  Typography,
  Space,
  Button,
  Upload,
  Segmented,
  Alert,
  Table,
  Tag,
  Card,
  Row,
  Col,
  Statistic,
  Result,
  Collapse,
  Divider,
  App,
} from 'antd';
import {
  DownloadOutlined,
  UploadOutlined,
  EyeOutlined,
  ImportOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAppSelector } from '../app/hooks';
import { selectAccessToken } from '../features/auth/authSlice';
import { usePermissions } from '../features/auth/usePermissions';
import { useImportUploadMutation } from '../features/api/adminApi';
import { downloadTemplate } from '../lib/downloadTemplate';

const { Title, Text, Paragraph } = Typography;

/**
 * The three importable entities. `value` is the API URL segment; `domain` is the
 * permission domain — `<domain>.read` to download templates, `<domain>.create`
 * to import. `columns` documents the CSV shape shown on screen.
 */
const ENTITIES = [
  {
    value: 'industries',
    label: 'Industries',
    domain: 'categories',
    columns: [
      ['name', 'Required.'],
      ['parent', 'Parent industry, by name or slug.'],
      ['slug', 'Auto-generated if blank.'],
      ['display_order', 'Number.'],
      ['is_active', '1 or 0.'],
      ['tags', 'Pipe-separated, e.g. food|dining. A non-blank cell replaces this industry’s tags; blank leaves them untouched. New tags are created.'],
    ],
  },
  {
    value: 'template-categories',
    label: 'Template categories',
    domain: 'categories',
    columns: [
      ['name', 'Required.'],
      ['parent', 'Parent category, by name or slug.'],
      ['slug', 'Auto-generated if blank.'],
      ['show_in_homepage', '1 or 0.'],
      ['display_order', 'Number.'],
      ['is_active', '1 or 0.'],
    ],
  },
  {
    value: 'themes',
    label: 'Themes',
    domain: 'themes',
    columns: [
      ['group', 'Required. Theme-group name or slug — auto-created if it doesn’t exist.'],
      ['name', 'Required.'],
      ['description', 'Optional.'],
      ['display_order', 'Number.'],
      ['is_active', '1 or 0.'],
    ],
  },
];

const STATUS_META = {
  created: { color: 'green', label: 'Created' },
  updated: { color: 'blue', label: 'Updated' },
  skipped: { color: 'red', label: 'Skipped' },
};

// Sort skipped rows to the top so errors are obvious, then by source line.
const STATUS_RANK = { skipped: 0, updated: 1, created: 2 };

export default function BulkImportPage() {
  const perms = usePermissions();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const token = useAppSelector(selectAccessToken);

  const [runImport] = useImportUploadMutation();

  // Only entities the admin can at least read (→ download a template for).
  const available = useMemo(
    () => ENTITIES.filter((e) => perms.canRead(e.domain)),
    [perms],
  );

  const [entity, setEntity] = useState(available[0]?.value);
  const [fileList, setFileList] = useState([]);
  const [result, setResult] = useState(null); // { entity, dry_run, summary, rows }
  const [errorMsg, setErrorMsg] = useState(null);
  const [busy, setBusy] = useState(null); // 'preview' | 'import' | null
  const [downloading, setDownloading] = useState(null); // 'template' | 'example' | null
  // uid of the file that had a successful dry-run preview — gates the Import button.
  const [previewedUid, setPreviewedUid] = useState(null);

  const current = useMemo(
    () => available.find((e) => e.value === entity),
    [available, entity],
  );
  const canImport = current ? perms.can(current.domain, 'create') : false;
  const file = fileList[0];
  const canCommit = Boolean(file) && previewedUid === file?.uid;

  // Clear the file + any prior report/preview state (on entity switch or new file).
  const resetForFile = () => {
    setResult(null);
    setErrorMsg(null);
    setPreviewedUid(null);
  };

  const onEntityChange = (value) => {
    setEntity(value);
    setFileList([]);
    resetForFile();
  };

  const doDownload = async (example) => {
    setDownloading(example ? 'example' : 'template');
    try {
      await downloadTemplate({ entity, example, token });
    } catch (err) {
      message.error(err?.message || 'Download failed.');
    } finally {
      setDownloading(null);
    }
  };

  const submit = async (dryRun) => {
    if (!file) return;
    setBusy(dryRun ? 'preview' : 'import');
    setErrorMsg(null);
    try {
      const data = await runImport({ entity, file, dryRun }).unwrap();
      setResult(data);
      if (dryRun) {
        setPreviewedUid(file.uid);
      } else {
        // Committed — force another preview before a second commit is allowed.
        setPreviewedUid(null);
        const s = data.summary || {};
        message.success(
          `Import complete — ${s.created ?? 0} created, ${s.updated ?? 0} updated, ${s.skipped ?? 0} skipped.`,
        );
      }
    } catch (err) {
      // Silent mutation → surface the backend error.message inline.
      setResult(null);
      setErrorMsg(err?.message || 'Import failed.');
    } finally {
      setBusy(null);
    }
  };

  const reportRows = useMemo(() => {
    const rows = result?.rows || [];
    return [...rows].sort((a, b) => {
      const ra = STATUS_RANK[a.status] ?? 9;
      const rb = STATUS_RANK[b.status] ?? 9;
      if (ra !== rb) return ra - rb;
      return (a.line ?? 0) - (b.line ?? 0);
    });
  }, [result]);

  const reportColumns = [
    { title: 'Line', dataIndex: 'line', key: 'line', width: 80 },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (v) => v || <Text type="secondary">—</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      filters: Object.entries(STATUS_META).map(([value, m]) => ({
        text: m.label,
        value,
      })),
      onFilter: (value, record) => record.status === value,
      render: (status) => {
        const m = STATUS_META[status] || { color: 'default', label: status };
        return <Tag color={m.color}>{m.label}</Tag>;
      },
    },
    {
      title: 'Message',
      dataIndex: 'message',
      key: 'message',
      render: (v) => v || <Text type="secondary">—</Text>,
    },
  ];

  const summary = result?.summary;

  // No readable entity at all → hard 403 (guards a direct URL visit too).
  if (available.length === 0) {
    return (
      <Result
        status="403"
        title="403"
        subTitle="You don't have permission to import any catalog data."
        extra={
          <Button type="primary" onClick={() => navigate('/')}>
            Back to dashboard
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          Bulk Import (CSV)
        </Title>
        <Text type="secondary">
          Download a template, fill it in, then preview and import. Rows are upserted by
          name (case-insensitive) — invalid rows are skipped and reported, valid rows still
          import.
        </Text>
      </div>

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card size="small" title="1. Choose what to import">
          <Segmented
            options={available.map((e) => ({ label: e.label, value: e.value }))}
            value={entity}
            onChange={onEntityChange}
          />
        </Card>

        <Card size="small" title="2. Download a template">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Space wrap>
              <Button
                icon={<DownloadOutlined />}
                loading={downloading === 'template'}
                onClick={() => doDownload(false)}
              >
                Import template
              </Button>
              <div>
                <Button
                  icon={<FileTextOutlined />}
                  loading={downloading === 'example'}
                  onClick={() => doDownload(true)}
                >
                  Example (reference)
                </Button>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    For understanding only — do not upload this file.
                  </Text>
                </div>
              </div>
            </Space>

            <Collapse
              ghost
              size="small"
              items={[
                {
                  key: 'help',
                  label: `CSV columns & rules for ${current?.label}`,
                  children: (
                    <>
                      <Table
                        size="small"
                        pagination={false}
                        rowKey={(r) => r[0]}
                        dataSource={current?.columns || []}
                        columns={[
                          {
                            title: 'Column',
                            dataIndex: 0,
                            width: 180,
                            render: (v) => <Text code>{v}</Text>,
                          },
                          { title: 'Notes', dataIndex: 1 },
                        ]}
                      />
                      <Divider style={{ margin: '12px 0' }} />
                      <Paragraph type="secondary" style={{ marginBottom: 4 }}>
                        • Rows are <Text strong>upserted by name</Text> (case-insensitive):
                        an existing name is updated, a new one is created.
                      </Paragraph>
                      <Paragraph type="secondary" style={{ marginBottom: 4 }}>
                        • Invalid rows are <Text strong>skipped and reported</Text> per line;
                        valid rows still import (no all-or-nothing rollback).
                      </Paragraph>
                      {(entity === 'industries' ||
                        entity === 'template-categories') && (
                        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                          • A <Text code>parent</Text> may appear before or after its child in
                          the file. If a parent row is skipped, its children are skipped too.
                        </Paragraph>
                      )}
                    </>
                  ),
                },
              ]}
            />
          </Space>
        </Card>

        <Card size="small" title="3. Upload & import">
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Upload
              accept=".csv"
              maxCount={1}
              fileList={fileList}
              beforeUpload={(f) => {
                setFileList([f]);
                resetForFile();
                return false; // keep the file in state; don't auto-upload
              }}
              onRemove={() => {
                setFileList([]);
                resetForFile();
              }}
            >
              <Button icon={<UploadOutlined />}>Select CSV file</Button>
            </Upload>

            <Space wrap>
              <Button
                icon={<EyeOutlined />}
                disabled={!file || busy != null}
                loading={busy === 'preview'}
                onClick={() => submit(true)}
              >
                Preview (dry run)
              </Button>
              {canImport && (
                <Button
                  type="primary"
                  icon={<ImportOutlined />}
                  disabled={!canCommit || busy != null}
                  loading={busy === 'import'}
                  onClick={() => submit(false)}
                >
                  Import
                </Button>
              )}
            </Space>
            {file && canImport && !canCommit && busy == null && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Run a preview first to enable Import.
              </Text>
            )}
          </Space>
        </Card>

        {errorMsg && (
          <Alert
            type="error"
            showIcon
            message="Import failed"
            description={errorMsg}
            closable
            onClose={() => setErrorMsg(null)}
          />
        )}

        {result && summary && (
          <Card
            size="small"
            title={
              <Space>
                <span>Result report</span>
                {result.dry_run ? (
                  <Tag color="gold">Preview — nothing written</Tag>
                ) : (
                  <Tag color="green">Committed</Tag>
                )}
              </Space>
            }
          >
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col xs={12} sm={6}>
                <Statistic title="Total" value={summary.total ?? 0} />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title="Created"
                  value={summary.created ?? 0}
                  valueStyle={{ color: '#52c41a' }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title="Updated"
                  value={summary.updated ?? 0}
                  valueStyle={{ color: '#1677ff' }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title="Skipped"
                  value={summary.skipped ?? 0}
                  valueStyle={{ color: (summary.skipped ?? 0) > 0 ? '#cf1322' : undefined }}
                />
              </Col>
            </Row>

            <Table
              rowKey={(r) => `${r.line}-${r.name ?? ''}`}
              size="small"
              columns={reportColumns}
              dataSource={reportRows}
              pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} rows` }}
              scroll={{ x: 'max-content' }}
            />
          </Card>
        )}
      </Space>
    </div>
  );
}
