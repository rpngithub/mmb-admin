import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
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

/**
 * fixed_params keys a token-billed (Google) route takes, per `output` mode.
 * The server's 400 names a missing / wrong one; this is just the cheat sheet.
 */
const GOOGLE_ROUTE_KEYS = {
  json: [
    ['output', 'optional — "json" (default) | "image" | "audio"'],
    ['system_prompt', 'required'],
    ['output_schema', 'required — JSON Schema with "type": "object"; strings may use "pattern", arrays "uniqueItems"'],
    ['max_output_tokens', 'required'],
    ['thinking', 'required — {"level":"minimal|low|medium|high"} for Gemini 3+, {"budget":N} for Gemini 2.x'],
    ['input_cents_per_mtok', 'required'],
    ['output_cents_per_mtok', 'required'],
    ['prompt_version', 'optional'],
    ['user_template', 'optional — template syntax below'],
    ['temperature', 'optional'],
    ['safety_settings', 'optional'],
  ],
  image: [
    ['output', '"image" — sent through Google’s Interactions API'],
    ['system_prompt', 'optional — sent as the first text block'],
    ['user_template', 'template syntax below'],
    ['aspect_ratio_map', 'e.g. { "4:5": "4:5" } — our value → Google’s'],
    ['image_size', '"1K" | "2K" | "4K" (uppercase K)'],
    ['image_mime', '"image/png" (default) | "image/jpeg"'],
    ['api_revision', 'optional — a date, sent as the Api-Revision header'],
    ['input_cents_per_mtok / output_cents_per_mtok', 'the token rates, as on json routes'],
  ],
  audio: [
    ['output', '"audio" — sent through Google’s Interactions API'],
    ['user_template', 'the transcript, spoken word for word (default {{text}} — keep it to the text alone)'],
    ['style_template', 'speaking style, e.g. "{{tone}} tone, {{pace}} pace"'],
    ['voice_map', '{ "<our voice value>": "<Google voice>" } — or a fixed "voice"'],
    ['voice', 'fixed Google voice (instead of voice_map)'],
    ['input_cents_per_mtok', 'required'],
    ['output_cents_per_mtok', 'required'],
  ],
};

/** Keys the server refuses on Google image / audio routes. */
const GOOGLE_FORBIDDEN = {
  image: ['output_schema', 'max_output_tokens', 'thinking', 'temperature', 'safety_settings'],
  audio: ['system_prompt', 'output_schema', 'max_output_tokens', 'thinking', 'temperature', 'safety_settings'],
};

const GOOGLE_IMAGE_MODELS = [
  'gemini-nano-banana-2.1',
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image',
];
const NANO_BANANA_RATIOS = '1:1, 1:4, 1:8, 2:3, 3:2, 3:4, 4:1, 4:3, 4:5, 5:4, 8:1, 9:16, 16:9, 21:9';
const GOOGLE_VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
  'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi',
  'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird',
  'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
];

const MAGNIFIC_ROUTE_KEYS = [
  ['prompt_template', 'text-to-image models: the MMB prompt. When set it IS the prompt — the operation needs no "prompt" field'],
  ['num_images', 'fixed count per request: 1..the model’s max (gpt-image-2-5: 10; others: 1)'],
];
/** Per-model num_images ceiling; anything not listed is 1. */
const MAGNIFIC_MAX_IMAGES = { 'gpt-image-2-5': 10 };

/** Shared {{…}} syntax for Magnific prompt_template and Google user_template. */
function TemplateSyntaxHelp() {
  return (
    <div style={{ marginTop: 6 }}>
      Template syntax: <Text code>{'{{field}}'}</Text>, <Text code>{'{{?field}}…{{/field}}'}</Text>{' '}
      (only when the field has a value), <Text code>{'{{^field}}…{{/field}}'}</Text> (only when
      empty). Reserved: <Text code>{'{{input_json}}'}</Text>, <Text code>{'{{brand_context}}'}</Text>,{' '}
      <Text code>{'{{language}}'}</Text>, <Text code>{'{{industry}}'}</Text>,{' '}
      <Text code>{'{{location}}'}</Text> — the last three and brand_context need the operation to
      declare context.
    </div>
  );
}

const KeyList = ({ keys }) => (
  <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
    {keys.map(([k, note]) => (
      <li key={k}>
        <Text code>{k}</Text> — {note}
      </li>
    ))}
  </ul>
);

/** Client-side hints for fixed_params; the server still has the final word. */
function fixedParamsWarnings({ params, google, magnific, model }) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return [];
  const out = [];
  if (google) {
    const mode = params.output ?? 'json';
    if (!['json', 'image', 'audio'].includes(mode)) {
      out.push(`output must be "json", "image" or "audio" (got ${JSON.stringify(mode)})`);
    }
    for (const k of GOOGLE_FORBIDDEN[mode] || []) {
      if (params[k] !== undefined) out.push(`"${k}" is not allowed on an ${mode} route`);
    }
    if (mode === 'image' && params.image_size !== undefined && !['1K', '2K', '4K'].includes(params.image_size)) {
      out.push('image_size must be "1K", "2K" or "4K" — Google refuses a lowercase k');
    }
    if (mode === 'image' && params.image_mime !== undefined && !['image/png', 'image/jpeg'].includes(params.image_mime)) {
      out.push('image_mime must be "image/png" or "image/jpeg"');
    }
    if (mode === 'audio' && params.voice !== undefined && params.voice_map !== undefined) {
      out.push('Give either "voice" or "voice_map", not both');
    }
    if (mode === 'audio') {
      const voices = [
        ...(params.voice !== undefined ? [params.voice] : []),
        ...(params.voice_map && typeof params.voice_map === 'object' ? Object.values(params.voice_map) : []),
      ];
      const unknown = voices.filter((v) => !GOOGLE_VOICES.includes(v));
      if (unknown.length) out.push(`Not a Google voice: ${unknown.join(', ')}`);
    }
  }
  if (magnific && params.num_images !== undefined) {
    const max = MAGNIFIC_MAX_IMAGES[model] ?? 1;
    const n = params.num_images;
    if (!Number.isInteger(n) || n < 1 || n > max) {
      out.push(`num_images must be a whole number from 1 to ${max}${model ? ` for ${model}` : ''}`);
    }
  }
  return out;
}

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
  const magnific = String(provider?.key || '').toLowerCase() === 'magnific';
  const currentModel = Form.useWatch('model', form);
  const fixedParamsText = Form.useWatch('fixed_params', form);
  const parsedParams = useMemo(() => {
    if (!fixedParamsText || !String(fixedParamsText).trim()) return {};
    try {
      return JSON.parse(fixedParamsText);
    } catch {
      return null;
    }
  }, [fixedParamsText]);
  const googleOutput =
    parsedParams && typeof parsedParams === 'object' && ['image', 'audio'].includes(parsedParams.output)
      ? parsedParams.output
      : 'json';
  const paramWarnings = fixedParamsWarnings({
    params: parsedParams,
    google: tokenBilled,
    magnific,
    model: currentModel,
  });
  const removeBackground = magnific && String(currentModel || '').includes('remove-background');
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
                Merged into every request sent through this route. Keys for a{' '}
                <Text strong>{googleOutput}</Text> route:
                <KeyList keys={GOOGLE_ROUTE_KEYS[googleOutput]} />
                {googleOutput === 'image' && (
                  <div style={{ marginTop: 6 }}>
                    Models: {GOOGLE_IMAGE_MODELS.join(', ')}. Nano
                    Banana 2.1 ratios: {NANO_BANANA_RATIOS}; up to 14 reference images.
                  </div>
                )}
                {googleOutput === 'audio' && (
                  <div style={{ marginTop: 6 }}>
                    Google voices (gender not documented; language detected from the text):{' '}
                    {GOOGLE_VOICES.join(', ')}. Audio routes take no media fields.
                  </div>
                )}
                {googleOutput !== 'audio' && (
                  <div style={{ marginTop: 6 }}>
                    The operation’s media / media_list fields are sent to the model as images.
                  </div>
                )}
                <TemplateSyntaxHelp />
              </div>
            ) : magnific ? (
              <div>
                Merged into every request sent through this route. Magnific keys:
                <KeyList keys={MAGNIFIC_ROUTE_KEYS} />
                <TemplateSyntaxHelp />
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
        {paramWarnings.length > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="The server will likely refuse these fixed params"
            description={
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {paramWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            }
          />
        )}
        {removeBackground && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Background removal"
            description="Inputs must be PNG, JPEG or WEBP up to 20 MB (else 400 at submit). A result without transparency fails the job with TASK_FAILED (“result has no transparent background” in the attempt row) and the credits are refunded."
          />
        )}
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
