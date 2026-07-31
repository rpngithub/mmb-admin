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
  Typography,
  App,
} from 'antd';
import { adminApi } from '../features/api/adminApi';
import ImageUploadField from './ImageUploadField';

const { Text, Paragraph } = Typography;
const isTrue = (v) => v === true || v === 1 || v === '1';

/**
 * Tabbed variant editor for the premium (plan-scoped) surface:
 *   • Details — name, description, brand series, badge, thumbnail, likes_count,
 *     order, active.
 *   • Plans (Access) — the premium entitlement multi-select (`plan_ids`).
 *   • Industries — display/filter tags (`industry_ids`).
 *   • Templates — the templates assigned to this variant (`template_ids`).
 *
 * Plans, Industries and Templates all need a variant uid, so for a NEW variant
 * you save Details first; the drawer keeps that uid and unlocks the rest.
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
                  setTab('plans');
                  onSaved?.();
                }}
                onSaved={onSaved}
              />
            ),
          },
          {
            key: 'plans',
            label: 'Plans (Access)',
            disabled: isCreate,
            children: workingUid ? <PlansPanel uid={workingUid} /> : <NeedsUid />,
          },
          {
            key: 'business',
            label: 'Industries',
            disabled: isCreate,
            children: workingUid ? <BusinessPanel uid={workingUid} /> : <NeedsUid />,
          },
          {
            key: 'templates',
            label: 'Templates',
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

function DetailsForm({ uid, defaultSeriesId, onCreated, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const isEdit = Boolean(uid);

  const { data: seriesList } = adminApi.endpoints.brandSeriesList.useQuery();
  const { data: badges } = adminApi.endpoints.variantBadgesList.useQuery();
  const { data: full, isFetching } = adminApi.endpoints.variantsGet.useQuery(uid, { skip: !uid });
  const [createVariant] = adminApi.endpoints.variantsCreate.useMutation();
  const [updateVariant] = adminApi.endpoints.variantUpdate.useMutation();

  useEffect(() => {
    if (isEdit && full) {
      form.setFieldsValue({
        series_id: full.series_id,
        badge_id: full.badge_id ?? undefined,
        name: full.name,
        description: full.description ?? '',
        thumbnail_s3_key: full.thumbnail_s3_key ?? undefined,
        likes_count: full.likes_count ?? 0,
        display_order: full.display_order ?? 0,
        is_active: isTrue(full.is_active),
      });
    } else if (!isEdit) {
      form.resetFields();
      form.setFieldsValue({
        is_active: true,
        likes_count: 0,
        display_order: 0,
        series_id: defaultSeriesId ?? undefined,
      });
    }
  }, [isEdit, full, defaultSeriesId, form]);

  const seriesOptions = (seriesList || []).map((s) => ({ label: s.name, value: s.id }));
  const badgeOptions = (badges || []).map((b) => ({ label: b.name, value: b.id }));

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const description = values.description?.trim();
    const body = {
      series_id: values.series_id,
      badge_id: values.badge_id ?? null,
      name: values.name.trim(),
      description: description ? description : null,
      thumbnail_s3_key: values.thumbnail_s3_key ?? null,
      likes_count: values.likes_count ?? 0,
      display_order: values.display_order ?? 0,
      is_active: values.is_active ? 1 : 0,
    };
    setSubmitting(true);
    try {
      if (isEdit) {
        await updateVariant({ uid, body }).unwrap();
        message.success('Details saved');
        onSaved?.();
      } else {
        const created = await createVariant(body).unwrap();
        message.success('Variant created — now choose which plans can access it');
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
            name="likes_count"
            label="Likes (❤️)"
            tooltip="The heart figure on the variant card"
          >
            <InputNumber min={0} style={{ width: 160 }} />
          </Form.Item>

          <Form.Item name="display_order" label="Display order">
            <InputNumber min={0} style={{ width: 160 }} />
          </Form.Item>

          <Form.Item name="is_active" label="Active" valuePropName="checked">
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

// ---- Plans (Access) — premium entitlement ----------------------------------

function PlansPanel({ uid }) {
  const { message } = App.useApp();
  const { data: relations, isFetching } = adminApi.endpoints.variantRelations.useQuery(uid, {
    skip: !uid,
  });
  const { data: plans } = adminApi.endpoints.plansList.useQuery();
  const [setRelations, { isLoading: saving }] =
    adminApi.endpoints.variantSetRelations.useMutation();

  const [value, setValue] = useState([]);

  useEffect(() => {
    if (relations) setValue((relations.Plans || []).map((p) => p.id));
  }, [relations]);

  const options = (plans || []).map((p) => ({ label: p.name, value: p.id }));

  const save = async () => {
    try {
      // Per-key full replace: only plan_ids is sent, so industries are left
      // untouched. An empty array clears the entitlement.
      await setRelations({ uid, body: { plan_ids: value } }).unwrap();
      message.success('Plan access saved');
    } catch {
      // error notification handled by baseQuery
    }
  };

  const empty = value.length === 0;

  return (
    <Spin spinning={isFetching}>
      <Space direction="vertical" style={{ width: '100%' }} size={14}>
        <Alert
          type={empty ? 'warning' : 'info'}
          showIcon
          message="Plan entitlement is the premium access control"
          description={
            empty
              ? 'A variant with no plans selected is locked to everyone — pick at least one plan to make it accessible. The plans you select make this variant’s templates available to subscribers on those plans (and let them add it to their business).'
              : 'The plans below make this variant’s templates available to subscribers on those plans (and let them add it to their business). Clear all plans to lock the variant to everyone.'
          }
        />
        <div>
          <Text type="secondary">Entitled plans</Text>
          <Select
            mode="multiple"
            allowClear
            style={{ width: '100%', marginTop: 4 }}
            value={value}
            onChange={setValue}
            options={options}
            optionFilterProp="label"
            placeholder="Select the plans that can access this variant"
          />
        </div>
        <Button type="primary" loading={saving} onClick={save}>
          Save plan access
        </Button>
      </Space>
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
      // deprecated business_category_ids), so the plan entitlement is untouched.
      await setRelations({ uid, body: { industry_ids: value } }).unwrap();
      message.success('Industries saved');
    } catch {
      // error notification handled by baseQuery
    }
  };

  return (
    <Spin spinning={isFetching}>
      <Space direction="vertical" style={{ width: '100%' }} size={14}>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          Display/filter tags only — these do <Text strong>not</Text> control access. Use the Plans
          tab for that.
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

// ---- Templates — assigned templates (full replace) -------------------------

function TemplatesPanel({ uid }) {
  const { message } = App.useApp();
  const { data: full, isFetching } = adminApi.endpoints.variantTemplates.useQuery(uid, {
    skip: !uid,
  });
  const { data: templatesPage } = adminApi.endpoints.templatesList.useQuery({ limit: 1000 });
  const [setTemplates, { isLoading: saving }] =
    adminApi.endpoints.variantSetTemplates.useMutation();

  const [value, setValue] = useState([]);

  useEffect(() => {
    if (full) setValue((full.Templates || []).map((t) => t.id));
  }, [full]);

  const options = useMemo(
    () =>
      (templatesPage?.items || []).map((t) => ({
        label: t.template_type ? `${t.name} · ${t.template_type}` : t.name,
        value: t.id,
      })),
    [templatesPage],
  );

  const save = async () => {
    try {
      await setTemplates({ uid, template_ids: value }).unwrap();
      message.success('Templates saved');
    } catch {
      // error notification handled by baseQuery
    }
  };

  return (
    <Spin spinning={isFetching}>
      <Space direction="vertical" style={{ width: '100%' }} size={14}>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          The templates assigned to this variant (full replace). These become available to
          subscribers on the variant’s entitled plans.
        </Paragraph>
        <div>
          <Text type="secondary">Assigned templates</Text>
          <Select
            mode="multiple"
            allowClear
            style={{ width: '100%', marginTop: 4 }}
            value={value}
            onChange={setValue}
            options={options}
            optionFilterProp="label"
            placeholder="Select templates to assign"
            maxTagCount="responsive"
          />
        </div>
        <Button type="primary" loading={saving} onClick={save}>
          Save templates
        </Button>
      </Space>
    </Spin>
  );
}
