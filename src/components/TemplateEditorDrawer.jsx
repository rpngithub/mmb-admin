import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Drawer,
  Tabs,
  Form,
  Input,
  Select,
  Switch,
  Button,
  Space,
  Spin,
  Alert,
  Tag,
  Tooltip,
  Descriptions,
  Divider,
  Typography,
  App,
} from 'antd';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import { adminApi } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import { checkTemplateCompleteness, FIELD_TO_KEY } from '../lib/templateCompleteness';
import TemplateBundlePanel from './TemplateBundlePanel';
import ImageThumb from './ImageThumb';

const { Text, Paragraph } = Typography;

const TEMPLATE_TYPES = ['image', 'video', 'animated'];
const STATUS_COLORS = { active: 'green', inactive: 'default', draft: 'gold' };
const isTrue = (v) => v === true || v === 1 || v === '1';

/**
 * The empty language choice is MEANINGFUL, so it is never a blank row: NULL means
 * language-NEUTRAL (a design with no text, or symbols only) and is shown to every
 * user whatever they picked — it does not mean "not tagged yet". Getting it wrong
 * costs in both directions: tagging a text-free design as English hides it from
 * everyone else, and leaving a Tamil design as "Any" shows Tamil text to Hindi
 * users. Exported so the list column renders the same wording.
 */
export const ANY_LANGUAGE_LABEL = 'Any / no text';

/**
 * Tabbed template editor: Details (metadata-only create/update), Bundle (ZIP
 * ingest), Relations (tags/sizes/variants/industries, auto-saved), Publish.
 * Bundle & Relations need a uid, so for a new template you save Details first;
 * the drawer then keeps that uid and enables the other tabs.
 *
 * Status is NOT editable on Details — a template is created as a draft and only
 * the Publish tab can move it, so the completeness gate there can't be bypassed.
 */
export default function TemplateEditorDrawer({ open, uid, onClose, onSaved }) {
  const [workingUid, setWorkingUid] = useState(uid || null);
  const [tab, setTab] = useState('details');

  useEffect(() => {
    if (open) {
      setWorkingUid(uid || null);
      setTab('details');
    }
  }, [open, uid]);

  const isCreate = !workingUid;

  return (
    <Drawer
      title={isCreate ? 'New Template' : 'Edit Template'}
      open={open}
      onClose={onClose}
      width={720}
      destroyOnClose
    >
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'details',
            label: 'Details',
            children: (
              <DetailsForm
                uid={workingUid}
                onCreated={(newUid) => {
                  setWorkingUid(newUid);
                  setTab('bundle');
                  onSaved?.();
                }}
                onSaved={onSaved}
              />
            ),
          },
          {
            key: 'bundle',
            label: 'Bundle',
            disabled: isCreate,
            children: workingUid ? (
              <BundleTab uid={workingUid} onSaved={onSaved} />
            ) : (
              <NeedsUid />
            ),
          },
          {
            key: 'relations',
            label: 'Relations',
            disabled: isCreate,
            children: workingUid ? <RelationsPanel uid={workingUid} /> : <NeedsUid />,
          },
          {
            key: 'publish',
            label: 'Publish',
            disabled: isCreate,
            children: workingUid ? (
              <PublishPanel uid={workingUid} onSaved={onSaved} onGoToTab={setTab} />
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
  return <Alert type="info" showIcon message="Save the template details first to unlock this step." />;
}

// ---- Details (metadata only) ----------------------------------------------

function DetailsForm({ uid, onCreated, onSaved }) {
  const { message } = App.useApp();
  const perms = usePermissions();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const isEdit = Boolean(uid);

  const { data: categories } = adminApi.endpoints.templateCategoriesList.useQuery();
  // Only live languages may be assigned; the picker must not offer a language
  // that has been switched off in the app. Skipped (and the field withheld) when
  // the admin can't read languages, so we neither 403 nor let them blank out a
  // tag they can't see.
  const canReadLanguages = perms.canRead('languages');
  const { data: languages } = adminApi.endpoints.languagesFiltered.useQuery(
    { is_active: 1 },
    { skip: !canReadLanguages },
  );
  const { data: full, isFetching } = adminApi.endpoints.templateGet.useQuery(uid, { skip: !uid });
  const [createTemplate] = adminApi.endpoints.templateCreate.useMutation();
  const [updateTemplate] = adminApi.endpoints.templateUpdate.useMutation();

  useEffect(() => {
    if (isEdit && full) {
      form.setFieldsValue({
        name: full.name,
        category_id: full.category_id ?? undefined,
        template_type: full.template_type ?? undefined,
        // null is a real choice ("Any / no text"), so it maps to the null option
        // rather than to an empty Select.
        language_id: full.language_id ?? null,
        is_premium: isTrue(full.is_premium),
      });
    } else if (!isEdit) {
      form.resetFields();
      form.setFieldsValue({ is_premium: false, language_id: null });
    }
  }, [isEdit, full, form]);

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    // Metadata only — never content/thumbnail/counters/created_by. `status` is
    // owned by the Publish tab: created as draft, never touched on update.
    const body = {
      name: values.name.trim(),
      category_id: values.category_id ?? null,
      template_type: values.template_type,
      is_premium: values.is_premium ? 1 : 0,
    };
    // Omitted entirely when the picker isn't shown — sending null would silently
    // clear a tag the admin was never able to see.
    if (canReadLanguages) body.language_id = values.language_id ?? null;
    setSubmitting(true);
    try {
      if (isEdit) {
        await updateTemplate({ id: uid, body }).unwrap();
        message.success('Details saved');
        onSaved?.();
      } else {
        // No `status` on create — the API rejects it and always makes a draft.
        const created = await createTemplate(body).unwrap();
        message.success('Draft created — now upload its bundle');
        onCreated?.(created.uid);
      }
    } catch {
      // error notification handled by baseQuery
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Spin spinning={isEdit && isFetching}>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Name is required' }]}>
          <Input placeholder="Template name" />
        </Form.Item>
        <Form.Item
          name="category_id"
          label="Category"
          extra="Category or Industry is required before publishing — Industry is on the Relations tab."
        >
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Uncategorized"
            options={(categories || []).map((c) => ({ label: c.name, value: c.id }))}
          />
        </Form.Item>
        <Form.Item name="template_type" label="Type">
          <Select
            allowClear
            placeholder="Select a type"
            options={TEMPLATE_TYPES.map((t) => ({ label: t, value: t }))}
          />
        </Form.Item>
        {canReadLanguages && (
          <Form.Item
            name="language_id"
            label="Language"
            extra={`Leave as “${ANY_LANGUAGE_LABEL}” for designs with no text. Otherwise pick the language the text is written in.`}
          >
            {/* No allowClear: the empty state is an explicit, labelled option,
                not a cleared field — clearing to `undefined` would read as
                "not set", which is precisely what NULL does not mean. */}
            <Select
              showSearch
              optionFilterProp="label"
              options={[
                { label: ANY_LANGUAGE_LABEL, value: null },
                ...(languages || []).map((l) => ({
                  label: `${l.native_name} (${l.name})`,
                  value: l.id,
                })),
              ]}
            />
          </Form.Item>
        )}
        <Form.Item name="is_premium" label="Premium" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          New templates are created as <Text code>draft</Text>. Publishing happens on the Publish tab,
          once the bundle, thumbnail, sizes and tags are in place.
        </Paragraph>
        <Button type="primary" loading={submitting} onClick={handleSubmit}>
          {isEdit ? 'Save details' : 'Create template'}
        </Button>
      </Form>
    </Spin>
  );
}

// ---- Bundle ----------------------------------------------------------------

function BundleTab({ uid, onSaved }) {
  const { data: full } = adminApi.endpoints.templateGet.useQuery(uid, { skip: !uid });
  return (
    <TemplateBundlePanel
      uid={uid}
      thumbnailKey={full?.thumbnail_s3_key}
      hasContent={Boolean(full?.content)}
      onConfirmed={onSaved}
    />
  );
}

// ---- Relations (auto-saved) ------------------------------------------------

// Local picker key → the request key it maps to. The PUT is a per-key full
// replace, so each picker saves on its own without touching the others.
const RELATION_KEYS = {
  tags: 'tag_ids',
  sizes: 'size_ids',
  // Themes were renamed to Variants, but the template-side relation key wasn't
  // covered by the rename brief — so we keep sending the still-accepted
  // `theme_ids` alias and read whichever association key comes back. Switch to
  // `variant_ids` once the API side confirms it.
  variants: 'theme_ids',
  business: 'industry_ids',
};
const SAVE_DEBOUNCE_MS = 600;

const relationsToValue = (relations) => ({
  tags: (relations?.Tags || []).map((t) => t.id),
  sizes: (relations?.TemplateSizes || []).map((s) => s.id),
  variants: (relations?.Variants || relations?.Themes || []).map((t) => t.id),
  // GET now returns `Industries`; `BusinessCategories` is a deprecated duplicate.
  business: (relations?.Industries || relations?.BusinessCategories || []).map((b) => b.id),
});

function RelationsPanel({ uid }) {
  const { message } = App.useApp();
  const { data: relations, isFetching } = adminApi.endpoints.templateRelations.useQuery(uid, {
    skip: !uid,
  });
  const { data: tags } = adminApi.endpoints.tagsList.useQuery();
  const { data: sizes } = adminApi.endpoints.templateSizesList.useQuery();
  const { data: variants } = adminApi.endpoints.variantsList.useQuery();
  const { data: businessCategories } = adminApi.endpoints.businessCategoriesList.useQuery();
  const [setRelations] = adminApi.endpoints.templateSetRelations.useMutation();

  const [value, setValue] = useState({ tags: [], sizes: [], variants: [], business: [] });
  const [saveState, setSaveState] = useState({}); // key → 'saving' | 'saved'

  const serverRef = useRef({ tags: [], sizes: [], variants: [], business: [] }); // last known-good
  const pendingRef = useRef({}); // key → ids awaiting (or mid-) save
  const timersRef = useRef({});
  const savedTimersRef = useRef({});

  useEffect(() => {
    if (!relations) return;
    const server = relationsToValue(relations);
    serverRef.current = server;
    // A refetch must not clobber a picker the admin is still editing.
    setValue((prev) => {
      const next = { ...server };
      Object.entries(pendingRef.current).forEach(([k, ids]) => {
        if (ids) next[k] = ids;
      });
      return { ...prev, ...next };
    });
  }, [relations]);

  const save = useCallback(
    async (key, ids) => {
      setSaveState((s) => ({ ...s, [key]: 'saving' }));
      try {
        await setRelations({ uid, body: { [RELATION_KEYS[key]]: ids } }).unwrap();
        serverRef.current = { ...serverRef.current, [key]: ids };
        delete pendingRef.current[key];
        setSaveState((s) => ({ ...s, [key]: 'saved' }));
        clearTimeout(savedTimersRef.current[key]);
        savedTimersRef.current[key] = setTimeout(
          () => setSaveState((s) => ({ ...s, [key]: undefined })),
          2000,
        );
      } catch (err) {
        // The endpoint is `silent`, so we own the messaging — and we roll the
        // picker back to whatever the server last confirmed.
        delete pendingRef.current[key];
        setValue((v) => ({ ...v, [key]: serverRef.current[key] || [] }));
        setSaveState((s) => ({ ...s, [key]: undefined }));
        message.error(err?.message || 'Could not save — reverted.');
      }
    },
    [setRelations, uid, message],
  );

  const onPick = (key) => (ids) => {
    setValue((v) => ({ ...v, [key]: ids }));
    pendingRef.current[key] = ids;
    clearTimeout(timersRef.current[key]);
    timersRef.current[key] = setTimeout(() => save(key, ids), SAVE_DEBOUNCE_MS);
  };

  // Closing the drawer mid-debounce must not silently drop the edit.
  useEffect(
    () => () => {
      Object.values(timersRef.current).forEach(clearTimeout);
      Object.values(savedTimersRef.current).forEach(clearTimeout);
      Object.entries(pendingRef.current).forEach(([k, ids]) => {
        if (ids) setRelations({ uid, body: { [RELATION_KEYS[k]]: ids } });
      });
      pendingRef.current = {};
    },
    [setRelations, uid],
  );

  const tagOptions = (tags || []).map((x) => ({ label: x.name, value: x.id }));
  const sizeOptions = (sizes || []).map((s) => ({
    label: `${s.name} (${s.width}×${s.height})`,
    value: s.id,
  }));
  const variantOptions = (variants || []).map((x) => ({ label: x.name, value: x.id }));
  const businessOptions = (businessCategories || []).map((x) => ({ label: x.name, value: x.id }));

  const field = (label, key, options, required) => (
    <div>
      <Space size={8}>
        <Text type="secondary">{label}</Text>
        {required && value[key].length === 0 && <Tag color="warning">required to publish</Tag>}
        {saveState[key] === 'saving' && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            <LoadingOutlined /> Saving…
          </Text>
        )}
        {saveState[key] === 'saved' && (
          <Text type="success" style={{ fontSize: 12 }}>
            <CheckOutlined /> Saved
          </Text>
        )}
      </Space>
      <Select
        mode="multiple"
        allowClear
        style={{ width: '100%', marginTop: 4 }}
        value={value[key]}
        onChange={onPick(key)}
        options={options}
        optionFilterProp="label"
        placeholder={`Select ${label.toLowerCase()}`}
      />
    </div>
  );

  return (
    <Spin spinning={isFetching}>
      <Space direction="vertical" style={{ width: '100%' }} size={14}>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          Each picker saves itself as you select — no save button. Every picker is a full replace of
          that one relation; Category is set on the Details tab, not here.
        </Paragraph>
        {field('Tags', 'tags', tagOptions, true)}
        {field('Sizes', 'sizes', sizeOptions, true)}
        {field('Variants', 'variants', variantOptions)}
        {field('Industries', 'business', businessOptions)}
      </Space>
    </Spin>
  );
}

// ---- Publish ---------------------------------------------------------------

function ChipList({ items }) {
  if (!items?.length) return <Text type="secondary">—</Text>;
  return (
    <Space size={[4, 4]} wrap>
      {items.map((i) => (
        <Tag key={i.key}>{i.label}</Tag>
      ))}
    </Space>
  );
}

function PublishPanel({ uid, onSaved, onGoToTab }) {
  const { message } = App.useApp();
  const perms = usePermissions();
  const { data: full, isFetching } = adminApi.endpoints.templateGet.useQuery(uid, { skip: !uid });
  const { data: relations, isFetching: relFetching } = adminApi.endpoints.templateRelations.useQuery(
    uid,
    { skip: !uid },
  );
  const { data: categories } = adminApi.endpoints.templateCategoriesList.useQuery();
  const { data: languages } = adminApi.endpoints.languagesFiltered.useQuery(
    { is_active: 1 },
    { skip: !perms.canRead('languages') },
  );
  const [updateTemplate, { isLoading }] = adminApi.endpoints.templateUpdate.useMutation();

  const status = full?.status || 'draft';
  const { items, missing, complete } = checkTemplateCompleteness(full, relations);
  const [serverErrors, setServerErrors] = useState({}); // requirement key → message

  const categoryName =
    (categories || []).find((c) => c.id === full?.category_id)?.name ||
    (full?.category_id ? `#${full.category_id}` : null);

  const setStatus = async (next) => {
    setServerErrors({});
    try {
      await updateTemplate({ id: uid, body: { status: next } }).unwrap();
      message.success(`Status set to ${next}`);
      onSaved?.();
    } catch (err) {
      // The server runs the same checklist; map its 400 details[] back onto our
      // rows so the rejection reads inline rather than only as a toast.
      const details = Array.isArray(err?.details) ? err.details : [];
      const mapped = {};
      details.forEach((d) => {
        const key = FIELD_TO_KEY[d.field];
        if (key) mapped[key] = d.message;
      });
      setServerErrors(mapped);
    }
  };

  const chips = (list, labelOf = (x) => x.name) =>
    (list || []).map((x) => ({ key: x.id, label: labelOf(x) }));

  return (
    <Spin spinning={isFetching || relFetching}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space>
          <Text>Current status:</Text>
          <Tag color={STATUS_COLORS[status] || 'default'}>{status}</Tag>
        </Space>

        <Space align="start" size={16}>
          <div
            style={{
              width: 96,
              height: 96,
              flex: '0 0 auto',
              border: '1px dashed #d9d9d9',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#fafafa',
            }}
          >
            {full?.thumbnail_s3_key ? (
              <ImageThumb k={full.thumbnail_s3_key} size={88} alt="thumbnail" />
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                no thumbnail
              </Text>
            )}
          </div>
          <Descriptions
            size="small"
            column={1}
            style={{ minWidth: 320 }}
            items={[
              { key: 'name', label: 'Name', children: full?.name || <Text type="secondary">—</Text> },
              {
                key: 'category',
                label: 'Category',
                children: categoryName || <Text type="secondary">Uncategorized</Text>,
              },
              {
                key: 'type',
                label: 'Type',
                children: full?.template_type || <Text type="secondary">—</Text>,
              },
              {
                key: 'language',
                label: 'Language',
                children: full?.language_id ? (
                  (() => {
                    const lang = (languages || []).find((l) => l.id === full.language_id);
                    return lang ? `${lang.native_name} (${lang.name})` : `#${full.language_id}`;
                  })()
                ) : (
                  <Tooltip title="Language-neutral — shown to every user regardless of their preferred languages.">
                    <Tag>{ANY_LANGUAGE_LABEL}</Tag>
                  </Tooltip>
                ),
              },
              {
                key: 'premium',
                label: 'Premium',
                children: isTrue(full?.is_premium) ? (
                  <Tag color="gold">Premium</Tag>
                ) : (
                  <Text type="secondary">Free</Text>
                ),
              },
              {
                key: 'bundle',
                label: 'Bundle',
                children: full?.content ? (
                  <Tag color="green">Content saved</Tag>
                ) : (
                  <Tag>No content</Tag>
                ),
              },
            ]}
          />
        </Space>

        <Descriptions
          size="small"
          column={1}
          bordered
          items={[
            { key: 'tags', label: 'Tags', children: <ChipList items={chips(relations?.Tags)} /> },
            {
              key: 'sizes',
              label: 'Sizes',
              children: (
                <ChipList
                  items={chips(relations?.TemplateSizes, (s) =>
                    s.width && s.height ? `${s.name} (${s.width}×${s.height})` : s.name,
                  )}
                />
              ),
            },
            {
              key: 'variants',
              label: 'Variants',
              children: <ChipList items={chips(relations?.Variants || relations?.Themes)} />,
            },
            {
              key: 'industries',
              label: 'Industries',
              children: (
                <ChipList items={chips(relations?.Industries || relations?.BusinessCategories)} />
              ),
            },
          ]}
        />

        <Divider style={{ margin: '4px 0' }} />

        <div>
          <Text strong>Ready to publish?</Text>
          <Space direction="vertical" size={4} style={{ width: '100%', marginTop: 8 }}>
            {items.map((item) => (
              <Space key={item.key} size={8}>
                {item.ok ? (
                  <CheckCircleFilled style={{ color: '#52c41a' }} />
                ) : (
                  <CloseCircleFilled style={{ color: '#ff4d4f' }} />
                )}
                <Text type={item.ok ? undefined : 'danger'}>{item.label}</Text>
                {!item.ok && (
                  <>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {serverErrors[item.key] || item.hint}
                    </Text>
                    <Button type="link" size="small" onClick={() => onGoToTab?.(item.tab)}>
                      Go to {item.tab}
                    </Button>
                  </>
                )}
              </Space>
            ))}
          </Space>
        </div>

        <Paragraph type="secondary" style={{ margin: 0 }}>
          Publish makes the template active and visible. You can move it back to inactive or draft.
        </Paragraph>

        <Space wrap>
          <Tooltip
            title={
              complete
                ? undefined
                : `Missing: ${missing.map((m) => m.label).join(', ')}`
            }
          >
            <Button
              type="primary"
              loading={isLoading}
              disabled={status === 'active' || !complete}
              onClick={() => setStatus('active')}
            >
              Publish (active)
            </Button>
          </Tooltip>
          <Button
            loading={isLoading}
            disabled={status === 'inactive'}
            onClick={() => setStatus('inactive')}
          >
            Unpublish (inactive)
          </Button>
          <Button
            loading={isLoading}
            disabled={status === 'draft'}
            onClick={() => setStatus('draft')}
          >
            Back to draft
          </Button>
        </Space>
      </Space>
    </Spin>
  );
}
