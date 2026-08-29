import { useEffect, useMemo, useState } from 'react';
import {
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
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
import dayjs from 'dayjs';
import {
  adminApi,
  useQuotaPackCreateMutation,
  useQuotaPackUpdateMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import {
  STATUS_COLORS,
  STATUS_OPTIONS,
  applyPackServerError,
  buildFeatureOptions,
  formatMoney,
  packReadiness,
  statusLabel,
  toAmount,
  unitFor,
  withGst,
} from '../lib/quotaPacks';

const { Text, Paragraph } = Typography;

// Every writable key that has a form item, so a 400's details[] can be pinned to
// the field that caused it. `display_order` is deliberately absent — it is set
// by dragging rows on the list, never typed.
const FORM_FIELDS = [
  'name',
  'feature_type_id',
  'description',
  'quantity',
  'price',
  'strike_price',
  'badge',
  'status',
];

// Read-only keys the API rejects with a 400 if they turn up in a body:
// uid, id, created_by, created_at, updated_at, FeatureType.
function formValuesFrom(full) {
  return {
    name: full?.name ?? '',
    feature_type_id: full?.feature_type_id ?? undefined,
    description: full?.description ?? '',
    quantity: toAmount(full?.quantity) ?? 0,
    // DECIMAL columns arrive as strings — coerce so InputNumber and every
    // comparison work on numbers.
    price: toAmount(full?.price) ?? 0,
    strike_price: toAmount(full?.strike_price) ?? undefined,
    badge: full?.badge ?? '',
    status: full?.status || 'draft',
  };
}

// An optional text field the admin cleared has to go up as null — that is the
// only way to unset it. An untouched one is left out of the PATCH entirely.
const nullableText = (v) => {
  const s = (v ?? '').toString().trim();
  return s === '' ? null : s;
};

function bodyFrom(values) {
  return {
    name: (values.name || '').trim(),
    feature_type_id: values.feature_type_id ?? null,
    description: nullableText(values.description),
    quantity: Number(values.quantity ?? 0),
    price: Number(values.price ?? 0),
    strike_price: toAmount(values.strike_price),
    badge: nullableText(values.badge),
    status: values.status || 'draft',
  };
}

const same = (a, b) => (a === null || a === undefined ? b === null || b === undefined : a === b);

/**
 * Editor for a top-up pack — extra headroom on one feature, bought outright.
 *
 * `display_order` is not here (drag the list instead) and neither is anything
 * read-only: the API rejects unknown keys with a 400, so the body is built from
 * an explicit list rather than from whatever the record happened to carry.
 *
 * PATCH is partial, so an edit sends only what actually changed. That also makes
 * "Save & publish" a single request: the gate judges the state the row would
 * have AFTER the write, so the missing fields and `status: 'active'` can travel
 * together.
 *
 * `row` is the cached LIST row, the only place `missing_for_publish` exists
 * (GET /:uid omits it). It drives the checklist; a rejected publish maps its
 * identically-shaped `details[]` onto the same fields.
 */
export default function QuotaPackEditorDrawer({ open, uid, row, onClose, onSaved }) {
  const { message } = App.useApp();
  const perms = usePermissions();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const isEdit = Boolean(uid);
  const canSave = isEdit ? perms.can('quota_packs', 'update') : perms.can('quota_packs', 'create');

  const { data: features } = adminApi.endpoints.featureTypesList.useQuery();
  const { data: full, isFetching } = adminApi.endpoints.quotaPackGet.useQuery(uid, { skip: !uid });
  const [createPack] = useQuotaPackCreateMutation();
  const [updatePack] = useQuotaPackUpdateMutation();

  const featureId = Form.useWatch('feature_type_id', form);
  const price = toAmount(Form.useWatch('price', form)) ?? 0;
  const status = Form.useWatch('status', form);

  const selectedFeature = (features || []).find((f) => f.id === featureId);
  const unit = unitFor(selectedFeature?.key);

  // Only top-uppable features can be sold, but a pack already pointing at a
  // since-un-flagged one keeps it selectable so an edit can't silently repoint
  // it. The publish checklist still fails against it.
  const featureOptions = useMemo(
    () => buildFeatureOptions(features, { valueField: 'id', keepValue: full?.feature_type_id }),
    [features, full?.feature_type_id],
  );

  const readiness = packReadiness(row);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (isEdit) {
      if (full) form.setFieldsValue(formValuesFrom(full));
    } else {
      form.resetFields();
      form.setFieldsValue(formValuesFrom(null));
    }
  }, [open, isEdit, full, form]);

  const submit = async ({ publish = false } = {}) => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setFormError(null);
    const next = bodyFrom(values);
    if (publish) next.status = 'active';

    setSubmitting(true);
    try {
      if (isEdit) {
        // Partial by contract: send only what moved.
        const before = bodyFrom(formValuesFrom(full));
        const body = {};
        for (const key of Object.keys(next)) {
          if (!same(next[key], before[key])) body[key] = next[key];
        }
        if (Object.keys(body).length === 0) {
          message.info('Nothing to save — no fields changed.');
          setSubmitting(false);
          return;
        }
        await updatePack({ uid, body }).unwrap();
        message.success(publish ? 'Saved and published to the store' : 'Pack saved');
      } else {
        await createPack(next).unwrap();
        message.success(
          next.status === 'active' ? 'Pack created and published' : 'Draft pack created',
        );
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      setFormError(applyPackServerError(form, err, FORM_FIELDS));
    } finally {
      setSubmitting(false);
    }
  };

  const gross = withGst(price);

  return (
    <Drawer
      title={isEdit ? 'Edit top-up pack' : 'New top-up pack'}
      open={open}
      onClose={onClose}
      width={680}
      destroyOnClose
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onClose}>Cancel</Button>
            <Button loading={submitting} onClick={() => submit()} disabled={!canSave}>
              {isEdit ? 'Save' : 'Create draft'}
            </Button>
            {isEdit && status !== 'active' && (
              <Tooltip title="Saves your edits and publishes in one request — the gate judges the pack as it will be after the save, not as it is now.">
                <Button
                  type="primary"
                  loading={submitting}
                  disabled={!canSave}
                  onClick={() => submit({ publish: true })}
                >
                  Save &amp; publish
                </Button>
              </Tooltip>
            )}
          </Space>
        </div>
      }
    >
      <Spin spinning={isEdit && isFetching}>
        {formError && (
          <Alert type="error" showIcon style={{ marginBottom: 16 }} message={formError} />
        )}

        {isEdit && readiness.known && !readiness.ready && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="Not publishable yet"
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {readiness.missing.map((m) => (
                  <li key={m.field}>{m.message}</li>
                ))}
              </ul>
            }
          />
        )}

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="A top-up is bought outright and never expires."
          description="It adds headroom on top of whatever the user's plan allows, survives the monthly reset and a lapsed subscription, and is not tied to any plan."
        />

        <Form form={form} layout="vertical" disabled={!canSave}>
          <Form.Item
            name="name"
            label="Name"
            extra="Customer-visible, and unique across every pack. e.g. “500 AI Credits”."
            rules={[
              { required: true, message: 'Name is required' },
              { max: 150, message: 'At most 150 characters' },
            ]}
          >
            <Input placeholder="e.g. 500 AI Credits" />
          </Form.Item>

          <Form.Item
            name="feature_type_id"
            label="Feature"
            extra="Only features flagged “Can be topped up” on the Feature Types screen can be sold as a pack — turn the flag on there and it appears here."
            rules={[{ required: true, message: 'Pick the feature this pack tops up' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Pick a feature"
              options={featureOptions}
              notFoundContent="No feature is enabled for top-ups yet — turn one on from Feature Types."
            />
          </Form.Item>

          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} placeholder="Optional — a line about what the buyer gets" />
          </Form.Item>

          <Space size="large" align="start" wrap>
            <Form.Item
              name="quantity"
              label="Quantity"
              extra={
                unit.suffix
                  ? `In megabytes — ${unit.suffix} is this feature's own unit.`
                  : 'In the feature’s own unit. Must be above zero to publish.'
              }
            >
              <InputNumber
                min={0}
                precision={0}
                style={{ width: 220 }}
                addonAfter={unit.suffix || undefined}
              />
            </Form.Item>

            <Form.Item
              name="badge"
              label="Badge"
              extra="Merchandising ribbon on the buy screen."
              rules={[{ max: 40, message: 'At most 40 characters' }]}
            >
              <Input placeholder="e.g. Best value" style={{ width: 220 }} />
            </Form.Item>
          </Space>

          <Divider orientation="left" plain style={{ marginTop: 0 }}>
            Pricing
          </Divider>

          <Space size="large" align="start" wrap>
            <Form.Item
              name="price"
              label="Price (excl. GST)"
              extra="What you set here is the pre-tax figure. Must be above zero to publish."
            >
              <InputNumber min={0} precision={2} prefix="₹" style={{ width: 200 }} />
            </Form.Item>

            <Form.Item
              name="strike_price"
              label="Strike-through price"
              extra="Display only — the “was” figure struck out beside the price. Nothing is ever charged against it, and nothing validates it against the price."
            >
              <InputNumber min={0} precision={2} prefix="₹" style={{ width: 200 }} placeholder="—" />
            </Form.Item>
          </Space>

          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={
              price > 0
                ? `Customer pays ${formatMoney(gross)} — ${formatMoney(price)} + 18% GST.`
                : 'Customer pays the price above plus 18% GST.'
            }
            description="The buy screen shows the tax-inclusive figure. Set this field to the pre-tax price, or everything ends up priced 18% low."
          />

          <Form.Item
            name="status"
            label="Status"
            extra="Only the move INTO Published is gated. Unpublishing never is — and it is not a clawback: anyone who already bought the pack keeps their quota."
          >
            <Select style={{ width: 220 }} options={STATUS_OPTIONS} />
          </Form.Item>

          {isEdit && full && (
            <>
              <Divider orientation="left" plain>
                Record
              </Divider>
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="Status">
                  <Tag color={STATUS_COLORS[full.status] || 'default'}>
                    {statusLabel(full.status)}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Feature">
                  {full.FeatureType?.label || full.FeatureType?.key || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="Display order">
                  {full.display_order ?? '—'} <Text type="secondary">— set by dragging the list</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Created">
                  {full.created_at && dayjs(full.created_at).isValid()
                    ? dayjs(full.created_at).format('YYYY-MM-DD HH:mm')
                    : '—'}
                </Descriptions.Item>
                <Descriptions.Item label="Updated">
                  {full.updated_at && dayjs(full.updated_at).isValid()
                    ? dayjs(full.updated_at).format('YYYY-MM-DD HH:mm')
                    : '—'}
                </Descriptions.Item>
              </Descriptions>
            </>
          )}

          {!isEdit && (
            <Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
              New packs start as <Text code>draft</Text>. Publish from the list once the quantity
              and price are set.
            </Paragraph>
          )}
        </Form>
      </Spin>
    </Drawer>
  );
}
