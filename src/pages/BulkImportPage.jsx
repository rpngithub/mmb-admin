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
  Result,
  Collapse,
  Divider,
  App,
} from 'antd';
import {
  DownloadOutlined,
  UploadOutlined,
  SafetyCertificateOutlined,
  ImportOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAppSelector } from '../app/hooks';
import { selectAccessToken } from '../features/auth/authSlice';
import { usePermissions } from '../features/auth/usePermissions';
import { useImportUploadMutation } from '../features/api/adminApi';
import { downloadTemplate } from '../lib/downloadTemplate';
import ImportResultReport from '../components/ImportResultReport';

const { Title, Text, Paragraph } = Typography;

/**
 * The three importable entities. `value` is the API URL segment; `domain` is the
 * permission domain — `<domain>.read` to download templates, `<domain>.create`
 * to import.
 *
 * `columns` documents the CSV shape shown on screen and `imageColumns` the S3
 * prefixes editors need when creating folders. Both are hand-maintained copies
 * of the backend's import spec — the server generates the template downloads
 * from that spec, so when it changes, these lists must be updated here too.
 * The downloaded template always wins if the two ever disagree.
 */
const IMAGE_KEY_NOTE =
  'S3 key (or a full https:// URL). Blank keeps the current image, NONE removes it.';

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
      ['icon_s3_key', IMAGE_KEY_NOTE],
      ['thumbnail_s3_key', IMAGE_KEY_NOTE],
    ],
    imageColumns: [
      ['icon_s3_key', 'categories/business/icon/'],
      ['thumbnail_s3_key', 'categories/business/thumbnail/'],
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
      ['icon_s3_key', IMAGE_KEY_NOTE],
      ['thumbnail_s3_key', IMAGE_KEY_NOTE],
    ],
    imageColumns: [
      ['icon_s3_key', 'categories/template/icon/'],
      ['thumbnail_s3_key', 'categories/template/thumbnail/'],
    ],
  },
  {
    value: 'variants',
    label: 'Variants',
    domain: 'variants',
    columns: [
      ['series', 'Required. Brand-series name or slug — auto-created if it doesn’t exist.'],
      ['name', 'Required.'],
      ['description', 'Optional.'],
      ['display_order', 'Number.'],
      ['is_active', '1 or 0.'],
      ['thumbnail_s3_key', IMAGE_KEY_NOTE],
      ['series_icon_s3_key', `Icon for the brand series, not the variant. ${IMAGE_KEY_NOTE}`],
    ],
    imageColumns: [
      ['thumbnail_s3_key', 'variants/thumbnail/'],
      ['series_icon_s3_key', 'brand-series/icon/'],
    ],
  },
];

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
  const [busy, setBusy] = useState(null); // 'validate' | 'import' | null
  const [downloading, setDownloading] = useState(null); // 'template' | 'example' | null
  // uid of the file that passed a dry run — gates the Import button.
  const [previewedUid, setPreviewedUid] = useState(null);

  const current = useMemo(
    () => available.find((e) => e.value === entity),
    [available, entity],
  );
  const canImport = current ? perms.can(current.domain, 'create') : false;
  const file = fileList[0];
  const canCommit = Boolean(file) && previewedUid === file?.uid;

  // Clear the file + any prior report/validation state (on entity switch or new file).
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
    setBusy(dryRun ? 'validate' : 'import');
    setErrorMsg(null);
    try {
      const data = await runImport({ entity, file, dryRun }).unwrap();
      setResult(data);
      if (dryRun) {
        setPreviewedUid(file.uid);
      } else {
        // Committed — force another validation before a second commit is allowed.
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
          Download a template, fill it in, then validate and import. Rows are upserted by
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

            <Text type="secondary">
              The downloaded template is the source of truth for the columns — it always
              matches what the API accepts today.
            </Text>

            {/*
              Images are uploaded to S3 by hand (console / `aws s3 sync`); the CSV
              only carries the resulting key. The prefixes are what the server
              expects — a key outside them still imports, but warns.
            */}
            <div>
              <Paragraph style={{ marginBottom: 4 }}>
                <Text strong>Images:</Text> upload the file to S3 first, then paste its key
                in the CSV.
              </Paragraph>
              <Paragraph type="secondary" style={{ marginBottom: 4 }}>
                • A full <Text code>https://…</Text> URL is accepted and trimmed to the key
                automatically.
              </Paragraph>
              <Paragraph type="secondary" style={{ marginBottom: 12 }}>
                • Blank keeps the current image. <Text code>NONE</Text> removes it.
              </Paragraph>

              <Table
                size="small"
                pagination={false}
                rowKey={(r) => r[0]}
                dataSource={current?.imageColumns || []}
                columns={[
                  {
                    title: 'Column',
                    dataIndex: 0,
                    width: 220,
                    render: (v) => <Text code>{v}</Text>,
                  },
                  {
                    title: 'Expected prefix',
                    dataIndex: 1,
                    render: (v) => (
                      <Text code copyable={{ text: v }}>
                        {v}
                      </Text>
                    ),
                  },
                ]}
              />

              {entity === 'variants' && (
                <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
                  <Text code>series_icon_s3_key</Text> is the icon for the{' '}
                  <Text strong>brand series</Text>, not the variant. It is read from the
                  first row mentioning each series, and only applied when that series has
                  no icon yet — an existing series icon is never overwritten (you get a
                  warning instead).
                </Paragraph>
              )}
            </div>

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
                      <Paragraph type="secondary" style={{ marginBottom: 4 }}>
                        • Image keys are checked server-side. A suspicious key produces a{' '}
                        <Text strong>warning</Text>, not an error — the row still imports.
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

        <Card size="small" title="3. Upload, validate & import">
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
              {/* Validate is the primary action: image keys are only fully
                  checked server-side, so a dry run first saves a lot of pain. */}
              <Button
                type="primary"
                icon={<SafetyCertificateOutlined />}
                disabled={!file || busy != null}
                loading={busy === 'validate'}
                onClick={() => submit(true)}
              >
                Validate
              </Button>
              {canImport && (
                <Button
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
                Validate first to enable Import.
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
                  <Tag color="blue">Validation</Tag>
                ) : (
                  <Tag color="green">Committed</Tag>
                )}
              </Space>
            }
          >
            <ImportResultReport result={result} />
          </Card>
        )}
      </Space>
    </div>
  );
}
