import { useEffect, useMemo, useState } from 'react';
import { Modal, Form, Input, Select, Switch, Alert, Typography, App } from 'antd';
import {
  adminApi,
  useFeatureTypeMetersQuery,
  useFeatureTypeCreateMutation,
  useFeatureTypeUpdateMutation,
} from '../features/api/adminApi';
import { RESET_PERIODS, RESET_HINT, meterMap } from '../lib/meteredFeatures';

const { Text } = Typography;

const DATA_TYPE_OPTS = [
  { label: 'integer — an enforced limit', value: 'integer' },
  { label: 'boolean — on / off', value: 'boolean' },
];

const isTrue = (v) => v === 1 || v === true;

/**
 * Create / edit a FeatureType. Used by the Feature Types screen and, for quick
 * create, from the feature picker in the Plan editor.
 *
 * `data_type` comes first because it decides how `key` is entered:
 *   integer → a Select over the metered keys (GET /admin/feature-types/meters);
 *             picking one narrows reset_period to that meter's periods and
 *             prefills an empty label.
 *   boolean → free-text snake_case.
 * Keys held by another row are disabled (the API 409s on a duplicate). Server
 * errors (400 unmetered key / disallowed reset period, 409) show as a
 * form-level Alert — the mutations are silent.
 *
 * `onSaved(row)` gets the created/updated row so a caller can auto-select it.
 */
export default function FeatureTypeEditorModal({ open, featureType, onClose, onSaved }) {
  const isEdit = Boolean(featureType);
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const { data: featureTypes } = adminApi.endpoints.featureTypesList.useQuery(undefined, {
    skip: !open,
  });
  const { data: meters, isFetching: loadingMeters, isError: metersFailed } =
    useFeatureTypeMetersQuery(undefined, { skip: !open });
  const [createFeatureType] = useFeatureTypeCreateMutation();
  const [updateFeatureType] = useFeatureTypeUpdateMutation();

  const meterByKey = useMemo(() => meterMap(meters), [meters]);

  const dataType = Form.useWatch('data_type', form) || 'integer';
  const key = Form.useWatch('key', form);
  const resetPeriod = Form.useWatch('reset_period', form);
  const isInteger = dataType === 'integer';
  const meter = isInteger ? meterByKey.get(key) : undefined;

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.resetFields();
    form.setFieldsValue(
      isEdit
        ? {
            data_type: featureType.data_type || 'integer',
            key: featureType.key,
            label: featureType.label,
            description: featureType.description || '',
            reset_period: featureType.reset_period || 'never',
            is_topupable: isTrue(featureType.is_topupable),
          }
        : { data_type: 'integer', reset_period: 'never', is_topupable: false },
    );
  }, [open, isEdit, featureType, form]);

  // Keys another row already holds (the row being edited keeps its own).
  const usedKeys = useMemo(
    () =>
      new Set(
        (featureTypes || []).filter((f) => f.id !== featureType?.id).map((f) => f.key),
      ),
    [featureTypes, featureType],
  );

  // A legacy integer row's key isn't in /meters. Keep it selectable so the row
  // can be opened and shown as it is; saving it gets the API's 400.
  const legacyKey =
    isEdit &&
    featureType.data_type === 'integer' &&
    meters &&
    !meterByKey.has(featureType.key)
      ? featureType.key
      : null;

  const keyOptions = useMemo(() => {
    const opts = (meters || []).map((m) => {
      const taken = usedKeys.has(m.key);
      return {
        value: m.key,
        label: taken ? `${m.label} (${m.key}) — already used` : `${m.label} (${m.key})`,
        disabled: taken,
      };
    });
    if (legacyKey) {
      opts.unshift({ value: legacyKey, label: `${legacyKey} — not metered` });
    }
    return opts;
  }, [meters, usedKeys, legacyKey]);

  const allowedPeriods = meter?.reset_periods?.length ? meter.reset_periods : RESET_PERIODS;
  const periodOptions = allowedPeriods.map((v) => ({ label: v, value: v }));

  const onDataTypeChange = (next) => {
    setFormError(null);
    // An integer key must be metered; a boolean one can be anything.
    if (next === 'integer' && !meterByKey.has(form.getFieldValue('key'))) {
      form.setFieldsValue({ key: undefined });
    }
  };

  const onMeterChange = (nextKey) => {
    const m = meterByKey.get(nextKey);
    if (!m) return;
    if (!form.getFieldValue('label')) form.setFieldsValue({ label: m.label });
    const periods = m.reset_periods || [];
    if (periods.length && !periods.includes(form.getFieldValue('reset_period'))) {
      form.setFieldsValue({ reset_period: periods[0] });
    }
  };

  const handleOk = async () => {
    let v;
    try {
      v = await form.validateFields();
    } catch {
      return;
    }
    const body = {
      data_type: v.data_type,
      key: String(v.key).trim(),
      label: v.label,
      reset_period: v.reset_period,
      is_topupable: v.is_topupable ? 1 : 0,
    };
    if (isEdit) body.description = v.description || '';
    else if (v.description) body.description = v.description;

    setSaving(true);
    setFormError(null);
    try {
      const saved = isEdit
        ? await updateFeatureType({ id: featureType.id, body }).unwrap()
        : await createFeatureType(body).unwrap();
      message.success(isEdit ? 'Feature type updated' : 'Feature type created');
      onSaved?.(saved);
    } catch (e) {
      setFormError(
        e?.status === 409
          ? e?.message || 'Another feature type already uses this key.'
          : e?.message || 'Could not save the feature type.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isEdit ? `Edit feature type — ${featureType.label}` : 'New feature type'}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={saving}
      okText={isEdit ? 'Save' : 'Create'}
      width={560}
      destroyOnClose
    >
      {formError && (
        <Alert type="error" showIcon message={formError} style={{ marginBottom: 16 }} />
      )}
      {legacyKey && key === legacyKey && isInteger && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Not enforced"
          description="Nothing counts this key. Pick a metered key or make it boolean — saving it as it is will be refused."
        />
      )}
      <Form form={form} layout="vertical">
        <Form.Item name="data_type" label="Data type">
          <Select options={DATA_TYPE_OPTS} onChange={onDataTypeChange} />
        </Form.Item>

        {isInteger ? (
          <Form.Item
            name="key"
            label="Key"
            rules={[{ required: true, message: 'Pick a metered key' }]}
            extra={
              metersFailed
                ? 'Could not load the metered keys — reload the page to try again.'
                : 'Integer features are enforced limits, so the key must be one the app can count.'
            }
          >
            <Select
              placeholder="Pick a metered key"
              showSearch
              optionFilterProp="label"
              loading={loadingMeters}
              options={keyOptions}
              onChange={onMeterChange}
            />
          </Form.Item>
        ) : (
          <Form.Item
            name="key"
            label="Key"
            rules={[
              { required: true, message: 'Key is required' },
              {
                pattern: /^[a-z][a-z0-9_]*$/,
                message: 'snake_case: lowercase letters, digits and underscores',
              },
              {
                validator: (_r, val) =>
                  val && usedKeys.has(String(val).trim())
                    ? Promise.reject(new Error('Another feature type already uses this key'))
                    : Promise.resolve(),
              },
            ]}
            extra="Unique, snake_case — e.g. remove_watermark"
          >
            <Input placeholder="remove_watermark" />
          </Form.Item>
        )}

        <Form.Item
          name="label"
          label="Label"
          rules={[{ required: true, message: 'Label is required' }]}
        >
          <Input placeholder={isInteger ? 'Brand Frames' : 'Remove watermark'} />
        </Form.Item>
        <Form.Item name="description" label="Description">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item
          name="reset_period"
          label="Reset period"
          extra={
            isInteger && RESET_HINT[resetPeriod] ? (
              <Text type="secondary">{RESET_HINT[resetPeriod]}</Text>
            ) : undefined
          }
        >
          <Select options={periodOptions} />
        </Form.Item>
        {/* Gates the feature dropdown on Top-up Packs and on a support quota
            grant: the server refuses a pack for a feature that isn't flagged. */}
        <Form.Item
          name="is_topupable"
          label="Can be topped up"
          valuePropName="checked"
          extra="Allows top-up packs to be sold for this feature."
        >
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
