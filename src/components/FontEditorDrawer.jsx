import { useEffect, useMemo, useState } from 'react';
import {
  Drawer,
  Tabs,
  Form,
  Input,
  Select,
  Switch,
  Button,
  Space,
  Table,
  Tag,
  Alert,
  Upload,
  Spin,
  Typography,
  App,
} from 'antd';
import { DeleteOutlined, InboxOutlined } from '@ant-design/icons';
import {
  adminApi,
  useFontCreateMutation,
  useFontUpdateMutation,
  useFontSetFilesMutation,
  useFontSetLanguagesMutation,
  useUploadPresignMutation,
  useUploadConfirmMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import {
  FONT_STYLES,
  FONT_WEIGHTS,
  checkFontFiles,
  contentTypeFor,
  formatFromFilename,
  guessVariant,
  weightLabel,
} from '../lib/fontFiles';

const { Text, Paragraph } = Typography;

const ACCEPT = '.woff2,.woff,.ttf,.otf';
const MAX_MB = 10;

const isTrue = (v) => v === true || v === 1 || v === '1';

let rowSeq = 0;
const nextRowKey = () => {
  rowSeq += 1;
  return `row-${rowSeq}`;
};

/**
 * Read one family out of the already-loaded list rather than issuing a GET.
 * The list row is the shape that is documented to carry FontFiles[] and
 * Languages[], and both sub-forms are FULL REPLACES — seeding them from a
 * response that happened not to join those arrays would silently wipe a family's
 * files on the next save. Every font mutation invalidates the list, so this stays
 * current without a second request.
 */
function useFont(uid) {
  return adminApi.endpoints.fontsList.useQuery(undefined, {
    selectFromResult: ({ data, isFetching }) => ({
      font: (data || []).find((f) => f.uid === uid),
      isFetching,
    }),
  });
}

/**
 * Font family editor. Adding a font is genuinely three steps, so the drawer is
 * three tabs and says so:
 *
 *   1. Create the family    → POST /admin/fonts
 *   2. Upload its files     → PUT  /admin/fonts/{uid}/files      (full replace)
 *   3. Tag script coverage  → PUT  /admin/fonts/{uid}/languages  (full replace)
 *
 * Steps 2 and 3 need a uid, so a new family saves step 1 first; the drawer then
 * keeps that uid and unlocks the rest.
 */
export default function FontEditorDrawer({ open, uid, onClose, onSaved }) {
  const [workingUid, setWorkingUid] = useState(uid || null);
  const [tab, setTab] = useState('family');

  useEffect(() => {
    if (open) {
      setWorkingUid(uid || null);
      setTab('family');
    }
  }, [open, uid]);

  const isCreate = !workingUid;

  return (
    <Drawer
      title={isCreate ? 'New Font Family' : 'Edit Font Family'}
      open={open}
      onClose={onClose}
      width={760}
      destroyOnClose
    >
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'family',
            label: '1. Family',
            children: (
              <FamilyForm
                uid={workingUid}
                onCreated={(newUid) => {
                  setWorkingUid(newUid);
                  setTab('files');
                  onSaved?.();
                }}
                onSaved={onSaved}
              />
            ),
          },
          {
            key: 'files',
            label: '2. Files',
            disabled: isCreate,
            children: workingUid ? <FilesPanel uid={workingUid} onSaved={onSaved} /> : <NeedsUid />,
          },
          {
            key: 'languages',
            label: '3. Script coverage',
            disabled: isCreate,
            children: workingUid ? (
              <LanguagesPanel uid={workingUid} onSaved={onSaved} />
            ) : (
              <NeedsUid />
            ),
          },
        ]}
      />
    </Drawer>
  );
}

function NeedsUid() {
  return <Alert type="info" showIcon message="Create the family first to unlock this step." />;
}

// ---- 1. family --------------------------------------------------------------

function FamilyForm({ uid, onCreated, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const isEdit = Boolean(uid);

  const { font, isFetching } = useFont(uid);
  const [createFont] = useFontCreateMutation();
  const [updateFont] = useFontUpdateMutation();

  useEffect(() => {
    if (isEdit && font) {
      form.setFieldsValue({
        family: font.family,
        is_premium: isTrue(font.is_premium),
        is_active: isTrue(font.is_active),
      });
    } else if (!isEdit) {
      form.resetFields();
      form.setFieldsValue({ is_premium: false, is_active: true });
    }
  }, [isEdit, font, form]);

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    // display_order is owned by the drag-reorder on the list, never set here.
    const body = {
      family: values.family.trim(),
      is_premium: values.is_premium ? 1 : 0,
      is_active: values.is_active ? 1 : 0,
    };
    setSubmitting(true);
    try {
      if (isEdit) {
        await updateFont({ uid, body }).unwrap();
        message.success('Family saved');
        onSaved?.();
      } else {
        const created = await createFont(body).unwrap();
        message.success('Family created — now upload its files');
        onCreated?.(created.uid);
      }
    } catch (err) {
      // 409 = another LIBRARY font already uses this family name. (A user's own
      // upload may share the name; that is intentional, not a clash.)
      if (err?.status === 409) {
        form.setFields([{ name: 'family', errors: [err.message || 'That family already exists.'] }]);
      } else {
        const detail = (err?.details || []).find((d) => d.field === 'family');
        if (detail) form.setFields([{ name: 'family', errors: [detail.message] }]);
        else message.error(err?.message || 'Could not save the family.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Spin spinning={isEdit && isFetching}>
      <Form form={form} layout="vertical">
        <Form.Item
          name="family"
          label="Family name"
          rules={[{ required: true, message: 'Family name is required' }]}
        >
          <Input placeholder="e.g. Noto Sans" />
        </Form.Item>

        <Form.Item
          name="is_premium"
          label="Premium"
          valuePropName="checked"
          extra="Gated behind a paid plan. Free users still SEE it, locked — its files are withheld."
        >
          <Switch />
        </Form.Item>

        <Form.Item
          name="is_active"
          label="Active"
          valuePropName="checked"
          extra="Inactive removes it from the Brand Kit picker without deleting it."
        >
          <Switch />
        </Form.Item>

        <Button type="primary" loading={submitting} onClick={handleSubmit}>
          {isEdit ? 'Save family' : 'Create family'}
        </Button>
      </Form>
    </Spin>
  );
}

// ---- 2. files ---------------------------------------------------------------

function FilesPanel({ uid, onSaved }) {
  const { message } = App.useApp();
  const perms = usePermissions();
  const canUpdate = perms.can('fonts', 'update');

  const { font, isFetching } = useFont(uid);
  const [setFiles] = useFontSetFilesMutation();
  const [presign] = useUploadPresignMutation();
  const [confirm] = useUploadConfirmMutation();

  const [rows, setRows] = useState([]);
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!font) return;
    setRows(
      (font.FontFiles || []).map((f) => ({
        key: nextRowKey(),
        weight: f.weight ?? 400,
        style: f.style || 'normal',
        format: f.format || formatFromFilename(f.s3_key) || 'ttf',
        s3_key: f.s3_key,
      })),
    );
  }, [font]);

  const { errors, warnings } = useMemo(() => checkFontFiles(rows), [rows]);

  const patchRow = (key, patch) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const removeRow = (key) => setRows((rs) => rs.filter((r) => r.key !== key));

  /** presign → PUT bytes straight to S3 → confirm (pending→active). */
  const uploadOne = async (file) => {
    const contentType = file.type || contentTypeFor(file.name);
    const { key, upload_url, required_headers } = await presign({
      target: { type: 'image_slot', slot: 'font_file' },
      filename: file.name,
      content_type: contentType,
    }).unwrap();

    const res = await fetch(upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, ...(required_headers || {}) },
      body: file,
    });
    if (!res.ok) throw new Error(`S3 upload failed (${res.status})`);

    await confirm([key]).unwrap();
    return key;
  };

  const beforeUpload = (file) => {
    if (!formatFromFilename(file.name)) {
      message.error(`${file.name}: only .woff2, .woff, .ttf and .otf are accepted.`);
      return Upload.LIST_IGNORE;
    }
    if (file.size / 1024 / 1024 > MAX_MB) {
      message.error(`${file.name} is larger than ${MAX_MB} MB.`);
      return Upload.LIST_IGNORE;
    }
    return true;
  };

  const customRequest = async ({ file, onSuccess, onError }) => {
    setUploading((n) => n + 1);
    try {
      const key = await uploadOne(file);
      // Weight/style are guessed from the filename — a starting point the admin
      // can correct, never a claim that the guess is right.
      const guess = guessVariant(file.name);
      setRows((rs) => [
        ...rs,
        {
          key: nextRowKey(),
          weight: guess.weight,
          style: guess.style,
          format: formatFromFilename(file.name),
          s3_key: key,
        },
      ]);
      onSuccess?.({}, file);
    } catch (err) {
      onError?.(err);
      message.error(`${file.name}: ${err?.message || 'upload failed'}`);
    } finally {
      setUploading((n) => n - 1);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setFiles({
        uid,
        // Full replace: every file the family should have, not just the new ones.
        files: rows.map(({ weight, style, format, s3_key }) => ({
          weight,
          style,
          format,
          s3_key,
        })),
      }).unwrap();
      message.success('Files saved');
      onSaved?.();
    } catch (err) {
      const detail = (err?.details || [])
        .map((d) => `${d.field ? `${d.field}: ` : ''}${d.message}`)
        .join(' ');
      message.error(detail || err?.message || 'Could not save the files.');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: 'Weight',
      dataIndex: 'weight',
      key: 'weight',
      width: 170,
      render: (v, r) => (
        <Select
          size="small"
          style={{ width: 150 }}
          value={v}
          disabled={!canUpdate}
          onChange={(next) => patchRow(r.key, { weight: next })}
          options={FONT_WEIGHTS.map((w) => ({ label: weightLabel(w), value: w }))}
        />
      ),
    },
    {
      title: 'Style',
      dataIndex: 'style',
      key: 'style',
      width: 120,
      render: (v, r) => (
        <Select
          size="small"
          style={{ width: 100 }}
          value={v}
          disabled={!canUpdate}
          onChange={(next) => patchRow(r.key, { style: next })}
          options={FONT_STYLES.map((s) => ({ label: s, value: s }))}
        />
      ),
    },
    {
      // Read-only: the format IS the uploaded file. Letting it be edited would
      // only ever mislabel bytes that are already what they are.
      title: 'Format',
      dataIndex: 'format',
      key: 'format',
      width: 100,
      render: (v) => <Tag color={v === 'woff2' ? 'blue' : 'green'}>{v}</Tag>,
    },
    {
      title: 'File',
      dataIndex: 's3_key',
      key: 's3_key',
      ellipsis: true,
      render: (v) =>
        v ? (
          <Text code style={{ fontSize: 12 }}>
            {v}
          </Text>
        ) : (
          <Text type="danger">not uploaded</Text>
        ),
    },
  ];

  if (canUpdate) {
    columns.push({
      title: '',
      key: 'actions',
      width: 50,
      render: (_v, r) => (
        <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeRow(r.key)} />
      ),
    });
  }

  return (
    <Spin spinning={isFetching}>
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Alert
          type="warning"
          showIcon
          message="Every weight needs two files: a .woff2 and a .ttf/.otf"
          description={
            <>
              The mobile app is Flutter and <strong>cannot read woff2</strong>; the website wants
              woff2 because it is much smaller. A family with only woff2 does not error — it simply
              does not exist in the app, and the text renders in the default typeface.
            </>
          }
        />

        {errors.length > 0 && (
          <Alert
            type="error"
            showIcon
            message="Fix these before saving"
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            }
          />
        )}
        {warnings.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message="Saveable, but incomplete"
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            }
          />
        )}

        {canUpdate && (
          <Upload.Dragger
            accept={ACCEPT}
            multiple
            showUploadList={false}
            beforeUpload={beforeUpload}
            customRequest={customRequest}
            disabled={uploading > 0}
            style={{ padding: '8px 0' }}
          >
            <p style={{ margin: 0 }}>
              <InboxOutlined style={{ fontSize: 22, color: '#1677ff' }} />
            </p>
            <p style={{ margin: '6px 0 0' }}>
              {uploading > 0 ? (
                <>Uploading {uploading}…</>
              ) : (
                <>
                  Drop font files here, or click to pick — <Text code>.woff2 .woff .ttf .otf</Text>
                </>
              )}
            </p>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Weight and style are guessed from the filename; check each row.
            </Text>
          </Upload.Dragger>
        )}

        <Table
          rowKey="key"
          columns={columns}
          dataSource={rows}
          pagination={false}
          size="small"
          locale={{ emptyText: 'No files yet.' }}
        />

        {canUpdate && (
          <Space>
            <Button
              type="primary"
              loading={saving}
              disabled={errors.length > 0 || uploading > 0}
              onClick={handleSave}
            >
              Save files
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Saving replaces the family&apos;s whole file list with what is shown here.
            </Text>
          </Space>
        )}
      </Space>
    </Spin>
  );
}

// ---- 3. script coverage -----------------------------------------------------

function LanguagesPanel({ uid, onSaved }) {
  const { message } = App.useApp();
  const perms = usePermissions();
  const canUpdate = perms.can('fonts', 'update');
  const canReadLanguages = perms.canRead('languages');

  const { font, isFetching } = useFont(uid);
  const { data: languages } = adminApi.endpoints.languagesFiltered.useQuery(
    { is_active: 1 },
    { skip: !canReadLanguages },
  );
  const [setLanguages] = useFontSetLanguagesMutation();

  const [value, setValue] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!font) return;
    setValue((font.Languages || []).map((l) => l.id));
  }, [font]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setLanguages({ uid, language_ids: value }).unwrap();
      message.success('Script coverage saved');
      onSaved?.();
    } catch (err) {
      message.error(err?.message || 'Could not save the script coverage.');
    } finally {
      setSaving(false);
    }
  };

  if (!canReadLanguages) {
    return (
      <Alert
        type="info"
        showIcon
        message="You need the languages “read” permission to set which scripts this font covers."
      />
    );
  }

  return (
    <Spin spinning={isFetching}>
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          Which scripts this font can actually <strong>draw</strong>. A Devanagari font cannot render
          Tamil, so this is what stops a user picking a brand font that turns their headlines into
          empty boxes.
        </Paragraph>

        <Alert
          type="info"
          showIcon
          message="Empty means unspecified — and unspecified is permissive"
          description="Leave this empty and the font is offered for EVERY language. Only list languages once you know which scripts it covers."
        />

        <Select
          mode="multiple"
          allowClear
          style={{ width: '100%' }}
          value={value}
          onChange={setValue}
          disabled={!canUpdate}
          optionFilterProp="label"
          placeholder="Every language (unspecified)"
          options={(languages || []).map((l) => ({
            label: `${l.native_name} (${l.name})`,
            value: l.id,
          }))}
        />

        {canUpdate && (
          <Space>
            <Button type="primary" loading={saving} onClick={handleSave}>
              Save script coverage
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Replaces the whole list.
            </Text>
          </Space>
        )}
      </Space>
    </Spin>
  );
}
