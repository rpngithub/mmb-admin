import { useEffect, useMemo, useState } from 'react';
import {
  Table,
  Button,
  Dropdown,
  Modal,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  Alert,
  Form,
  App,
} from 'antd';
import {
  PlusOutlined,
  MoreOutlined,
  PictureOutlined,
  CloudUploadOutlined,
  CheckCircleOutlined,
  StopOutlined,
  SwapOutlined,
  ExportOutlined,
  DeleteOutlined,
  StarFilled,
} from '@ant-design/icons';
import { adminApi } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import {
  STATUS_COLORS,
  TEXT_FREE_LABEL,
  isTrue,
  isTextFree,
  sizeLabel,
  languageLabel,
  familyMode,
  requiredLanguageIds,
  isRequiredLanguage,
  findEnglish,
  useDefaultTemplateSize,
  detailLines,
} from '../lib/templateFamilies';
import ImageThumb from './ImageThumb';
import TemplateBundlePanel from './TemplateBundlePanel';
import { MoveVersionModal } from './TemplateFamilyMoveModals';

const { Text, Paragraph } = Typography;

const TF = 'tf'; // row key for the text-free row
const cellKey = (languageId, sizeId) => `${languageId ?? TF}:${sizeId}`;
const isActiveRow = (x) => x?.is_active === undefined || isTrue(x.is_active);

const REQUIRED_ROW_BG = '#f0f7ff';
const REQUIRED_ROW_EDGE = '3px solid #1677ff';

/**
 * The version grid: rows = active languages + a "Text-free" row, columns =
 * active sizes. Every cell is one (language, size) slot — at most one version
 * per slot per design. A design is all text-free or all languages, so once one
 * side has a version the other side is greyed out. The ROW the publish gate
 * needs (English, or Text-free) is highlighted — an active version in any of
 * its cells satisfies it. The default-size column is only marked as preferred.
 */
export default function TemplateVersionGrid({ family, versions, loading }) {
  const perms = usePermissions();
  const { message, modal } = App.useApp();
  const canCreate = perms.can('templates', 'create');
  const canUpdate = perms.can('templates', 'update');
  const canDelete = perms.can('templates', 'delete');
  const canReadLanguages = perms.canRead('languages');

  const { data: activeLanguages } = adminApi.endpoints.languagesFiltered.useQuery(
    { is_active: 1 },
    { skip: !canReadLanguages },
  );
  const { data: allSizes } = adminApi.endpoints.templateSizesList.useQuery();
  const [createVersion] = adminApi.endpoints.templateVersionCreate.useMutation();
  const [updateVersion] = adminApi.endpoints.templateVersionUpdate.useMutation();
  const [removeVersion] = adminApi.endpoints.templateVersionRemove.useMutation();

  const [busy, setBusy] = useState(null); // cell key or version uid with a call in flight
  const [bundleUid, setBundleUid] = useState(null);
  const [moveFor, setMoveFor] = useState(null);
  const [reslotFor, setReslotFor] = useState(null);

  const list = useMemo(() => versions || [], [versions]);
  const familyUid = family.uid;

  // Rows: active languages, plus any (since switched-off) language a version
  // still uses, so no version is ever hidden. Same for size columns.
  const languages = useMemo(() => {
    const out = [...(activeLanguages || [])];
    const seen = new Set(out.map((l) => l.id));
    list.forEach((v) => {
      if (!isTextFree(v) && !seen.has(v.language_id)) {
        seen.add(v.language_id);
        out.push(v.Language || { id: v.language_id, name: `#${v.language_id}`, is_active: 0 });
      }
    });
    return out;
  }, [activeLanguages, list]);

  const sizes = useMemo(() => {
    const out = (allSizes || []).filter(isActiveRow);
    const seen = new Set(out.map((s) => s.id));
    list.forEach((v) => {
      if (v.size_id != null && !seen.has(v.size_id)) {
        seen.add(v.size_id);
        out.push(
          (allSizes || []).find((s) => s.id === v.size_id) ||
            v.TemplateSize || { id: v.size_id, name: `#${v.size_id}` },
        );
      }
    });
    return out;
  }, [allSizes, list]);

  const { slug: defaultSlug, size: defaultSize } = useDefaultTemplateSize(allSizes);
  const english = findEnglish(activeLanguages) || findEnglish(languages);
  const mode = familyMode(list);
  const requiredIds = requiredLanguageIds({ versions: list, englishId: english?.id });
  const isRequiredRow = (languageId) => isRequiredLanguage(requiredIds, languageId);

  const byCell = useMemo(() => {
    const m = new Map();
    list.forEach((v) => m.set(cellKey(v.language_id, v.size_id), v));
    return m;
  }, [list]);

  // Active versions that satisfy the family publish gate. If a change removes
  // the last one from a live design, the API puts the design back to draft.
  const gateVersions = list.filter(
    (v) => v.status === 'active' && isRequiredRow(v.language_id),
  );
  const gateMet = gateVersions.length > 0;
  const wouldDropFamily = (v) =>
    family.status === 'active' &&
    gateVersions.length === 1 &&
    gateVersions[0].uid === v.uid;

  const withDropWarning = (v, action, run) => {
    if (!wouldDropFamily(v)) return run();
    modal.confirm({
      title: `${action} the version this design needs to stay live?`,
      content:
        'This is the design’s only active English (or text-free) version. The design will go back to draft and disappear from the app until another one is published.',
      okText: action,
      okButtonProps: { danger: true },
      onOk: run,
    });
    return undefined;
  };

  const rowDisabled = (languageId) =>
    languageId == null ? mode === 'languages' : mode === 'text_free';

  // ---- actions --------------------------------------------------------------

  const addVersion = async (languageId, size) => {
    const key = cellKey(languageId, size.id);
    setBusy(key);
    try {
      const created = await createVersion({
        familyUid,
        body: { family_id: family.id, language_id: languageId ?? null, size_id: size.id },
      }).unwrap();
      message.success('Version created as a draft — now upload its bundle');
      if (created?.uid) setBundleUid(created.uid);
    } catch (err) {
      const lines = detailLines(err);
      message.error(
        [err?.message || 'Could not create the version.', ...lines].filter(Boolean).join(' — '),
      );
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (v, status) => {
    setBusy(v.uid);
    try {
      await updateVersion({ uid: v.uid, familyUid, body: { status } }).unwrap();
      message.success(status === 'active' ? 'Version published' : 'Version unpublished');
    } catch (err) {
      const lines = detailLines(err);
      modal.error({
        title: err?.message || 'Could not change the version status.',
        content: lines.length ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const deleteVersion = (v) => {
    const run = async () => {
      try {
        await removeVersion({ uid: v.uid, familyUid }).unwrap();
        message.success('Version deleted');
      } catch (err) {
        message.error(err?.message || 'Could not delete the version.');
      }
    };
    modal.confirm({
      title: 'Delete this version?',
      content: (
        <Space direction="vertical" size={6}>
          <Text>
            Deletes the {isTextFree(v) ? 'text-free' : languageLabel(v.Language) || ''} ·{' '}
            {sizeLabel(v.TemplateSize) || 'size'} version and its bundle.
          </Text>
          {wouldDropFamily(v) && (
            <Text type="danger">
              It’s the only version keeping this design live — the design will go back to draft.
            </Text>
          )}
        </Space>
      ),
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: run,
    });
  };

  // ---- rendering ------------------------------------------------------------

  const emptyCell = (row, size) => {
    const key = cellKey(row.languageId, size.id);
    // Nudge toward the gate row only while it still has no active version.
    const required = isRequiredRow(row.languageId) && !gateMet;
    const disabled = rowDisabled(row.languageId);
    const box = {
      height: 132,
      borderRadius: 6,
      border: required ? '1px dashed #1677ff' : '1px dashed #d9d9d9',
      background: disabled ? '#f5f5f5' : undefined,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      padding: 6,
    };
    if (disabled) {
      return (
        <Tooltip
          title={
            row.languageId == null
              ? 'This design has language versions, so it can’t also have text-free ones.'
              : 'This design is text-free, so it can’t also have language versions.'
          }
        >
          <div style={box}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              —
            </Text>
          </div>
        </Tooltip>
      );
    }
    return (
      <div style={box}>
        {canCreate ? (
          <Button
            size="small"
            type={required ? 'primary' : 'dashed'}
            ghost={required}
            icon={<PlusOutlined />}
            loading={busy === key}
            disabled={busy !== null && busy !== key}
            onClick={() => addVersion(row.languageId, size)}
          >
            Add version
          </Button>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Empty
          </Text>
        )}
      </div>
    );
  };

  const filledCell = (v) => {
    const hasContent = isTrue(v.has_content);
    const hasThumb = isTrue(v.has_thumbnail) || Boolean(v.thumbnail_s3_key);
    const publishable = hasContent && hasThumb && v.size_id != null;
    const missing = [!hasContent && 'content', !hasThumb && 'thumbnail'].filter(Boolean);
    const items = [
      canUpdate && {
        key: 'bundle',
        icon: <CloudUploadOutlined />,
        label: hasContent ? 'Replace bundle…' : 'Upload bundle…',
      },
      canUpdate &&
        (v.status === 'active'
          ? { key: 'unpublish', icon: <StopOutlined />, label: 'Unpublish' }
          : {
              key: 'publish',
              icon: <CheckCircleOutlined />,
              label: publishable ? 'Publish' : `Publish (needs ${missing.join(' + ')})`,
              disabled: !publishable,
            }),
      canUpdate && { key: 'reslot', icon: <SwapOutlined />, label: 'Change language / size…' },
      canUpdate && { key: 'move', icon: <ExportOutlined />, label: 'Move to another design…' },
      canDelete && { type: 'divider' },
      canDelete && { key: 'delete', icon: <DeleteOutlined />, label: 'Delete version', danger: true },
    ].filter(Boolean);

    const onMenu = ({ key }) => {
      if (key === 'bundle') setBundleUid(v.uid);
      else if (key === 'publish') setStatus(v, 'active');
      else if (key === 'unpublish') withDropWarning(v, 'Unpublish', () => setStatus(v, 'inactive'));
      else if (key === 'reslot') setReslotFor(v);
      else if (key === 'move') setMoveFor(v);
      else if (key === 'delete') deleteVersion(v);
    };

    return (
      <div
        style={{
          height: 132,
          borderRadius: 6,
          border: '1px solid #f0f0f0',
          background: '#fff',
          padding: 6,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          position: 'relative',
          opacity: busy === v.uid ? 0.6 : 1,
        }}
      >
        <button
          type="button"
          onClick={() => canUpdate && setBundleUid(v.uid)}
          title={canUpdate ? 'Upload / replace bundle' : undefined}
          style={{
            border: 0,
            background: 'transparent',
            padding: 0,
            cursor: canUpdate ? 'pointer' : 'default',
          }}
        >
          <ImageThumb
            k={v.thumbnail_s3_key}
            size={64}
            placeholder={
              <div
                style={{
                  width: 64,
                  height: 64,
                  border: '1px dashed #d9d9d9',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: hasThumb ? '#52c41a' : '#faad14',
                }}
              >
                <PictureOutlined />
              </div>
            }
          />
        </button>
        <Space size={4}>
          <Tag color={STATUS_COLORS[v.status] || 'default'} style={{ marginInlineEnd: 0 }}>
            {v.status}
          </Tag>
          {items.length > 0 && (
            <Dropdown menu={{ items, onClick: onMenu }} trigger={['click']}>
              <Button size="small" type="text" icon={<MoreOutlined />} aria-label="Version actions" />
            </Dropdown>
          )}
        </Space>
        {missing.length > 0 && (
          <Text type="warning" style={{ fontSize: 11 }}>
            No {missing.join(' / ')}
          </Text>
        )}
      </div>
    );
  };

  const rows = [
    { key: TF, languageId: null, label: TEXT_FREE_LABEL, hint: 'No text, or symbols only' },
    ...languages.map((l) => ({
      key: String(l.id),
      languageId: l.id,
      label: languageLabel(l),
      hint: !isActiveRow(l) ? 'Language switched off' : undefined,
    })),
  ];

  // The gate row is tinted across every cell (incl. the fixed label cell, which
  // paints its own background, so a row-level style wouldn't reach it).
  const rowCell = (row) =>
    isRequiredRow(row.languageId) && !rowDisabled(row.languageId)
      ? { style: { background: REQUIRED_ROW_BG } }
      : {};

  const columns = [
    {
      title: '',
      key: 'lang',
      fixed: 'left',
      width: 150,
      onCell: (row) => {
        const cell = rowCell(row);
        return cell.style
          ? { style: { ...cell.style, borderInlineStart: REQUIRED_ROW_EDGE } }
          : cell;
      },
      render: (_v, row) => (
        <Space direction="vertical" size={2}>
          <Text strong type={rowDisabled(row.languageId) ? 'secondary' : undefined}>
            {row.label}
          </Text>
          {isRequiredRow(row.languageId) && !rowDisabled(row.languageId) && (
            <RequiredBadge met={gateMet} />
          )}
          {row.hint && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {row.hint}
            </Text>
          )}
        </Space>
      ),
    },
    ...sizes.map((s) => ({
      title: (
        <Space direction="vertical" size={0}>
          <Text strong>{s.name}</Text>
          <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
            {s.width && s.height ? `${s.width}×${s.height}` : ''}
            {s.platform ? ` · ${s.platform}` : ''}
            {!isActiveRow(s) ? ' · inactive' : ''}
          </Text>
          {defaultSize?.id === s.id && (
            <Tooltip title="The default size (App Settings). Catalogue cards show this size when a design has several. Not required for publishing.">
              <Tag
                icon={<StarFilled style={{ color: '#faad14' }} />}
                style={{ marginInlineEnd: 0, marginTop: 2, fontSize: 10, lineHeight: '16px', fontWeight: 400 }}
              >
                Preferred on cards
              </Tag>
            </Tooltip>
          )}
        </Space>
      ),
      key: `size-${s.id}`,
      width: 150,
      onCell: rowCell,
      render: (_v, row) => {
        const v = byCell.get(cellKey(row.languageId, s.id));
        return v ? filledCell(v) : emptyCell(row, s);
      },
    })),
  ];

  const bundleVersion = bundleUid ? list.find((v) => v.uid === bundleUid) : null;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <GridLegend
        defaultSlug={defaultSlug}
        defaultSize={defaultSize}
        english={english}
        mode={mode}
        canReadLanguages={canReadLanguages}
      />
      <Table
        rowKey="key"
        size="small"
        bordered
        pagination={false}
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 'max-content' }}
      />

      <Modal
        open={Boolean(bundleUid)}
        title={
          bundleVersion
            ? `Bundle — ${isTextFree(bundleVersion) ? TEXT_FREE_LABEL : languageLabel(bundleVersion.Language)} · ${sizeLabel(bundleVersion.TemplateSize)}`
            : 'Bundle'
        }
        width={760}
        footer={null}
        onCancel={() => setBundleUid(null)}
        destroyOnClose
      >
        {bundleUid && (
          <TemplateBundlePanel
            uid={bundleUid}
            familyUid={familyUid}
            thumbnailKey={bundleVersion?.thumbnail_s3_key}
            hasContent={isTrue(bundleVersion?.has_content)}
          />
        )}
      </Modal>

      <MoveVersionModal
        open={Boolean(moveFor)}
        version={moveFor}
        familyUid={familyUid}
        onClose={() => setMoveFor(null)}
        onMoved={() => setMoveFor(null)}
      />

      <ReslotModal
        version={reslotFor}
        versions={list}
        languages={languages}
        sizes={sizes}
        familyUid={familyUid}
        onClose={() => setReslotFor(null)}
        confirmDrop={(v, run) => withDropWarning(v, 'Change', run)}
      />
    </Space>
  );
}

function RequiredBadge({ met }) {
  return (
    <Tooltip title="To publish, the design needs an active version in this row — any size counts.">
      <Tag
        color={met ? 'success' : 'blue'}
        style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: '16px' }}
      >
        {met ? 'Required ✓' : 'Required'}
      </Tag>
    </Tooltip>
  );
}

function GridLegend({ defaultSlug, defaultSize, english, mode, canReadLanguages }) {
  return (
    <Space direction="vertical" size={6} style={{ width: '100%' }}>
      <Paragraph type="secondary" style={{ margin: 0 }}>
        One version per language and size. A design is either <Text strong>text-free</Text> or has{' '}
        <Text strong>language</Text> versions — never both. To publish, the highlighted row needs an
        active version in <Text strong>any</Text> size
        {mode === 'none' ? ' (English, or text-free for a design with no text)' : ''}. The column
        marked “Preferred on cards” is only what the app shows first when a design has several
        sizes.
      </Paragraph>
      {defaultSlug && !defaultSize && (
        <Alert
          type="info"
          showIcon
          message={`The default size “${defaultSlug}” (App Settings) doesn’t match any template size, so cards just use each design’s other sizes. Publishing isn’t affected.`}
        />
      )}
      {!canReadLanguages && (
        <Alert
          type="warning"
          showIcon
          message="You can’t read Languages, so only the languages already used by this design are shown."
        />
      )}
      {canReadLanguages && !english && mode !== 'text_free' && (
        <Alert
          type="warning"
          showIcon
          message="No active language with code “en” was found — the English version the publish rule needs can’t be added."
        />
      )}
    </Space>
  );
}

/** Change a version's language and/or size. 409 when the slot is taken. */
function ReslotModal({ version, versions, languages, sizes, familyUid, onClose, confirmDrop }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [updateVersion, { isLoading }] = adminApi.endpoints.templateVersionUpdate.useMutation();
  const [error, setError] = useState(null);
  const languageId = Form.useWatch('language_id', form);
  const sizeId = Form.useWatch('size_id', form);

  const others = (versions || []).filter((v) => v.uid !== version?.uid);
  const othersMode = familyMode(others);
  const taken = new Set(others.map((v) => cellKey(v.language_id, v.size_id)));
  const LANG_TF = '__text_free__';
  const langValue = (id) => (id == null ? LANG_TF : id);
  const langFromValue = (val) => (val === LANG_TF ? null : val);

  useEffect(() => {
    if (version) setError(null);
  }, [version]);

  const selectedLang = langFromValue(languageId);
  const slotTaken = sizeId != null && taken.has(cellKey(selectedLang, sizeId));
  const unchanged =
    version && selectedLang === (version.language_id ?? null) && sizeId === version.size_id;

  const submit = () => {
    const body = { language_id: selectedLang, size_id: sizeId };
    const run = async () => {
      setError(null);
      try {
        await updateVersion({ uid: version.uid, familyUid, body }).unwrap();
        message.success('Version moved to the new slot');
        onClose();
      } catch (err) {
        const lines = detailLines(err);
        setError([err?.message || 'Could not change the version.', ...lines].join(' — '));
      }
    };
    // Re-slotting the gate version out of its slot can take a live design down.
    if (version && confirmDrop) confirmDrop(version, run);
    else run();
  };

  return (
    <Modal
      open={Boolean(version)}
      title="Change language / size"
      okText="Save"
      onCancel={onClose}
      onOk={submit}
      confirmLoading={isLoading}
      okButtonProps={{ disabled: unchanged || slotTaken || sizeId == null }}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={
          version
            ? { language_id: langValue(version.language_id), size_id: version.size_id }
            : undefined
        }
      >
        <Form.Item name="language_id" label="Language">
          <Select
            showSearch
            optionFilterProp="label"
            options={[
              {
                label: TEXT_FREE_LABEL,
                value: LANG_TF,
                disabled: othersMode === 'languages',
              },
              ...languages.map((l) => ({
                label: languageLabel(l),
                value: l.id,
                disabled: othersMode === 'text_free',
              })),
            ]}
          />
        </Form.Item>
        <Form.Item name="size_id" label="Size">
          <Select
            showSearch
            optionFilterProp="label"
            options={sizes.map((s) => ({
              label: `${sizeLabel(s)}${taken.has(cellKey(selectedLang, s.id)) ? ' — taken' : ''}`,
              value: s.id,
              disabled: taken.has(cellKey(selectedLang, s.id)),
            }))}
          />
        </Form.Item>
      </Form>
      {othersMode !== 'none' && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {othersMode === 'languages'
            ? 'The other versions have languages, so this one can’t become text-free.'
            : 'The other versions are text-free, so this one can’t get a language.'}
        </Text>
      )}
      {slotTaken && <Alert style={{ marginTop: 8 }} type="warning" showIcon message="That slot already has a version." />}
      {error && <Alert style={{ marginTop: 8 }} type="error" showIcon message={error} />}
    </Modal>
  );
}
