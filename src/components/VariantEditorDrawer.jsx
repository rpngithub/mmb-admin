import { useEffect, useMemo, useState } from 'react';
import {
  Drawer,
  Tabs,
  Form,
  Input,
  InputNumber,
  Switch,
  Select,
  Button,
  Space,
  Spin,
  Alert,
  Tag,
  Typography,
  App,
} from 'antd';
import { adminApi } from '../features/api/adminApi';
import ImageUploadField from './ImageUploadField';
import { DEACTIVATE_EXPLAINER, toAmount } from '../lib/variants';
import { applyPackServerError } from '../lib/quotaPacks';

const { Text, Paragraph } = Typography;
const isTrue = (v) => v === true || v === 1 || v === '1';
const isActiveStatus = (s) => s === 'active';

/**
 * Tabbed variant editor:
 *   • Details — name, description, brand series, badge, thumbnail, price,
 *     strike price, likes_count, order, active.
 *   • Industries — display/filter tags (`industry_ids`).
 *   • Designs — the template families assigned to this variant (`family_ids`).
 *
 * There is no plan access control: every variant is shown to everyone, and a
 * user uses one by adding it to their business while subscribed or by buying
 * it (see lib/variants). `plan_ids` is deprecated and never sent.
 *
 * Industries and Designs need a variant uid, so for a NEW variant you save
 * Details first; the drawer keeps that uid and unlocks the rest.
 * `defaultSeriesId` pre-selects the brand series when creating from a series panel.
 */
export default function VariantEditorDrawer({ open, variant, defaultSeriesId, onClose, onSaved }) {
  const [workingUid, setWorkingUid] = useState(variant?.uid || null);
  const [tab, setTab] = useState('details');

  useEffect(() => {
    if (open) {
      setWorkingUid(variant?.uid || null);
      setTab('details');
    }
  }, [open, variant]);

  const isCreate = !workingUid;

  return (
    <Drawer
      title={isCreate ? 'New Variant' : `Edit "${variant?.name ?? 'Variant'}"`}
      open={open}
      onClose={onClose}
      width={680}
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
                defaultSeriesId={defaultSeriesId}
                onCreated={(newUid) => {
                  setWorkingUid(newUid);
                  setTab('templates');
                  onSaved?.();
                }}
                onSaved={onSaved}
              />
            ),
          },
          {
            key: 'business',
            label: 'Industries',
            disabled: isCreate,
            children: workingUid ? <BusinessPanel uid={workingUid} /> : <NeedsUid />,
          },
          {
            key: 'templates',
            label: 'Designs',
            disabled: isCreate,
            children: workingUid ? <TemplatesPanel uid={workingUid} /> : <NeedsUid />,
          },
        ]}
      />
    </Drawer>
  );
}

function NeedsUid() {
  return <Alert type="info" showIcon message="Save the variant details first to unlock this step." />;
}

// ---- Details ---------------------------------------------------------------

// Form items a 400's details[].field can be pinned to.
const DETAIL_FIELDS = [
  'name',
  'description',
  'series_id',
  'badge_id',
  'thumbnail_s3_key',
  'price',
  'strike_price',
  'likes_count',
  'display_order',
  'is_active',
];

function detailValuesFrom(full, defaultSeriesId) {
  if (!full) {
    return {
      is_active: true,
      likes_count: 0,
      display_order: 0,
      series_id: defaultSeriesId ?? undefined,
      price: undefined,
      strike_price: undefined,
    };
  }
  return {
    series_id: full.series_id,
    badge_id: full.badge_id ?? undefined,
    name: full.name,
    description: full.description ?? '',
    thumbnail_s3_key: full.thumbnail_s3_key ?? undefined,
    // DECIMAL strings ("499.00") or null — InputNumber needs numbers.
    price: toAmount(full.price) ?? undefined,
    strike_price: toAmount(full.strike_price) ?? undefined,
    likes_count: full.likes_count ?? 0,
    display_order: full.display_order ?? 0,
    is_active: isTrue(full.is_active),
  };
}

function detailBodyFrom(values) {
  const description = values.description?.trim();
  return {
    series_id: values.series_id,
    badge_id: values.badge_id ?? null,
    name: (values.name || '').trim(),
    description: description ? description : null,
    thumbnail_s3_key: values.thumbnail_s3_key ?? null,
    // Empty = not for sale: null is the only way to clear it.
    price: toAmount(values.price),
    strike_price: toAmount(values.strike_price),
    likes_count: values.likes_count ?? 0,
    display_order: values.display_order ?? 0,
    is_active: values.is_active ? 1 : 0,
  };
}

// API rule: null or ≥ 1, at most two decimals (the inputs' precision={2}
// covers the decimals).
const moneyRule = {
  validator: (_r, v) =>
    v === null || v === undefined || v === '' || Number(v) >= 1
      ? Promise.resolve()
      : Promise.reject(new Error('Must be at least ₹1 — or leave empty')),
};

function DetailsForm({ uid, defaultSeriesId, onCreated, onSaved }) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const isEdit = Boolean(uid);

  const { data: seriesList } = adminApi.endpoints.brandSeriesList.useQuery();
  const { data: badges } = adminApi.endpoints.variantBadgesList.useQuery();
  const { data: full, isFetching } = adminApi.endpoints.variantsGet.useQuery(uid, { skip: !uid });
  const [createVariant] = adminApi.endpoints.variantCreate.useMutation();
  const [updateVariant] = adminApi.endpoints.variantUpdate.useMutation();

  const price = toAmount(Form.useWatch('price', form));
  const strikePrice = toAmount(Form.useWatch('strike_price', form));

  useEffect(() => {
    setFormError(null);
    if (isEdit && full) {
      form.setFieldsValue(detailValuesFrom(full));
    } else if (!isEdit) {
      form.resetFields();
      form.setFieldsValue(detailValuesFrom(null, defaultSeriesId));
    }
  }, [isEdit, full, defaultSeriesId, form]);

  const seriesOptions = (seriesList || []).map((s) => ({ label: s.name, value: s.id }));
  const badgeOptions = (badges || []).map((b) => ({ label: b.name, value: b.id }));

  const save = async (body) => {
    setSubmitting(true);
    setFormError(null);
    try {
      if (isEdit) {
        await updateVariant({ uid, body }).unwrap();
        message.success('Details saved');
        onSaved?.();
      } else {
        const created = await createVariant(body).unwrap();
        message.success('Variant created — now assign its designs');
        onCreated?.(created.uid);
      }
    } catch (err) {
      setFormError(applyPackServerError(form, err, DETAIL_FIELDS));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const next = detailBodyFrom(values);
    if (!isEdit) {
      // Create: an unset price simply isn't for sale — no need to send nulls.
      if (next.price === null) delete next.price;
      if (next.strike_price === null) delete next.strike_price;
      await save(next);
      return;
    }

    // PATCH is partial: send only what moved.
    const before = detailBodyFrom(detailValuesFrom(full));
    const body = {};
    for (const key of Object.keys(next)) {
      if (next[key] !== before[key]) body[key] = next[key];
    }
    if (Object.keys(body).length === 0) {
      message.info('Nothing to save — no fields changed.');
      return;
    }

    if (body.is_active === 0) {
      modal.confirm({
        title: 'Deactivate this variant?',
        content: DEACTIVATE_EXPLAINER,
        okText: 'Deactivate',
        onOk: () => save(body),
      });
      return;
    }
    await save(body);
  };

  return (
    <Spin spinning={isEdit && isFetching}>
      {formError && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={formError} />}
      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label="Name"
          rules={[{ required: true, message: 'Name is required' }]}
        >
          <Input placeholder="e.g. Lemon Buzz-01" />
        </Form.Item>

        <Form.Item name="description" label="Description">
          <Input.TextArea rows={3} placeholder="Shown on the variant card" />
        </Form.Item>

        <Form.Item
          name="series_id"
          label="Brand series"
          rules={[{ required: true, message: 'Brand series is required' }]}
        >
          <Select
            options={seriesOptions}
            showSearch
            optionFilterProp="label"
            placeholder="Select a brand series"
          />
        </Form.Item>

        <Form.Item name="badge_id" label="Badge" tooltip="The chip on the variant card">
          <Select
            options={badgeOptions}
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="No badge"
          />
        </Form.Item>

        <Form.Item name="thumbnail_s3_key" label="Thumbnail">
          <ImageUploadField slot="variant_thumbnail" />
        </Form.Item>

        <Space size="large" align="start" wrap>
          <Form.Item
            name="price"
            label="Price (excl. GST)"
            rules={[moneyRule]}
            extra={
              price !== null
                ? `Customer pays ₹${(price * 1.18).toFixed(2)} incl. GST`
                : 'Empty = not for sale.'
            }
          >
            <InputNumber min={0} precision={2} prefix="₹" style={{ width: 200 }} placeholder="—" />
          </Form.Item>

          <Form.Item
            name="strike_price"
            label="Strike-through price"
            rules={[moneyRule]}
            extra="Display only — the “was” figure struck out beside the price."
          >
            <InputNumber min={0} precision={2} prefix="₹" style={{ width: 200 }} placeholder="—" />
          </Form.Item>
        </Space>

        {price !== null && strikePrice !== null && strikePrice <= price && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="The strike-through price is not above the price, so it won’t read as a discount."
          />
        )}
        {isEdit && full && toAmount(full.price) !== null && price === null && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="Saving with no price takes this variant off sale. People who already bought it keep it."
          />
        )}

        <Space size="large" align="start" wrap>
          <Form.Item
            name="likes_count"
            label="Likes (❤️)"
            tooltip="The heart figure on the variant card"
          >
            <InputNumber min={0} style={{ width: 160 }} />
          </Form.Item>

          <Form.Item name="display_order" label="Display order">
            <InputNumber min={0} style={{ width: 160 }} />
          </Form.Item>

          <Form.Item
            name="is_active"
            label="Active"
            valuePropName="checked"
            tooltip={DEACTIVATE_EXPLAINER}
          >
            <Switch />
          </Form.Item>
        </Space>

        <div>
          <Button type="primary" loading={submitting} onClick={handleSubmit}>
            {isEdit ? 'Save details' : 'Create variant'}
          </Button>
        </div>
      </Form>
    </Spin>
  );
}

// ---- Industries — display/filter tags --------------------------------------

function BusinessPanel({ uid }) {
  const { message } = App.useApp();
  const { data: relations, isFetching } = adminApi.endpoints.variantRelations.useQuery(uid, {
    skip: !uid,
  });
  const { data: categories } = adminApi.endpoints.businessCategoriesList.useQuery();
  const [setRelations, { isLoading: saving }] =
    adminApi.endpoints.variantSetRelations.useMutation();

  const [value, setValue] = useState([]);

  useEffect(() => {
    // GET returns `Industries`; `BusinessCategories` is a deprecated duplicate.
    if (relations)
      setValue((relations.Industries || relations.BusinessCategories || []).map((b) => b.id));
  }, [relations]);

  const options = (categories || []).map((c) => ({ label: c.name, value: c.id }));

  const save = async () => {
    try {
      // Per-key full replace: only industry_ids is sent (renamed from the
      // deprecated business_category_ids). Never plan_ids — deprecated, ignored.
      await setRelations({ uid, body: { industry_ids: value } }).unwrap();
      message.success('Industries saved');
    } catch (err) {
      // Silent endpoint — surface the server's message ourselves.
      message.error(err?.message || 'Could not save the industries.');
    }
  };

  return (
    <Spin spinning={isFetching}>
      <Space direction="vertical" style={{ width: '100%' }} size={14}>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          Display/filter tags only — these do <Text strong>not</Text> control access. Every variant
          is shown to everyone; users unlock it by adding it to their business while subscribed, or
          by buying it.
        </Paragraph>
        <div>
          <Text type="secondary">Industries</Text>
          <Select
            mode="multiple"
            allowClear
            style={{ width: '100%', marginTop: 4 }}
            value={value}
            onChange={setValue}
            options={options}
            optionFilterProp="label"
            placeholder="Select industries"
          />
        </div>
        <Button type="primary" loading={saving} onClick={save}>
          Save industries
        </Button>
      </Space>
    </Spin>
  );
}

// ---- Templates — assigned DESIGNS (full replace of family_ids) --------------

// Assignment is per design (template family): every version of a design
// follows it. Only `active` designs may be newly assigned, but a design can be
// assigned while active and deactivated later. Those no longer come back from
// `?status=active`, so the already-assigned rows are unioned into the options —
// without them the Select would render a bare numeric id and the next save
// (a full replace) would silently unassign them.
function TemplatesPanel({ uid }) {
  const { message } = App.useApp();
  const { data: full, isFetching } = adminApi.endpoints.variantTemplates.useQuery(uid, {
    skip: !uid,
  });

  // Server-side search: `limit` caps at 100, so client-side filtering goes stale
  // as soon as the catalogue outgrows one page.
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: familiesPage, isFetching: optionsLoading } =
    adminApi.endpoints.templateFamiliesList.useQuery({
      status: 'active',
      search: debouncedSearch || undefined,
      limit: 100,
    });
  const [setTemplates, { isLoading: saving }] =
    adminApi.endpoints.variantSetTemplates.useMutation();

  const [value, setValue] = useState([]);
  const assigned = full?.TemplateFamilies;

  useEffect(() => {
    // Seed only from the documented key — seeding [] from a response that
    // lacks it would unassign everything on the next (full-replace) save.
    if (Array.isArray(assigned)) setValue(assigned.map((t) => t.id));
  }, [assigned]);

  const options = useMemo(() => {
    const toOption = (t) => ({
      label: (
        <span>
          {t.template_type ? `${t.name} · ${t.template_type}` : t.name}
          {!isActiveStatus(t.status) && (
            <Tag color="default" style={{ marginInlineStart: 8 }}>
              {t.status || 'inactive'}
            </Tag>
          )}
        </span>
      ),
      value: t.id,
    });
    const seen = new Set();
    const out = [];
    // Active matches first, then any assigned template the filter left out so
    // selections never lose their label (or get dropped on save).
    for (const t of [...(familiesPage?.items || []), ...(assigned || [])]) {
      if (!t || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(toOption(t));
    }
    return out;
  }, [familiesPage, assigned]);

  const save = async () => {
    if (!Array.isArray(assigned)) {
      message.error('The current designs could not be read — reload before saving.');
      return;
    }
    try {
      await setTemplates({ uid, family_ids: value }).unwrap();
      message.success('Designs saved');
    } catch (err) {
      // Silent endpoint — surface the server's message ourselves.
      message.error(err?.message || 'Could not save the designs.');
    }
  };

  return (
    <Spin spinning={isFetching}>
      <Space direction="vertical" style={{ width: '100%' }} size={14}>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          The designs assigned to this variant (full replace) — every language and size of a design
          comes with it. Users who added or bought this variant get these designs. Only <Text strong>active</Text> designs can be picked — an already-assigned design that
          was since deactivated stays listed with its status so you can remove it deliberately.
        </Paragraph>
        <div>
          <Text type="secondary">Assigned designs</Text>
          <Select
            mode="multiple"
            allowClear
            style={{ width: '100%', marginTop: 4 }}
            value={value}
            onChange={setValue}
            options={options}
            showSearch
            filterOption={false}
            onSearch={setSearch}
            loading={optionsLoading}
            notFoundContent={optionsLoading ? <Spin size="small" /> : 'No active designs found'}
            placeholder="Select designs to assign"
            maxTagCount="responsive"
          />
        </div>
        <Button type="primary" loading={saving} onClick={save}>
          Save designs
        </Button>
      </Space>
    </Spin>
  );
}
