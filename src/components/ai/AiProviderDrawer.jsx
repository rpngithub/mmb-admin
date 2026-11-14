import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Switch,
  Tabs,
  Tooltip,
  Typography,
} from 'antd';
import { adminApi } from '../../features/api/adminApi';
import { usePermissions } from '../../features/auth/usePermissions';
import { useStepUp, isStepUpCancel } from '../../features/auth/stepUp';
import {
  BILLING_SETTING_KEYS,
  MANAGED_SETTING_KEYS,
  SERVER_SETTING_KEYS,
  applyServerErrors,
  costUnitLabel,
  formatDateTime,
  formatInr,
  jsonObjectRule,
  parseJsonObject,
  prettyJson,
  stableJson,
  toNum,
} from '../../lib/ai';
import AiCredentialsPanel from './AiCredentialsPanel';
import AiServerErrors from './AiServerErrors';

const { Text } = Typography;

const FORM_FIELDS = [
  'key',
  'name',
  'status',
  'base_url',
  'credential_source',
  'rate_limit_rpm',
  'max_concurrency',
  'timeout_ms',
  'cost_unit',
  'settings_other',
  'billing',
  'inr_per_unit',
  'terms_url',
  'notes',
];
const PLAIN_FIELDS = [
  'name',
  'status',
  'base_url',
  'credential_source',
  'rate_limit_rpm',
  'max_concurrency',
  'timeout_ms',
  'cost_unit',
  'terms_url',
  'notes',
];
/** A change to either of these needs the admin's password (step-up). */
const STEP_UP_FIELDS = ['base_url', 'credential_source'];

const emptyToNull = (v) => (v === undefined || v === '' ? null : v);

const OWN_CONTROL_KEYS = [...MANAGED_SETTING_KEYS, ...BILLING_SETTING_KEYS, ...SERVER_SETTING_KEYS];

function splitSettings(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const other = {};
  for (const [k, v] of Object.entries(s)) {
    if (!OWN_CONTROL_KEYS.includes(k)) other[k] = v;
  }
  return other;
}

const usesMagnificSettings = (key, settings) =>
  String(key || '').toLowerCase() === 'magnific' ||
  MANAGED_SETTING_KEYS.some((k) => settings && k in settings);

/**
 * Provider editor. Details tab is the form; Credentials tab (existing provider
 * whose adapter needs an API key) manages its write-only keys.
 * `onOpenProvider(uid)` switches the drawer to an existing provider — used by
 * the "already set up" links on the adapter picker.
 */
export default function AiProviderDrawer({ open, record, onClose, onOpenProvider }) {
  const isEdit = Boolean(record);
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const perms = usePermissions();
  const stepUp = useStepUp();
  const canEdit = isEdit ? perms.can('ai_providers', 'update') : perms.can('ai_providers', 'create');

  const [createProvider, { isLoading: creating }] =
    adminApi.endpoints.aiProviderCreate.useMutation();
  const [updateProvider, { isLoading: updating }] =
    adminApi.endpoints.aiProviderUpdate.useMutation();
  const [formError, setFormError] = useState(null);
  const [tab, setTab] = useState('details');

  const { data: adapters = [], isFetching: adaptersLoading } =
    adminApi.endpoints.aiAdapters.useQuery(undefined, { skip: !open });

  const watchedKey = Form.useWatch('key', form);
  const watchedSource = Form.useWatch('credential_source', form);
  const watchedBaseUrl = Form.useWatch('base_url', form);
  const watchedBilling = Form.useWatch('billing', form);
  const watchedCostUnit = Form.useWatch('cost_unit', form);
  const originalSettings = useMemo(() => record?.settings || {}, [record]);
  const providerKey = isEdit ? record?.key : watchedKey;
  const showMagnific = usesMagnificSettings(providerKey, originalSettings);
  const adapter = adapters.find((a) => a.key === providerKey) || null;
  const postpaid = watchedBilling === 'postpaid';
  const isPostpaidRecord = record?.settings?.billing === 'postpaid';
  const usedAdapters = adapters.filter((a) => a.in_use && a.provider?.uid);
  const hostsHelp = adapter?.allowed_hosts?.length
    ? `Must be https on: ${adapter.allowed_hosts.join(', ')}`
    : undefined;
  // Unknown adapter (list not loaded / key not on this server) → keep the tab.
  const needsKey = adapter ? adapter.requires_api_key !== false : true;

  // Initialise once per opening. The list refetches while the drawer is open
  // (e.g. after activating a key on the Credentials tab) and hands us a fresh
  // `record` — re-initialising then would wipe edits and jump tabs.
  const initialisedFor = useRef(null);
  useEffect(() => {
    if (!open) {
      initialisedFor.current = null;
      return;
    }
    const marker = record?.uid ?? 'new';
    if (initialisedFor.current === marker) return;
    initialisedFor.current = marker;
    setFormError(null);
    setTab('details');
    form.resetFields();
    if (record) {
      form.setFieldsValue({
        ...Object.fromEntries(PLAIN_FIELDS.map((f) => [f, record[f] ?? undefined])),
        key: record.key,
        settings_other: Object.keys(splitSettings(record.settings)).length
          ? prettyJson(splitSettings(record.settings))
          : '',
        webhook_secret_encoding: record.settings?.webhook_secret_encoding || 'auto',
        capture_responses: Boolean(record.settings?.capture_responses),
        low_balance_units: record.settings?.low_balance_units ?? null,
        billing: record.settings?.billing === 'postpaid' ? 'postpaid' : 'prepaid',
        inr_per_unit: toNum(record.settings?.inr_per_unit),
      });
    } else {
      form.setFieldsValue({
        status: 'active',
        credential_source: 'db',
        webhook_secret_encoding: 'auto',
        capture_responses: false,
        billing: 'prepaid',
      });
    }
  }, [open, record, form]);

  /**
   * The FULL settings object — PATCH replaces it as a whole, so every stored
   * key survives unless the admin removed it from the JSON box.
   */
  const buildSettings = (values) => {
    const out = {};
    // Dedicated-control keys whose controls aren't shown keep their value.
    if (!showMagnific) {
      for (const k of MANAGED_SETTING_KEYS) {
        if (k in originalSettings) out[k] = originalSettings[k];
      }
    }
    Object.assign(out, parseJsonObject(values.settings_other));
    if (showMagnific) {
      out.webhook_secret_encoding = values.webhook_secret_encoding || 'auto';
      out.capture_responses = Boolean(values.capture_responses);
      if (values.low_balance_units !== null && values.low_balance_units !== undefined) {
        out.low_balance_units = values.low_balance_units;
      }
    }
    // Billing: prepaid is the default, so a provider that never had the key
    // isn't rewritten just for saving. inr_per_unit is postpaid-only (400 otherwise).
    const billing = values.billing === 'postpaid' ? 'postpaid' : 'prepaid';
    if (!isEdit || billing === 'postpaid' || 'billing' in originalSettings) out.billing = billing;
    if (billing === 'postpaid' && toNum(values.inr_per_unit) !== null) {
      out.inr_per_unit = toNum(values.inr_per_unit);
    }
    // Server-written keys go back exactly as they came.
    for (const k of SERVER_SETTING_KEYS) {
      if (k in originalSettings) out[k] = originalSettings[k];
    }
    return out;
  };

  const submit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setFormError(null);

    const settings = buildSettings(values);
    let body;
    if (isEdit) {
      // PATCH only what changed — so a base_url / credential_source change is
      // what triggers step-up, and `key` / `cost_per_unit_inr` are never sent.
      body = {};
      for (const f of PLAIN_FIELDS) {
        const next = emptyToNull(values[f]);
        const prev = record[f] ?? null;
        if (next !== prev) body[f] = next;
      }
      if (stableJson(settings) !== stableJson(record.settings || {})) {
        body.settings = settings;
      }
      if (Object.keys(body).length === 0) {
        message.info('Nothing changed.');
        return;
      }
    } else {
      body = { key: values.key?.trim() };
      for (const f of PLAIN_FIELDS) {
        const v = emptyToNull(values[f]);
        if (v !== null) body[f] = v;
      }
      body.settings = settings;
    }

    const sensitive = isEdit && STEP_UP_FIELDS.some((f) => f in body);
    try {
      if (isEdit) {
        await stepUp.run(
          (stepUpToken) =>
            updateProvider({ uid: record.uid, body, stepUp: stepUpToken }).unwrap(),
          {
            upfront: sensitive,
            title: 'Confirm connection change',
            description: 'Changing the base URL or credential source needs your password.',
          },
        );
        message.success('Provider saved');
      } else {
        await stepUp.run(
          (stepUpToken) => createProvider({ body, stepUp: stepUpToken }).unwrap(),
          { upfront: false },
        );
        message.success('Provider created — add and activate an API key next.');
      }
      onClose();
    } catch (err) {
      if (isStepUpCancel(err)) return;
      // settings.inr_per_unit / settings.billing land on their own controls;
      // anything else under settings on the JSON box. The alert lists them all.
      const fieldFor = (f) => {
        if (f === 'settings.inr_per_unit' || f === 'inr_per_unit') return 'inr_per_unit';
        if (f === 'settings.billing' || f === 'billing') return 'billing';
        if (f === 'settings' || String(f || '').startsWith('settings.')) return 'settings_other';
        return f;
      };
      const remapped = Array.isArray(err?.details)
        ? { ...err, details: err.details.map((d) => (d?.field ? { ...d, field: fieldFor(d.field) } : d)) }
        : err;
      setFormError(applyServerErrors(form, remapped, FORM_FIELDS, 'Could not save the provider.'));
    }
  };

  const sensitiveChanged =
    isEdit &&
    ((watchedSource !== undefined && watchedSource !== record?.credential_source) ||
      (watchedBaseUrl !== undefined && (watchedBaseUrl || null) !== (record?.base_url ?? null)));

  const detailsForm = (
    <Form form={form} layout="vertical" disabled={!canEdit} requiredMark="optional">
      <AiServerErrors error={formError} />

      <Form.Item
        name="key"
        label="Adapter"
        rules={[{ required: !isEdit, message: 'Pick an adapter' }]}
        extra={
          isEdit ? (
            'Permanent — set when the provider was created.'
          ) : usedAdapters.length > 0 ? (
            <span>
              Already set up:{' '}
              {usedAdapters.map((a, i) => (
                <span key={a.key}>
                  {i > 0 && ', '}
                  {onOpenProvider ? (
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0, height: 'auto' }}
                      onClick={() => onOpenProvider(a.provider.uid)}
                    >
                      edit {a.key}
                    </Button>
                  ) : (
                    a.key
                  )}
                </span>
              ))}
            </span>
          ) : (
            'The provider types this server has an adapter for.'
          )
        }
      >
        {isEdit ? (
          <Input disabled />
        ) : (
          <Select
            showSearch
            loading={adaptersLoading}
            placeholder="Pick an adapter"
            optionFilterProp="value"
            options={adapters.map((a) => ({
              value: a.key,
              disabled: Boolean(a.in_use),
              label: a.in_use ? (
                <Tooltip title="Already set up — edit it" placement="right">
                  <span>
                    {a.key} <Text type="secondary">(already set up)</Text>
                  </span>
                </Tooltip>
              ) : (
                <span>
                  {a.key}
                  {a.requires_api_key === false && <Text type="secondary"> — no API key</Text>}
                </span>
              ),
            }))}
          />
        )}
      </Form.Item>
      <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Name is required' }]}>
        <Input />
      </Form.Item>
      <Form.Item name="status" label="Status" rules={[{ required: true }]}>
        <Select
          options={[
            { value: 'active', label: 'active' },
            { value: 'disabled', label: 'disabled' },
          ]}
        />
      </Form.Item>

      <Divider orientation="left" plain>
        Connection
      </Divider>
      {sensitiveChanged && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Saving a change to the base URL or credential source asks for your password."
        />
      )}
      <Form.Item
        name="base_url"
        label="Base URL"
        rules={[{ type: 'url', message: 'Not a URL' }]}
        extra={hostsHelp}
      >
        <Input placeholder={adapter?.allowed_hosts?.[0] ? `https://${adapter.allowed_hosts[0]}` : 'https://api.example.com'} />
      </Form.Item>
      <Form.Item
        name="credential_source"
        label="Credential source"
        extra="db = keys stored on the Credentials tab (encrypted); env = read from the server environment."
      >
        <Select
          options={[
            { value: 'db', label: 'db' },
            { value: 'env', label: 'env' },
          ]}
        />
      </Form.Item>
      <Space wrap size="middle" align="start">
        <Form.Item name="rate_limit_rpm" label="Rate limit (req / min)">
          <InputNumber min={0} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="max_concurrency" label="Max concurrency">
          <InputNumber min={0} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="timeout_ms" label="Timeout (ms)">
          <InputNumber min={0} step={1000} style={{ width: 160 }} />
        </Form.Item>
      </Space>

      <Divider orientation="left" plain>
        Cost
      </Divider>
      <Form.Item
        name="cost_unit"
        label="Cost unit"
        extra="What the provider bills in, e.g. credits, or usd_cent for Google."
      >
        <Input placeholder="credits" />
      </Form.Item>
      {isEdit && (
        <Form.Item
          label="Cost per unit (₹)"
          extra={
            isPostpaidRecord
              ? 'Read-only — from the latest invoice on Credit purchases, else Rupees per provider unit below.'
              : 'Read-only — derived from Credit purchases. Record a purchase to change it.'
          }
        >
          <Space size={6} wrap>
            <Text strong>
              {record?.cost_per_unit_inr === null || record?.cost_per_unit_inr === undefined
                ? isPostpaidRecord
                  ? 'No rate yet'
                  : 'No purchase recorded'
                : formatInr(record.cost_per_unit_inr, { digits: 4 })}
            </Text>
            {record?.cost_unit && (
              <Text type="secondary">
                per <Text code>{record.cost_unit}</Text>
                {record.cost_unit === 'usd_cent' && ' (one US cent)'}
              </Text>
            )}
          </Space>
        </Form.Item>
      )}

      <Form.Item
        name="billing"
        label="Billing"
        extra={
          postpaid
            ? 'Billed monthly: rows on Credit purchases are invoices, and there is no balance to track.'
            : 'We buy credits up front; Credit purchases set the cost and the balance.'
        }
      >
        <Radio.Group
          optionType="button"
          options={[
            { value: 'prepaid', label: 'Prepaid' },
            { value: 'postpaid', label: 'Postpaid' },
          ]}
        />
      </Form.Item>
      {postpaid && (
        <Form.Item
          name="inr_per_unit"
          label="Rupees per provider unit"
          extra="Incl. forex markup and GST; for Google one unit = one US cent. Once an invoice is recorded on Credit purchases, it overrides this."
          rules={[
            {
              validator: (_r, v) =>
                v === null || v === undefined || v === '' || toNum(v) > 0
                  ? Promise.resolve()
                  : Promise.reject(new Error('Must be more than 0')),
            },
          ]}
        >
          <InputNumber
            min={0}
            step={0.01}
            prefix="₹"
            addonAfter={`/ ${costUnitLabel(watchedCostUnit)}`}
            style={{ width: 260 }}
          />
        </Form.Item>
      )}

      {showMagnific && (
        <>
          <Divider orientation="left" plain>
            Provider settings
          </Divider>
          <Form.Item
            name="webhook_secret_encoding"
            label="Webhook secret encoding"
            extra="Leave on auto unless the provider's webhook signatures fail to verify."
          >
            <Select
              options={['auto', 'raw', 'base64'].map((v) => ({ value: v, label: v }))}
              style={{ width: 200 }}
            />
          </Form.Item>
          <Form.Item
            name="capture_responses"
            label="Capture responses"
            valuePropName="checked"
            extra={
              <Text type="warning">
                Stores raw provider responses on each job attempt — turn on only while checking a
                new integration.
              </Text>
            }
          >
            <Switch />
          </Form.Item>

          <Divider orientation="left" plain>
            Alerts
          </Divider>
          <Form.Item
            name="low_balance_units"
            label="Low-balance alert below (provider units)"
            extra="Blank = 10% of what was bought in the last year."
          >
            <InputNumber min={0} style={{ width: 200 }} placeholder="default" />
          </Form.Item>
          {isEdit && (
            <Form.Item label="Last balance alert" extra="Written by the server.">
              <Text>{formatDateTime(originalSettings?.last_balance_alert_at)}</Text>
            </Form.Item>
          )}
        </>
      )}

      <Form.Item
        name="settings_other"
        label={showMagnific ? 'Other settings (JSON)' : 'Settings (JSON)'}
        rules={[jsonObjectRule]}
        extra="A JSON object of provider-specific settings."
      >
        <Input.TextArea rows={5} style={{ fontFamily: 'monospace' }} placeholder="{}" />
      </Form.Item>

      <Divider orientation="left" plain>
        Notes
      </Divider>
      <Form.Item name="terms_url" label="Terms URL" rules={[{ type: 'url', message: 'Not a URL' }]}>
        <Input />
      </Form.Item>
      <Form.Item name="notes" label="Notes">
        <Input.TextArea rows={3} />
      </Form.Item>
    </Form>
  );

  return (
    <Drawer
      title={isEdit ? `Provider: ${record?.name || record?.key}` : 'New provider'}
      open={open}
      onClose={onClose}
      width={680}
      destroyOnClose
      extra={
        tab === 'details' &&
        canEdit && (
          <Space>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="primary" loading={creating || updating} onClick={submit}>
              {isEdit ? 'Save' : 'Create'}
            </Button>
          </Space>
        )
      }
    >
      {isEdit ? (
        <Tabs
          activeKey={needsKey ? tab : 'details'}
          onChange={setTab}
          items={[
            { key: 'details', label: 'Details', children: detailsForm, forceRender: true },
            // Adapters that need no API key (the dev-only `fake`) have no keys to manage.
            ...(needsKey
              ? [
                  {
                    key: 'credentials',
                    label: 'Credentials',
                    children: <AiCredentialsPanel provider={record} />,
                  },
                ]
              : []),
          ]}
        />
      ) : (
        detailsForm
      )}
    </Drawer>
  );
}
