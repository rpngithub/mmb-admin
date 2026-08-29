import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Collapse,
  Divider,
  Drawer,
  Space,
  Table,
  Typography,
  Upload,
} from 'antd';
import {
  DownloadOutlined,
  FileTextOutlined,
  ImportOutlined,
  SafetyCertificateOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useAppSelector } from '../app/hooks';
import { selectAccessToken } from '../features/auth/authSlice';
import { useImportUploadMutation } from '../features/api/adminApi';
import { downloadTemplate } from '../lib/downloadTemplate';
import ImportResultReport from './ImportResultReport';

const { Text, Paragraph } = Typography;

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * On-screen documentation for the two asset importers.
 *
 * The CSV shape here is a hand-maintained copy of the backend's import spec —
 * the template downloads are generated server-side from that same spec, so the
 * downloaded file always wins if the two ever disagree. Nothing in the FE builds
 * a CSV; this table exists only so an editor can see the rules without opening
 * the file.
 */
const IMPORT_SPECS = {
  'asset-categories': {
    title: 'Import asset categories (CSV)',
    intro:
      'Rows are matched on name (case-insensitive), so re-uploading a corrected sheet updates the same categories instead of creating duplicates. A parent may appear before or after its child — the whole file is resolved together. Always Validate first.',
    columns: [
      ['name', 'Required. An existing category with the same name is updated (case-insensitive).'],
      ['parent', 'Name or slug of another asset category. Blank = top level.'],
      ['slug', 'Optional — auto-generated from the name. Must be unique.'],
      ['display_order', 'Number.'],
      ['is_active', '1 or 0.'],
    ],
  },
  assets: {
    title: 'Import assets (CSV)',
    intro:
      'Upload your files to S3 first, then paste each file’s key into the sheet. Rows are matched on the key, so re-uploading a corrected sheet updates the same assets. Import asset categories before assets. Always Validate first.',
    columns: [
      [
        'category',
        'Required. Name, slug or uid of an asset category that ALREADY exists — nothing is auto-created. An unknown category skips the row.',
      ],
      ['name', 'Required. The editor label. Names do not have to be unique.'],
      ['asset_type', 'Required. One of: icon, emoji, shape, audio, video, animated, bg.'],
      [
        's3_key',
        'Required. Key of a file already in S3, under assets/<asset_type>/. A full https:// console or CDN URL is accepted and trimmed down to the key.',
      ],
      [
        'thumbnail_s3_key',
        'The preview shown to users who have not paid — an image, under assets/thumbnail/, whatever the asset type is. Blank keeps the current one, NONE removes it. Effectively required on a premium row: without it the app shows an empty card.',
      ],
      ['is_premium', '1 = paid plans only, 0 = free.'],
      ['status', 'active or inactive (1/0 also accepted).'],
      [
        'tags',
        'Pipe-separated, e.g. diwali|festival|lamp. New tags are created. A blank cell leaves existing tag links alone; a filled cell REPLACES them.',
      ],
    ],
    // Where a key is expected to live and what the file should be, per type.
    locations: [
      ['icon, emoji, shape, bg', 'assets/<type>/', 'png, jpg, webp, svg'],
      ['audio', 'assets/audio/', 'mp3, wav, m4a, aac, ogg'],
      ['video', 'assets/video/', 'mp4, webm, mov'],
      ['animated', 'assets/animated/', 'json (Lottie), gif, webp, mp4'],
    ],
  },
};

/**
 * CSV import drawer, opened from a resource screen. One component; `entity` is
 * the API URL segment (`assets` | `asset-categories`) and picks both the
 * endpoints and the on-screen help.
 *
 * The two template downloads need `assets.read`; the upload (dry run included —
 * it is the same POST) needs `assets.create`, which is why the button that opens
 * this drawer is hidden without it.
 */
export default function ImportDrawer({ open, entity, onClose, onImported }) {
  const { message } = App.useApp();
  const token = useAppSelector(selectAccessToken);
  const [runImport] = useImportUploadMutation();

  const [fileList, setFileList] = useState([]);
  const [result, setResult] = useState(null); // { entity, dry_run, summary, notes, rows }
  const [errorMsg, setErrorMsg] = useState(null);
  const [busy, setBusy] = useState(null); // 'validate' | 'import' | null
  const [downloading, setDownloading] = useState(null); // 'template' | 'example' | null
  // uid of the file that passed a dry run — gates the Import button.
  const [previewedUid, setPreviewedUid] = useState(null);

  const spec = IMPORT_SPECS[entity];
  const file = fileList[0];
  const canCommit = Boolean(file) && previewedUid === file?.uid;

  // Drop any prior report/validation state (a new file invalidates both).
  const resetForFile = () => {
    setResult(null);
    setErrorMsg(null);
    setPreviewedUid(null);
  };

  const handleClose = () => {
    setFileList([]);
    resetForFile();
    setBusy(null);
    onClose?.();
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
        // The mutation already invalidates the list tags; this lets the screen
        // do anything else it needs (e.g. a manual refetch of a filtered query).
        onImported?.(data);
      }
    } catch (err) {
      // Silent mutation → surface the backend error.message inline. These are the
      // readable 400s: the example file was uploaded, a required column is
      // missing, the file is empty / has no header row.
      setResult(null);
      setErrorMsg(err?.message || 'Import failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Drawer
      title={spec?.title || 'Import (CSV)'}
      open={open}
      onClose={handleClose}
      width={880}
      destroyOnClose
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Alert type="info" showIcon message={spec?.intro} />

        {entity === 'assets' && (
          // The one thing that reliably confuses people: assets are keyed on the
          // FILE, not the name — so the s3_key cell behaves unlike every other
          // column in the sheet.
          <Alert
            type="warning"
            showIcon
            message="Assets are matched on s3_key, not on name"
            description={
              <>
                <Paragraph style={{ marginBottom: 4 }}>
                  Asset names repeat across categories, so one S3 file = one asset. Re-importing a
                  sheet with the same keys <Text strong>updates</Text> those assets (renames,
                  re-tags, re-prices) instead of creating duplicates.
                </Paragraph>
                <Paragraph style={{ marginBottom: 4 }}>
                  That is also the quickest way to add missing previews in bulk: take a sheet of the
                  assets you are fixing, fill in <Text code>thumbnail_s3_key</Text>, and re-import —
                  they are updated in place.
                </Paragraph>
                <Paragraph style={{ marginBottom: 4 }}>
                  Changing the <Text code>s3_key</Text> cell does <Text strong>not</Text> replace the
                  file — it creates a <Text strong>new</Text> asset and leaves the old one behind.
                  Replacing a file means deleting the old asset.
                </Paragraph>
                <Paragraph style={{ marginBottom: 0 }}>
                  <Text code>s3_key</Text> is the one cell that cannot be blank — a row without it
                  is skipped. Every other file problem (wrong folder, wrong extension, file not
                  actually in the bucket, file isn&apos;t the type the{' '}
                  <Text code>asset_type</Text> implies) is a <Text strong>warning</Text> and the row
                  still imports, so a typo never costs you the rest of the row.
                </Paragraph>
              </>
            }
          />
        )}

        <div>
          <Space wrap>
            <Button
              icon={<DownloadOutlined />}
              loading={downloading === 'template'}
              onClick={() => doDownload(false)}
            >
              Download template
            </Button>
            <div>
              <Button
                icon={<FileTextOutlined />}
                loading={downloading === 'example'}
                onClick={() => doDownload(true)}
              >
                Download example
              </Button>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Reference only — do not upload this file.
                </Text>
              </div>
            </div>
          </Space>
          <Paragraph type="secondary" style={{ margin: '12px 0 0' }}>
            Both files are generated from the API&apos;s own column spec, so the downloaded template
            always matches what the import accepts today.
          </Paragraph>
        </div>

        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'help',
              label: 'CSV columns & rules',
              children: (
                <>
                  <Table
                    size="small"
                    pagination={false}
                    rowKey={(r) => r[0]}
                    dataSource={spec?.columns || []}
                    columns={[
                      {
                        title: 'Column',
                        dataIndex: 0,
                        width: 160,
                        render: (v) => <Text code>{v}</Text>,
                      },
                      { title: 'Notes', dataIndex: 1 },
                    ]}
                  />

                  {spec?.locations && (
                    <>
                      <Divider style={{ margin: '16px 0 12px' }} />
                      <Paragraph style={{ marginBottom: 8 }}>
                        <Text strong>Where each file belongs.</Text> A key outside these still
                        imports — it just warns.
                      </Paragraph>
                      <Table
                        size="small"
                        pagination={false}
                        rowKey={(r) => r[0]}
                        dataSource={spec.locations}
                        columns={[
                          { title: 'asset_type', dataIndex: 0, width: 200 },
                          {
                            title: 'S3 prefix',
                            dataIndex: 1,
                            width: 200,
                            render: (v) => (
                              <Text code copyable={{ text: v }}>
                                {v}
                              </Text>
                            ),
                          },
                          { title: 'File types', dataIndex: 2 },
                        ]}
                      />
                      <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
                        Previews are the exception: <Text code>thumbnail_s3_key</Text> always lives
                        under{' '}
                        <Text code copyable={{ text: 'assets/thumbnail/' }}>
                          assets/thumbnail/
                        </Text>{' '}
                        and is always an image (png, jpg, webp), even for an audio or video asset.
                      </Paragraph>
                      <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
                        <Text code>font</Text> is not an asset type — library fonts live on the
                        Fonts screen.
                      </Paragraph>
                    </>
                  )}

                  <Divider style={{ margin: '12px 0' }} />
                  <Paragraph type="secondary" style={{ marginBottom: 4 }}>
                    • Bad rows are <Text strong>skipped and reported</Text> per line; the good rows
                    still commit. An import is never all-or-nothing.
                  </Paragraph>
                  <Paragraph type="secondary" style={{ marginBottom: 4 }}>
                    • Warnings are <Text strong>not failures</Text> — a row can be created and still
                    carry three warnings.
                  </Paragraph>
                  <Paragraph type="secondary" style={{ marginBottom: 4 }}>
                    • Save from Excel as <Text strong>“CSV UTF-8”</Text>, not plain “CSV” — plain CSV
                    mangles non-English names.
                  </Paragraph>
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    • Lines starting with <Text code>#</Text> are ignored, which is why the
                    downloaded templates carry their own help.
                  </Paragraph>
                </>
              ),
            },
          ]}
        />

        <div>
          <Upload
            accept=".csv"
            maxCount={1}
            fileList={fileList}
            beforeUpload={(f) => {
              if (f.size > MAX_BYTES) {
                message.error('That file is over the 5 MB limit — split it into smaller sheets.');
                return Upload.LIST_IGNORE;
              }
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

          <Space wrap style={{ marginTop: 16 }}>
            {/* Validate is the primary action: S3 keys and category lookups are
                only fully checked server-side, so a dry run first saves a lot of
                pain — and it is the whole safety story of this feature. */}
            <Button
              type="primary"
              icon={<SafetyCertificateOutlined />}
              disabled={!file || busy != null}
              loading={busy === 'validate'}
              onClick={() => submit(true)}
            >
              Validate
            </Button>
            <Button
              icon={<ImportOutlined />}
              disabled={!canCommit || busy != null}
              loading={busy === 'import'}
              onClick={() => submit(false)}
            >
              Import
            </Button>
          </Space>
          {file && !canCommit && busy == null && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Validate first to enable Import.
              </Text>
            </div>
          )}
        </div>

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

        {/* Kept on screen after a committed import too — it's what they use to
            fix the next pass. */}
        {result && <ImportResultReport result={result} defaultProblemsOnly />}
      </Space>
    </Drawer>
  );
}
