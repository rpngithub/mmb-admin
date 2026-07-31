import { useState } from 'react';
import { Modal, Form, Input, Select, App } from 'antd';
import { adminApi } from '../../features/api/adminApi';

/**
 * Inline quick-create for a FeatureType, opened from the feature select inside
 * the Plan editor. Commits immediately and independently (POST /admin/feature-types)
 * — the new type persists in the catalog even if the surrounding plan save later
 * fails. On success, `onCreated(newType)` lets the caller auto-select it.
 */
export default function FeatureTypeModal({ open, onClose, onCreated }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [createFeatureType] = adminApi.endpoints.featureTypesCreate.useMutation();
  const [saving, setSaving] = useState(false);

  const handleOk = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const created = await createFeatureType({
        key: values.key,
        label: values.label,
        description: values.description || undefined,
        reset_period: values.reset_period,
        data_type: values.data_type,
      }).unwrap();
      message.success('Feature type created');
      onCreated?.(created);
      form.resetFields();
    } catch {
      // 409 (duplicate key) etc. surface via the global notification; keep open
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="New feature type"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Create"
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ reset_period: 'never', data_type: 'integer' }}
      >
        <Form.Item
          name="key"
          label="Key"
          rules={[{ required: true, message: 'Key is required' }]}
          help="Unique machine key, e.g. exports_per_month"
        >
          <Input placeholder="exports_per_month" />
        </Form.Item>
        <Form.Item
          name="label"
          label="Label"
          rules={[{ required: true, message: 'Label is required' }]}
        >
          <Input placeholder="Exports per month" />
        </Form.Item>
        <Form.Item name="description" label="Description">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="reset_period" label="Reset period">
          <Select options={['monthly', 'annual', 'never'].map((v) => ({ label: v, value: v }))} />
        </Form.Item>
        <Form.Item name="data_type" label="Data type">
          <Select options={['integer', 'boolean'].map((v) => ({ label: v, value: v }))} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
