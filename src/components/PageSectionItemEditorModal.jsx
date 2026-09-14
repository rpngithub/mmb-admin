import { useEffect, useState } from 'react';
import { Modal, Form, Input, Switch, Alert, Typography, App } from 'antd';
import {
  usePageSectionItemCreateMutation,
  usePageSectionItemUpdateMutation,
} from '../features/api/adminApi';
import ImageUploadField from './ImageUploadField';
import TokenTextField from './TokenTextField';
import {
  ITEM_ICON_SLOT,
  ITEM_FORM_FIELDS,
  ITEM_SHAPE_HINT,
  TOKEN_HELP,
  isTrue,
  nullableText,
  applyServerError,
  diffBody,
} from '../lib/pageContent';

const { Paragraph } = Typography;

function formValuesFrom(record) {
  return {
    title: record?.title ?? '',
    body: record?.body ?? '',
    icon_s3_key: record?.icon_s3_key || undefined,
    link_url: record?.link_url ?? '',
    is_active: record ? isTrue(record.is_active) : true,
  };
}

function bodyFrom(values) {
  return {
    title: nullableText(values.title),
    body: nullableText(values.body),
    icon_s3_key: values.icon_s3_key || null,
    link_url: nullableText(values.link_url),
    is_active: values.is_active ? 1 : 0,
  };
}

/**
 * Create / edit one item — a card, a chip or a step inside a section. The
 * website decides how an item LOOKS from its section's key; the editor just
 * shows all four fields. At least one of title / body / icon is required.
 *
 * `sectionId` is the section's INTEGER id (required on create).
 */
export default function PageSectionItemEditorModal({ open, record, sectionId, sectionLabel, onClose }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const isEdit = Boolean(record);

  const [createItem] = usePageSectionItemCreateMutation();
  const [updateItem] = usePageSectionItemUpdateMutation();

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.resetFields();
    form.setFieldsValue(formValuesFrom(record));
  }, [open, record, form]);

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setFormError(null);

    const next = bodyFrom(values);
    if (!next.title && !next.body && !next.icon_s3_key) {
      setFormError('An item needs at least a title, a description or an icon.');
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        const patch = diffBody(next, bodyFrom(formValuesFrom(record)));
        if (Object.keys(patch).length === 0) {
          message.info('Nothing to save — no fields changed.');
          setSubmitting(false);
          return;
        }
        await updateItem({ uid: record.uid, body: patch }).unwrap();
        message.success('Item saved');
      } else {
        const body = { section_id: sectionId, is_active: next.is_active };
        for (const [k, v] of Object.entries(next)) if (v != null) body[k] = v;
        await createItem(body).unwrap();
        message.success('Item added');
      }
      onClose?.();
    } catch (err) {
      setFormError(applyServerError(form, err, ITEM_FORM_FIELDS, 'Could not save the item.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={
        isEdit
          ? `Edit item${record?.title ? ` — ${record.title}` : ''}`
          : `New item${sectionLabel ? ` — ${sectionLabel}` : ''}`
      }
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      okText={isEdit ? 'Save' : 'Add'}
      confirmLoading={submitting}
      destroyOnClose
      width={600}
    >
      {formError && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={formError} />}

      <Form form={form} layout="vertical">
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
          {TOKEN_HELP}
        </Paragraph>

        <Form.Item name="title" label="Title" extra="The chip label, or the card title.">
          <TokenTextField placeholder="e.g. Seasonal offers" maxLength={255} />
        </Form.Item>

        <Form.Item name="body" label="Description" extra="Card description — chips leave it empty.">
          <TokenTextField multiline rows={3} placeholder="Optional" />
        </Form.Item>

        <Form.Item name="icon_s3_key" label="Icon" extra="Card icon — chips leave it empty.">
          <ImageUploadField slot={ITEM_ICON_SLOT} />
        </Form.Item>

        <Form.Item
          name="link_url"
          label="Link"
          extra="Optional — the website decides whether to render it."
          rules={[{ type: 'url', message: 'Enter a full URL, e.g. https://…' }]}
        >
          <Input placeholder="https://" />
        </Form.Item>

        <Form.Item
          name="is_active"
          label="Visible"
          valuePropName="checked"
          extra="Switching it off hides this item without deleting it."
        >
          <Switch />
        </Form.Item>

        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {ITEM_SHAPE_HINT}
        </Paragraph>
      </Form>
    </Modal>
  );
}
