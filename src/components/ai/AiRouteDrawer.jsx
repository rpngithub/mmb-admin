import { useEffect, useState } from 'react';
import {
  App,
  Button,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd';
import { adminApi } from '../../features/api/adminApi';
import { usePermissions } from '../../features/auth/usePermissions';
import {
  applyServerErrors,
  formatInr,
  jsonObjectRule,
  matchesRef,
  parseJsonObject,
  prettyJson,
  refOf,
  toNum,
} from '../../lib/ai';
import AiServerErrors from './AiServerErrors';

const { Text, Paragraph } = Typography;

/** fixed_params keys a token-billed (Google) route needs. The server's 400 names a missing / wrong one. */
const TOKEN_ROUTE_KEYS = [
  ['system_prompt', 'required'],
  ['output_schema', 'required — JSON Schema with "type": "object"'],
  ['max_output_tokens', 'required'],
  ['thinking', 'required — {"level":"minimal|low|medium|high"} for Gemini 3+, {"budget":N} for Gemini 2.x'],
  ['input_cents_per_mtok', 'required'],
  ['output_cents_per_mtok', 'required'],
  ['prompt_version', 'optional'],
  ['user_template', 'optional — {{field}} placeholders must be operation fields'],
  ['temperature', 'optional'],
  ['safety_settings', 'optional'],
];

const FALLBACK_HELP =
  "On the primary route(s): may jobs move to a later-priority route? With several primary routes, ONE switched off forbids it for all. It holds even while the primary's provider is disabled or keyless — jobs wait, and new requests get 'AI unavailable'.";

const FORM_FIELDS = [
  'provider_id',
  'model',
  'fixed_params',
  'provider_units',
  'priority',
  'weight',
  'fallback_allowed',
  'max_cost_inr',
  'is_active',
];

/**
 * Route editor — one way of fulfilling an operation through a provider/model.
 * operation_id and provider_id are fixed once created (400 if changed).
 */
export default function AiRouteDrawer({ open, operation, record, onClose }) {
  const isEdit = Boolean(record);
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const perms = usePermissions();
  const canEdit = isEdit
    ? perms.can('ai_operations', 'update')
    : perms.can('ai_operations', 'create');
  const { data: providers = [] } = adminApi.endpoints.aiProvidersList.useQuery(undefined, {
    skip: !open,
  });
  const { data: adapters = [] } = adminApi.endpoints.aiAdapters.useQuery(undefined, {
    skip: !open,
  });
  const [create, { isLoading: creating }] = adminApi.endpoints.aiRouteCreate.useMutation();
  const [update, { isLoading: updating }] = adminApi.endpoints.aiRouteUpdate.useMutation();
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.resetFields();
    if (record) {
      form.setFieldsValue({
        provider_id: record.provider_id ?? refOf(record.provider),
        model: record.model,
        fixed_params: record.fixed_params ? prettyJson(record.fixed_params) : '',
        provider_units: toNum(record.provider_units),
        priority: toNum(record.priority),
        weight: toNum(record.weight),
        fallback_allowed: record.fallback_allowed === true || record.fallback_allowed === 1,
        max_cost_inr: toNum(record.max_cost_inr),
        is_active: record.is_active !== false && record.is_active !== 0,
      });
    } else {
      form.setFieldsValue({ priority: 10, weight: 100, fallback_allowed: true, is_active: true });
    }
  }, [open, record, form]);

  const providerId = Form.useWatch('provider_id', form);
  const providerUnits = Form.useWatch('provider_units', form);
  const provider =
    record?.provider && isEdit
      ? providers.find((p) => p.uid === record.provider.uid) || record.provider
      : providers.find((p) => matchesRef(p, providerId));
  const costPerUnit = toNum(provider?.cost_per_unit_inr);
  const estCost =
    costPerUnit !== null && toNum(providerUnits) !== null ? costPerUnit * toNum(providerUnits) : null;

  // models[] → Select; models null (google) → free text; adapter unknown → free text.
  const adapter = provider?.key ? adapters.find((a) => a.key === provider.key) : null;
  const models = Array.isArray(adapter?.models) ? adapter.models : null;
  const tokenBilled = Boolean(adapter) && adapter.models === null;
  const currentModel = Form.useWatch('model', form);
  const modelOptions = models
    ? [...new Set([...models, ...(currentModel && !models.includes(currentModel) ? [currentModel] : [])])].map(
        (m) => ({ value: m, label: models.includes(m) ? m : `${m} (not in adapter list)` }),
      )
    : [];

  const formatFixedParams = () => {
    const text = form.getFieldValue('fixed_params');
    try {
      if (text && String(text).trim()) form.setFieldValue('fixed_params', prettyJson(JSON.parse(text)));
      form.validateFields(['fixed_params']);
    } catch {
      form.validateFields(['fixed_params']);
    }
  };

  const submit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setFormError(null);
    const body = {
      model: values.model?.trim() || null,
      fixed_params: parseJsonObject(values.fixed_params),
      provider_units: values.provider_units,
      priority: values.priority,
      weight: values.weight,
      fallback_allowed: Boolean(values.fallback_allowed),
      max_cost_inr: values.max_cost_inr ?? null,
      is_active: Boolean(values.is_active),
    };
    try {
      if (isEdit) {
        await update({ uid: record.uid, body }).unwrap();
      } else {
        await create({
          operation_id: refOf(operation),
          provider_id: values.provider_id,
          ...body,
        }).unwrap();
      }
      message.success('Route saved');
      onClose();
    } catch (err) {
      // Schema ↔ route problems come back one details[] entry each — all listed.
      setFormError(applyServerErrors(form, err, FORM_FIELDS, 'Could not save the route.'));
    }
  };

  return (
    <Drawer
      title={`${isEdit ? 'Edit route' : 'New route'} — ${operation?.label || operation?.key || ''}`}
      open={open}
      onClose={onClose}
      width={620}
      destroyOnClose
      extra={
        canEdit && (
          <Space>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="primary" loading={creating || updating} onClick={submit}>
              Save
            </Button>
          </Space>
        )
      }
    >
      <Form form={form} layout="vertical" disabled={!canEdit} requiredMark="optional">
        <AiServerErrors error={formError} />
        <Form.Item
          name="provider_id"
          label="Provider"
          rules={[{ required: true }]}
          extra={isEdit ? 'Fixed once the route exists.' : 'Cannot be changed after create.'}
        >
          <Select
            disabled={isEdit}
            showSearch
            optionFilterProp="label"
            options={
              isEdit && record?.provider && !providers.length
                ? [{ value: form.getFieldValue('provider_id'), label: record.provider.name }]
                : providers.map((p) => ({
                    value: refOf(p),
                    label: `${p.name} (${p.key})${p.status === 'disabled' ? ' — disabled' : ''}`,
                  }))
            }
          />
        </Form.Item>
        <Form.Item
          name="model"
          label="Model"
          extra={models ? 'Models this provider’s adapter supports.' : undefined}
        >
          {models ? (
            <Select showSearch allowClear placeholder="Pick a model" options={modelOptions} />
          ) : (
            <Input placeholder={tokenBilled || !adapter ? 'gemini-3.5-flash-lite' : 'provider model id'} />
          )}
        </Form.Item>
        <Form.Item
          label={
            <Space>
              <span>Fixed params (JSON)</span>
              <Button size="small" type="link" onClick={formatFixedParams} style={{ padding: 0 }}>
                Format
              </Button>
            </Space>
          }
          extra={
            tokenBilled ? (
              <div>
                Merged into every request sent through this route. Keys for this provider:
                <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                  {TOKEN_ROUTE_KEYS.map(([k, note]) => (
                    <li key={k}>
                      <Text code>{k}</Text> — {note}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              'A JSON object merged into every request sent through this route.'
            )
          }
        >
          <Form.Item name="fixed_params" rules={[jsonObjectRule]} noStyle>
            <Input.TextArea
              autoSize={{ minRows: tokenBilled ? 14 : 4, maxRows: 30 }}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
              placeholder="{}"
              spellCheck={false}
            />
          </Form.Item>
        </Form.Item>
        <Form.Item
          name="provider_units"
          label="Provider units"
          rules={[{ required: true }]}
          extra={
            <span>
              What one call costs us in the provider’s unit; for token-billed providers the
              ESTIMATED US cents per call.
              {estCost !== null && (
                <>
                  {' '}
                  ≈ <Text strong>{formatInr(estCost)}</Text> per call at today’s cost.
                </>
              )}
            </span>
          }
        >
          <InputNumber min={0} step={0.1} style={{ width: 200 }} />
        </Form.Item>

        <Paragraph type="secondary" style={{ marginTop: 8 }}>
          Routing: lower priority is tried first. Routes with the same priority are peers that
          share load by weight.
        </Paragraph>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item
              name="priority"
              label="Priority"
              rules={[{ required: true }]}
              extra="LOWER is tried first; same priority = peers sharing load by weight."
            >
              <InputNumber style={{ width: '100%' }} precision={0} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="weight"
              label="Weight"
              rules={[{ required: true }]}
              extra="Share among peers (e.g. 95 / 5 for a canary). 0 = only when peers can’t."
            >
              <InputNumber min={0} style={{ width: '100%' }} precision={0} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          name="fallback_allowed"
          label="Fallback allowed"
          valuePropName="checked"
          extra={FALLBACK_HELP}
        >
          <Switch />
        </Form.Item>
        <Form.Item
          name="max_cost_inr"
          label="Max cost (₹)"
          extra="Never send through this route when it would cost us more than this. Blank = no cap."
        >
          <InputNumber min={0} step={0.01} prefix="₹" style={{ width: 200 }} />
        </Form.Item>
        <Form.Item name="is_active" label="Active" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
