import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { adminApi } from '../../features/api/adminApi';
import { usePermissions } from '../../features/auth/usePermissions';
import {
  FIELD_TYPES,
  LEDGER_SOURCES,
  OPERATION_UNITS,
  SCHEMA_CONTEXT_OPTIONS,
  SNAKE_CASE,
  applyServerErrors,
  formatNumber,
  multiplierValuesFor,
  previewPrice,
  rowsToSchema,
  schemaContext,
  schemaToRows,
  toNum,
} from '../../lib/ai';
import AiServerErrors from './AiServerErrors';

const { Text } = Typography;

const FORM_FIELDS = [
  'key',
  'label',
  'description',
  'credits',
  'unit',
  'ledger_source',
  'is_active',
  'plan_ids',
  'context',
];

const HAS_MIN_MAX = new Set(['integer', 'string', 'media_list']);
/** Types with no default value control. */
const NO_DEFAULT = new Set(['media', 'media_list', 'project']);

/** Allowed-plans option: name, plan_type, and an "inactive" tag. */
function planOption(p) {
  return {
    value: p.id,
    label: p.name || p.uid || `#${p.id}`,
    plan: p,
  };
}

/** Default-value input matching the field's type. */
function DefaultInput({ row, ...rest }) {
  switch (row?.type) {
    case 'integer':
      return <InputNumber style={{ width: '100%' }} {...rest} />;
    case 'boolean':
      return (
        <Select
          allowClear
          options={[
            { value: true, label: 'true' },
            { value: false, label: 'false' },
          ]}
          {...rest}
        />
      );
    case 'enum':
      return (
        <Select
          allowClear
          options={(row.values || []).map((v) => ({ value: v, label: v }))}
          {...rest}
        />
      );
    case 'string':
      return <Input {...rest} />;
    default:
      return <Input disabled placeholder="—" {...rest} />;
  }
}

/** Sample-input control for the price preview. */
function SampleInput({ row, value, onChange }) {
  if (row.type === 'enum') {
    return (
      <Select
        style={{ width: '100%' }}
        value={value}
        onChange={onChange}
        allowClear
        placeholder={row.default !== undefined ? `default: ${row.default}` : 'pick'}
        options={(row.values || []).map((v) => ({ value: v, label: v }))}
      />
    );
  }
  if (row.type === 'boolean') {
    return (
      <Select
        style={{ width: '100%' }}
        value={value}
        onChange={onChange}
        allowClear
        placeholder={row.default !== undefined ? `default: ${row.default}` : 'pick'}
        options={[
          { value: 'true', label: 'true' },
          { value: 'false', label: 'false' },
        ]}
      />
    );
  }
  return (
    <InputNumber
      style={{ width: '100%' }}
      value={value}
      onChange={onChange}
      min={row.min ?? undefined}
      max={row.max ?? undefined}
      placeholder={row.default !== undefined ? `default: ${row.default}` : '1'}
    />
  );
}

/**
 * Operation editor — what users buy. The input schema is edited row-per-field;
 * price rules are built on top of it (units from an integer field, multipliers
 * keyed by enum / boolean values) with a live price preview.
 */
export default function AiOperationDrawer({ open, record, onClose }) {
  const isEdit = Boolean(record);
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const perms = usePermissions();
  const canEdit = isEdit
    ? perms.can('ai_operations', 'update')
    : perms.can('ai_operations', 'create');
  const [create, { isLoading: creating }] = adminApi.endpoints.aiOperationCreate.useMutation();
  const [update, { isLoading: updating }] = adminApi.endpoints.aiOperationUpdate.useMutation();
  const [formError, setFormError] = useState(null);
  const [sample, setSample] = useState({});
  const { data: allPlans = [], isFetching: plansLoading } = adminApi.endpoints.plansList.useQuery(
    undefined,
    { skip: !open },
  );

  // Plans the operation already names stay selectable even if the plans list
  // hasn't loaded (or no longer lists them).
  const planOptions = useMemo(() => {
    const byId = new Map();
    for (const p of record?.plans || []) if (p?.id != null) byId.set(p.id, p);
    for (const p of allPlans || []) if (p?.id != null) byId.set(p.id, p);
    return [...byId.values()].map(planOption);
  }, [allPlans, record]);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setSample({});
    form.resetFields();
    if (record) {
      const multipliers = record.price_rules?.multipliers || {};
      // Multiplier values are stored keyed by string; the form uses the same.
      form.setFieldsValue({
        key: record.key,
        label: record.label,
        description: record.description,
        credits: toNum(record.credits),
        unit: record.unit,
        ledger_source: record.ledger_source,
        is_active: record.is_active !== false && record.is_active !== 0,
        plan_ids: (record.plans || []).map((p) => p.id).filter((id) => id != null),
        schema_rows: schemaToRows(record.input_schema),
        context: schemaContext(record.input_schema),
        units_from: record.price_rules?.units_from || undefined,
        multiplier_fields: Object.keys(multipliers),
        multipliers,
      });
    } else {
      form.setFieldsValue({
        credits: 1,
        unit: 'call',
        is_active: true,
        plan_ids: [],
        schema_rows: [],
        context: [],
        multiplier_fields: [],
        multipliers: {},
      });
    }
  }, [open, record, form]);

  const rows = Form.useWatch('schema_rows', form);
  const multiplierFields = Form.useWatch('multiplier_fields', form);
  const multipliers = Form.useWatch('multipliers', form);
  const unitsFrom = Form.useWatch('units_from', form);
  const credits = Form.useWatch('credits', form);
  const unit = Form.useWatch('unit', form);

  const validRows = useMemo(() => (rows || []).filter((r) => r?.name), [rows]);
  const rowByName = useMemo(() => new Map(validRows.map((r) => [r.name, r])), [validRows]);
  const integerFields = validRows.filter((r) => r.type === 'integer');
  const multiplierCandidates = validRows.filter(
    (r) => multiplierValuesFor(r).length > 0 || (multiplierFields || []).includes(r.name),
  );

  /** The price_rules object as it will be sent. */
  const buildPriceRules = (values) => {
    const out = {};
    if (values.units_from && rowByName.get(values.units_from)?.type === 'integer') {
      out.units_from = values.units_from;
    }
    const m = {};
    for (const field of values.multiplier_fields || []) {
      const row = rowByName.get(field);
      if (!row) continue;
      const allowed = multiplierValuesFor(row);
      const stored = values.multipliers?.[field] || {};
      const keys = allowed.length ? allowed : Object.keys(stored);
      const clean = {};
      for (const k of keys) {
        const n = toNum(stored[k]);
        if (n !== null) clean[k] = n;
      }
      m[field] = clean;
    }
    if (Object.keys(m).length) out.multipliers = m;
    return out;
  };

  const liveRules = buildPriceRules({
    units_from: unitsFrom,
    multiplier_fields: multiplierFields,
    multipliers,
  });
  const preview = previewPrice({
    credits,
    unit,
    rows: validRows,
    priceRules: liveRules,
    sample,
  });
  const sampleRows = validRows.filter((r) => ['enum', 'integer', 'boolean'].includes(r.type));

  const submit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setFormError(null);
    const body = {
      label: values.label,
      description: values.description?.trim() ? values.description.trim() : null,
      credits: values.credits,
      unit: values.unit,
      ledger_source: values.ledger_source,
      is_active: Boolean(values.is_active),
      // Replaces the whole list; [] = every plan (Free and the access pass too).
      plan_ids: (values.plan_ids || []).map((id) => toNum(id) ?? id),
      input_schema: rowsToSchema(values.schema_rows, values.context, record?.input_schema),
      price_rules: buildPriceRules(values),
    };
    try {
      if (isEdit) await update({ uid: record.uid, body }).unwrap();
      else await create({ key: values.key?.trim(), ...body }).unwrap();
      message.success(isEdit ? 'Operation saved' : 'Operation created — add a route next.');
      onClose();
    } catch (err) {
      // Every details[] entry is listed: enum multipliers that miss a value,
      // and one entry per active route the schema doesn't fit.
      setFormError(applyServerErrors(form, err, FORM_FIELDS, 'Could not save the operation.'));
    }
  };

  return (
    <Drawer
      title={isEdit ? `Operation: ${record?.label || record?.key}` : 'New operation'}
      open={open}
      onClose={onClose}
      width={860}
      destroyOnClose
      extra={
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
      <Form form={form} layout="vertical" disabled={!canEdit} requiredMark="optional">
        <AiServerErrors error={formError} />

        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item
              name="key"
              label="Key"
              rules={[
                { required: !isEdit, message: 'Key is required' },
                { pattern: SNAKE_CASE, message: 'snake_case, e.g. remove_background' },
              ]}
              extra={
                isEdit
                  ? 'Permanent — the app calls the operation by this key.'
                  : 'Permanent once created: the app calls the operation by it.'
              }
            >
              <Input disabled={isEdit} placeholder="remove_background" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="label" label="Label" rules={[{ required: true }]}>
              <Input placeholder="Remove background" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="description" label="Description">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item
              name="credits"
              label="Credits"
              rules={[{ required: true, message: 'Required' }]}
              extra="MMB AI credits per unit."
            >
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="unit" label="Unit" rules={[{ required: true }]}>
              <Select options={OPERATION_UNITS.map((v) => ({ value: v, label: v }))} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="ledger_source" label="Ledger source" rules={[{ required: true }]}>
              <Select showSearch optionFilterProp="label" options={LEDGER_SOURCES} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="is_active" label="Active" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item
          name="plan_ids"
          label="Allowed plans"
          extra="Empty = all plans, including Free and the access pass."
        >
          <Select
            mode="multiple"
            allowClear
            loading={plansLoading}
            placeholder="All plans"
            optionFilterProp="label"
            options={planOptions}
            optionRender={(opt) => {
              const p = opt.data.plan || {};
              return (
                <Space size={4} wrap>
                  <span>{opt.data.label}</span>
                  {p.plan_type && <Tag>{p.plan_type}</Tag>}
                  {p.status && p.status !== 'active' && <Tag color="orange">inactive</Tag>}
                </Space>
              );
            }}
          />
        </Form.Item>

        <Divider orientation="left">Input schema</Divider>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          The fields the app sends with a request. Names are snake_case.
        </Text>
        <Form.List name="schema_rows">
          {(fields, { add, remove }) => (
            <>
              {fields.length === 0 && (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No input fields" />
              )}
              {fields.map((field) => {
                const row = rows?.[field.name] || {};
                return (
                  <Card size="small" key={field.key} style={{ marginBottom: 8 }}>
                    <Row gutter={8} align="top">
                      <Col xs={24} md={7}>
                        <Form.Item
                          name={[field.name, 'name']}
                          label="Name"
                          rules={[
                            { required: true, message: 'Required' },
                            { pattern: SNAKE_CASE, message: 'snake_case' },
                            {
                              validator: (_r, v) =>
                                v && (rows || []).filter((r) => r?.name === v).length > 1
                                  ? Promise.reject(new Error('Duplicate name'))
                                  : Promise.resolve(),
                            },
                          ]}
                        >
                          <Input placeholder="aspect_ratio" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={5}>
                        <Form.Item
                          name={[field.name, 'type']}
                          label="Type"
                          rules={[
                            { required: true },
                            {
                              validator: (_r, v) =>
                                v === 'project' &&
                                (rows || []).filter((r) => r?.type === 'project').length > 1
                                  ? Promise.reject(new Error('Only one project field'))
                                  : Promise.resolve(),
                            },
                          ]}
                          extra={row.type === 'project' ? 'uid of one of the user’s projects' : undefined}
                        >
                          <Select options={FIELD_TYPES.map((t) => ({ value: t, label: t }))} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={3}>
                        <Form.Item
                          name={[field.name, 'required']}
                          label="Required"
                          valuePropName="checked"
                        >
                          <Checkbox />
                        </Form.Item>
                      </Col>
                      {HAS_MIN_MAX.has(row.type) && (
                        <>
                          <Col xs={12} md={4}>
                            <Form.Item name={[field.name, 'min']} label="Min">
                              <InputNumber style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col xs={12} md={4}>
                            <Form.Item name={[field.name, 'max']} label="Max">
                              <InputNumber style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                        </>
                      )}
                      <Col flex="none" style={{ marginLeft: 'auto', paddingTop: 30 }}>
                        <Button
                          danger
                          type="text"
                          icon={<DeleteOutlined />}
                          onClick={() => remove(field.name)}
                        />
                      </Col>
                    </Row>
                    <Row gutter={8}>
                      {row.type === 'enum' && (
                        <Col xs={24} md={14}>
                          <Form.Item
                            name={[field.name, 'values']}
                            label="Values"
                            rules={[
                              {
                                validator: (_r, v) =>
                                  Array.isArray(v) && v.length
                                    ? Promise.resolve()
                                    : Promise.reject(new Error('An enum needs at least one value')),
                              },
                            ]}
                          >
                            <Select mode="tags" tokenSeparators={[',']} placeholder="square, portrait" />
                          </Form.Item>
                        </Col>
                      )}
                      {!NO_DEFAULT.has(row.type) && (
                        <Col xs={24} md={row.type === 'enum' ? 10 : 12}>
                          <Form.Item name={[field.name, 'default']} label="Default">
                            <DefaultInput row={row} />
                          </Form.Item>
                        </Col>
                      )}
                    </Row>
                  </Card>
                );
              })}
              <Button
                type="dashed"
                block
                icon={<PlusOutlined />}
                onClick={() => add({ name: '', type: 'string', required: false, values: [] })}
              >
                Add field
              </Button>
            </>
          )}
        </Form.List>

        <Form.Item
          name="context"
          label="Server-added context"
          style={{ marginTop: 16 }}
          dependencies={['schema_rows']}
          extra="The server adds these to the request itself. Project/design details need a field of type project."
          rules={[
            {
              validator: (_r, v) =>
                (v || []).includes('project') &&
                !(form.getFieldValue('schema_rows') || []).some((r) => r?.type === 'project')
                  ? Promise.reject(new Error('Add a field of type project first'))
                  : Promise.resolve(),
            },
          ]}
        >
          <Checkbox.Group options={SCHEMA_CONTEXT_OPTIONS} />
        </Form.Item>

        <Divider orientation="left">Price rules</Divider>
        <Form.Item
          name="units_from"
          label="Units from"
          extra="An integer field whose value multiplies the price (e.g. number of images). Blank = 1 unit."
        >
          <Select
            allowClear
            placeholder="1 unit per request"
            options={integerFields.map((r) => ({ value: r.name, label: r.name }))}
            style={{ maxWidth: 320 }}
          />
        </Form.Item>
        <Form.Item
          name="multiplier_fields"
          label="Multipliers on"
          extra="An enum multiplier must price EVERY value of that enum."
        >
          <Select
            mode="multiple"
            allowClear
            placeholder="No multipliers"
            options={multiplierCandidates.map((r) => ({
              value: r.name,
              label: `${r.name} (${r.type})`,
            }))}
          />
        </Form.Item>
        {(multiplierFields || []).map((fieldName) => {
          const row = rowByName.get(fieldName);
          if (!row) return null;
          const values = multiplierValuesFor(row);
          const keys = values.length ? values : Object.keys(multipliers?.[fieldName] || {});
          return (
            <Card
              size="small"
              key={fieldName}
              title={<Text code>{fieldName}</Text>}
              style={{ marginBottom: 8 }}
            >
              {keys.length === 0 ? (
                <Text type="secondary">Give this field some values first.</Text>
              ) : (
                <Space wrap>
                  {keys.map((v) => (
                    <Form.Item
                      key={v}
                      name={['multipliers', fieldName, v]}
                      label={v}
                      rules={[{ required: true, message: 'Required' }]}
                      style={{ marginBottom: 0 }}
                    >
                      <InputNumber min={0} step={0.1} style={{ width: 110 }} prefix="×" />
                    </Form.Item>
                  ))}
                </Space>
              )}
            </Card>
          );
        })}
      </Form>

      <Divider orientation="left">Price preview</Divider>
      <Card size="small">
        {sampleRows.length > 0 ? (
          <Row gutter={[12, 8]} style={{ marginBottom: 12 }}>
            {sampleRows.map((r) => (
              <Col xs={12} md={8} key={r.name}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {r.name}
                </Text>
                <SampleInput
                  row={r}
                  value={sample[r.name]}
                  onChange={(v) => setSample((s) => ({ ...s, [r.name]: v }))}
                />
              </Col>
            ))}
          </Row>
        ) : (
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            Add enum / integer / boolean fields to try sample inputs.
          </Text>
        )}
        <Text>
          {formatNumber(preview.base)} credits × {formatNumber(preview.units)}{' '}
          {preview.unitsFrom ? `(${preview.unitsFrom})` : preview.unit}
          {preview.factors.map((f) => ` × ${formatNumber(f.multiplier, 4)} (${f.field}=${f.value})`)}{' '}
          = <Text strong>{formatNumber(preview.total, 4)} credits</Text>
        </Text>
        {preview.missing.length > 0 && (
          <Alert
            style={{ marginTop: 8 }}
            type="warning"
            showIcon
            message={`Not priced: ${preview.missing.join('; ')}`}
          />
        )}
      </Card>
    </Drawer>
  );
}
