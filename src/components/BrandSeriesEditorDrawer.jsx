import { useEffect, useMemo, useState } from 'react';
import {
  Drawer,
  Tabs,
  Form,
  Input,
  InputNumber,
  Switch,
  Button,
  Space,
  Spin,
  Alert,
  Typography,
  App,
} from 'antd';
import { adminApi } from '../features/api/adminApi';
import ImageUploadField from './ImageUploadField';
import OrderedMultiSelect from './OrderedMultiSelect';
import TagSelect from './TagSelect';

const { Text, Paragraph } = Typography;
const isTrue = (v) => v === true || v === 1 || v === '1';

/**
 * Tabbed brand-series editor:
 *   • Details — icon, name, caption (the sub-title), description, order, active.
 *   • Relations — style personalities and colours (both ORDERED — drag to set the
 *     order they appear in, including on the public API) plus tags off the shared
 *     tag pool.
 *
 * Relations need a series uid, so for a NEW series you save Details first; the
 * drawer keeps that uid and unlocks the Relations tab.
 *
 * Nothing here gates access: plan entitlement lives on the VARIANT, not the
 * series. A series' is_locked is only a rollup of its variants.
 */
export default function BrandSeriesEditorDrawer({ open, series, onClose, onSaved }) {
  const [workingUid, setWorkingUid] = useState(series?.uid || null);
  const [tab, setTab] = useState('details');

  useEffect(() => {
    if (open) {
      setWorkingUid(series?.uid || null);
      setTab('details');
    }
  }, [open, series]);

  const isCreate = !workingUid;

  return (
    <Drawer
      title={isCreate ? 'New Brand Series' : `Edit "${series?.name ?? 'Brand Series'}"`}
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
                onCreated={(newUid) => {
                  setWorkingUid(newUid);
                  setTab('relations');
                  onSaved?.();
                }}
                onSaved={onSaved}
              />
            ),
          },
          {
            key: 'relations',
            label: 'Style, colours & tags',
            disabled: isCreate,
            children: workingUid ? (
              <RelationsPanel uid={workingUid} />
            ) : (
              <Alert
                type="info"
                showIcon
                message="Save the series details first to unlock this step."
              />
            ),
          },
        ]}
      />
    </Drawer>
  );
}

// ---- Details ---------------------------------------------------------------

function DetailsForm({ uid, onCreated, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const isEdit = Boolean(uid);

  const { data: full, isFetching } = adminApi.endpoints.brandSeriesGet.useQuery(uid, { skip: !uid });
  const [createSeries] = adminApi.endpoints.brandSeriesCreate.useMutation();
  const [updateSeries] = adminApi.endpoints.brandSeriesUpdate.useMutation();

  useEffect(() => {
    if (isEdit && full) {
      form.setFieldsValue({
        name: full.name,
        caption: full.caption ?? '',
        description: full.description ?? '',
        icon_s3_key: full.icon_s3_key ?? undefined,
        display_order: full.display_order ?? 0,
        is_active: isTrue(full.is_active),
      });
    } else if (!isEdit) {
      form.resetFields();
      form.setFieldsValue({ is_active: true, display_order: 0 });
    }
  }, [isEdit, full, form]);

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const caption = values.caption?.trim();
    const description = values.description?.trim();
    const body = {
      name: values.name.trim(),
      caption: caption ? caption : null,
      description: description ? description : null,
      icon_s3_key: values.icon_s3_key ?? null,
      display_order: values.display_order ?? 0,
      is_active: values.is_active ? 1 : 0,
    };
    setSubmitting(true);
    try {
      if (isEdit) {
        await updateSeries({ id: uid, body }).unwrap();
        message.success('Details saved');
        onSaved?.();
      } else {
        const created = await createSeries(body).unwrap();
        message.success('Brand series created — now set its style, colours and tags');
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
          <Input placeholder="e.g. Lemon Buzz" />
        </Form.Item>

        <Form.Item
          name="caption"
          label="Caption"
          tooltip="The short sub-title shown under the series name"
        >
          <Input placeholder="Short sub-title" />
        </Form.Item>

        <Form.Item name="description" label="Description">
          <Input.TextArea rows={3} placeholder="Shown on the series page" />
        </Form.Item>

        <Form.Item name="icon_s3_key" label="Icon">
          <ImageUploadField slot="brand_series_icon" />
        </Form.Item>

        <Space size="large" align="start" wrap>
          <Form.Item name="display_order" label="Display order">
            <InputNumber min={0} style={{ width: 160 }} />
          </Form.Item>

          <Form.Item name="is_active" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Space>

        <div>
          <Button type="primary" loading={submitting} onClick={handleSubmit}>
            {isEdit ? 'Save details' : 'Create brand series'}
          </Button>
        </div>
      </Form>
    </Spin>
  );
}

// ---- Relations: style personalities / colours / tags ------------------------

function ColourRow({ option, id }) {
  if (!option) return <Text type="secondary">#{id}</Text>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          background: option.hex || 'transparent',
          border: '1px solid rgba(0,0,0,0.15)',
          flex: 'none',
        }}
      />
      <span>{option.name}</span>
      {option.hex && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          <code>{option.hex}</code>
        </Text>
      )}
    </span>
  );
}

function RelationsPanel({ uid }) {
  const { message } = App.useApp();
  const { data: relations, isFetching } = adminApi.endpoints.brandSeriesRelations.useQuery(uid, {
    skip: !uid,
  });
  const { data: personalities } = adminApi.endpoints.stylePersonalitiesList.useQuery();
  const { data: colors } = adminApi.endpoints.colorsList.useQuery();
  const [setRelations, { isLoading: saving }] =
    adminApi.endpoints.brandSeriesSetRelations.useMutation();
  const [createPersonality] = adminApi.endpoints.stylePersonalitiesCreate.useMutation();

  const [personalityIds, setPersonalityIds] = useState([]);
  const [colorIds, setColorIds] = useState([]);
  const [tagIds, setTagIds] = useState([]);

  useEffect(() => {
    if (!relations) return;
    // The server returns both ordered sets already in display order.
    setPersonalityIds((relations.StylePersonalities || []).map((p) => p.id));
    setColorIds((relations.Colors || []).map((c) => c.id));
    setTagIds((relations.Tags || []).map((t) => t.id));
  }, [relations]);

  const personalityOptions = useMemo(
    () => (personalities || []).map((p) => ({ label: p.name, value: p.id })),
    [personalities],
  );
  const colorOptions = useMemo(
    () =>
      (colors || []).map((c) => ({
        label: c.hex_code ? `${c.name} (${c.hex_code})` : c.name,
        value: c.id,
        name: c.name,
        hex: c.hex_code,
      })),
    [colors],
  );

  // Style personalities are a free-form vocabulary like tags, so they can be
  // created straight from the picker. The create invalidates the list tag, so the
  // options refetch on their own; we just append the new id to the order.
  const addPersonality = async (name) => {
    try {
      const created = await createPersonality({ name, is_active: 1 }).unwrap();
      message.success(`Style personality "${created.name}" created`);
      return created.id;
    } catch {
      // 409 duplicate (and others) surfaced by baseQuery
      return null;
    }
  };

  const save = async () => {
    try {
      await setRelations({
        uid,
        body: {
          style_personality_ids: personalityIds,
          color_ids: colorIds,
          tag_ids: tagIds,
        },
      }).unwrap();
      message.success('Style, colours and tags saved');
    } catch (err) {
      // silent endpoint — we own the messaging here
      message.error(err?.message || 'Could not save.');
    }
  };

  return (
    <Spin spinning={isFetching}>
      <Space direction="vertical" style={{ width: '100%' }} size={18}>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          Style personalities and colours are <Text strong>ordered</Text> — drag them into the order
          they should appear in, on the site as well as here. Each picker is a full replace.
        </Paragraph>

        <div>
          <Text type="secondary">Style personalities</Text>
          <div style={{ marginTop: 4 }}>
            <OrderedMultiSelect
              value={personalityIds}
              onChange={setPersonalityIds}
              options={personalityOptions}
              placeholder="Select or add style personalities"
              onCreate={addPersonality}
              createPlaceholder="New style personality"
              emptyText="No style personalities yet — this series shows no strapline."
            />
          </div>
        </div>

        <div>
          <Text type="secondary">Colours</Text>
          <div style={{ marginTop: 4 }}>
            <OrderedMultiSelect
              value={colorIds}
              onChange={setColorIds}
              options={colorOptions}
              placeholder="Select colours"
              renderLabel={(option, id) => <ColourRow option={option} id={id} />}
              emptyText="No colours yet."
            />
          </div>
        </div>

        <div>
          <Text type="secondary">Tags</Text>
          <div style={{ marginTop: 4 }}>
            <TagSelect value={tagIds} onChange={setTagIds} />
          </div>
        </div>

        <div>
          <Button type="primary" loading={saving} onClick={save}>
            Save style, colours &amp; tags
          </Button>
        </div>
      </Space>
    </Spin>
  );
}
