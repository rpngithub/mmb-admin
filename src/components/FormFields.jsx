import { Form, Input, InputNumber, Switch, Select, DatePicker } from 'antd';

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
