import { Form, Input, InputNumber, Switch, Select, DatePicker, ColorPicker, Space } from 'antd';
import ImageUploadField from './ImageUploadField';

/**
 * Hex colour input whose form value is always a plain `#rrggbb` string (never a
 * ColorPicker Color object), because that's what the API stores and validates.
 * `disabledAlpha` keeps toHexString() at six digits; the text box next to the
 * swatch lets a brand hex be pasted straight in.
 */
function ColorField({ value, onChange, placeholder, disabled }) {
  return (
    <Space>
      <ColorPicker
        value={value || undefined}
        format="hex"
        disabledAlpha
        disabled={disabled}
        onChange={(c) => onChange?.(c.toHexString().toLowerCase())}
      />
      <Input
        style={{ width: 140 }}
        placeholder={placeholder || '#RRGGBB'}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </Space>
  );
}

/**
 * Render a list of field configs as AntD Form.Items. Shared by ResourceManager
 * and any bespoke page (e.g. Admins) that needs a config-driven form.
 */
export default function FormFields({ fields }) {
  return (
    <>
      {fields.map((f) => {
        const rules = [...(f.rules || [])];
        if (f.required) rules.push({ required: true, message: `${f.label} is required` });

        const itemProps = {
          key: f.name,
          name: f.name,
          label: f.label,
          rules,
          help: f.help,
          extra: f.extra,
        };

        switch (f.type) {
          case 'switch':
            return (
              <Form.Item
                {...itemProps}
                valuePropName="checked"
                initialValue={f.initialValue ?? false}
              >
                <Switch />
              </Form.Item>
            );
          case 'number':
            return (
              <Form.Item {...itemProps}>
                <InputNumber style={{ width: '100%' }} placeholder={f.placeholder} />
              </Form.Item>
            );
          case 'textarea':
            return (
              <Form.Item {...itemProps}>
                <Input.TextArea rows={3} placeholder={f.placeholder} />
              </Form.Item>
            );
          case 'json':
            return (
              <Form.Item {...itemProps}>
                <Input.TextArea
                  rows={5}
                  placeholder={f.placeholder || '{ ... } or [ ... ] JSON'}
                  style={{ fontFamily: 'monospace' }}
                />
              </Form.Item>
            );
          case 'password':
            return (
              <Form.Item {...itemProps}>
                <Input.Password placeholder={f.placeholder} autoComplete="new-password" />
              </Form.Item>
            );
          case 'date':
            return (
              <Form.Item {...itemProps}>
                <DatePicker style={{ width: '100%' }} showTime />
              </Form.Item>
            );
          case 'select':
            return (
              <Form.Item {...itemProps}>
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder={f.placeholder}
                  options={f.options}
                  loading={f.loading}
                />
              </Form.Item>
            );
          case 'color':
            return (
              <Form.Item {...itemProps}>
                <ColorField placeholder={f.placeholder} />
              </Form.Item>
            );
          case 'image':
            // Value is the confirmed S3 key; `slot` picks the typed upload slot.
            return (
              <Form.Item {...itemProps}>
                <ImageUploadField slot={f.slot} />
              </Form.Item>
            );
          case 'tags':
            return (
              <Form.Item {...itemProps}>
                <Select
                  mode="tags"
                  allowClear
                  tokenSeparators={[',']}
                  placeholder={f.placeholder || 'Type and press enter'}
                  options={f.options}
                />
              </Form.Item>
            );
          case 'text':
          default:
            return (
              <Form.Item {...itemProps}>
                <Input placeholder={f.placeholder} />
              </Form.Item>
            );
        }
      })}
    </>
  );
}
