import { InputNumber, Switch, Checkbox, Space } from 'antd';

/**
 * Controlled input for a plan-feature value, driven by the FeatureType's
 * `dataType`. Designed to live inside a Form.Item (value/onChange).
 *
 *   boolean → Switch (on = 1, off = 0)
 *   integer → number input + "Unlimited" toggle (sets value = -1)
 *
 * Value semantics: -1 = unlimited, 0 = none/off, >0 = count, 1 = boolean-on.
 */
export default function FeatureValueInput({ value, onChange, dataType = 'integer' }) {
  if (dataType === 'boolean') {
    return (
      <Switch
        checked={value === 1 || value === true}
        checkedChildren="On"
        unCheckedChildren="Off"
        onChange={(c) => onChange?.(c ? 1 : 0)}
      />
    );
  }

  const unlimited = value === -1;
  return (
    <Space>
      <InputNumber
        min={0}
        style={{ width: 120 }}
        placeholder="Count"
        value={unlimited ? null : value}
        disabled={unlimited}
        onChange={(v) => onChange?.(v ?? 0)}
      />
      <Checkbox
        checked={unlimited}
        onChange={(e) => onChange?.(e.target.checked ? -1 : 0)}
      >
        Unlimited
      </Checkbox>
    </Space>
  );
}
