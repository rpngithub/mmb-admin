import { useEffect, useState } from 'react';
import { Modal, Form, AutoComplete, Alert, Typography, Space, App } from 'antd';
import {
  usePageSectionCreateMutation,
  usePageSectionUpdateMutation,
} from '../features/api/adminApi';
import ImageUploadField from './ImageUploadField';
import TokenTextField from './TokenTextField';
import {
  PAGE_KEY,
  SECTION_KEY_SUGGESTIONS,
  SECTION_KEY_PATTERN,
  SECTION_KEY_MAX,
  SECTION_IMAGE_SLOT,
  SECTION_FORM_FIELDS,
  TOKEN_HELP,
  nullableText,
  applyServerError,
  diffBody,
} from '../lib/pageContent';

const { Text, Paragraph } = Typography;

function formValuesFrom(record) {
  return {
    section_key: record?.section_key ?? '',
    eyebrow: record?.eyebrow ?? '',
    heading: record?.heading ?? '',
    subheading: record?.subheading ?? '',
    image_s3_key: record?.image_s3_key || undefined,
  };
}

/** The writable body for the text + image fields, empties as null. */
function copyBodyFrom(values) {
  return {
    eyebrow: nullableText(values.eyebrow),
    heading: nullableText(values.heading),
    subheading: nullableText(values.subheading),
    image_s3_key: values.image_s3_key || null,
  };
}

/**
 * Create / edit one section (block). `scope` says which level it lives at:
 * `{ businessCategoryId: null }` for a shared default, or the industry's id
 * (and name, for the title) for that industry's own copy.
 *
 * `section_key` is the contract with the website. It is an AutoComplete on
 * create — the three known keys are suggested, free text is allowed — and
 * read-only text afterwards: renaming a published key blanks that block on the
 * live site, so the UI does not invite it even though the API allows it.
 *
 * `display_order` is set by dragging on the page and `is_active` by the card's
 * Hide / Show actions (hiding has cascade semantics — see the page), so neither
 * is here.
 */
export default function PageSectionEditorModal({ open, record, scope, onClose }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const isEdit = Boolean(record);

  const [createSection] = usePageSectionCreateMutation();
  const [updateSection] = usePageSectionUpdateMutation();

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.resetFields();
    form.setFieldsValue(formValuesFrom(record));
  }, [open, record, form]);

  const scopeLabel =
    scope?.businessCategoryId == null ? 'Default (all industries)' : scope?.industryName || 'this industry';

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      if (isEdit) {
        // PATCH is partial and an empty one is a 400 — send only what moved.
        const patch = diffBody(copyBodyFrom(values), copyBodyFrom(formValuesFrom(record)));
        if (Object.keys(patch).length === 0) {
          message.info('Nothing to save — no fields changed.');
          setSubmitting(false);
          return;
        }
        await updateSection({ uid: record.uid, body: patch }).unwrap();
        message.success('Block saved');
      } else {
        const copy = copyBodyFrom(values);
        const body = {
          page_key: PAGE_KEY,
          business_category_id: scope?.businessCategoryId ?? null,
          section_key: (values.section_key || '').trim(),
          is_active: 1,
        };
        // Optional fields are left out rather than sent as null on create.
        for (const [k, v] of Object.entries(copy)) if (v != null) body[k] = v;
        await createSection(body).unwrap();
        message.success('Block created');
      }
      onClose?.();
    } catch (err) {
      // The section_key 400 says exactly what is wrong with the key; a 409 says
      // which level already has it. Both go up verbatim.
      setFormError(applyServerError(form, err, SECTION_FORM_FIELDS, 'Could not save the block.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={isEdit ? `Edit “${record?.heading || record?.section_key}”` : `New block — ${scopeLabel}`}
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      okText={isEdit ? 'Save' : 'Create'}
      confirmLoading={submitting}
      destroyOnClose
      width={640}
    >
      {formError && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={formError} />}

      <Form form={form} layout="vertical">
        {isEdit ? (
          <Form.Item
            label="Section key"
            extra="The website renders this block by its key. Renaming a published key would blank the block on the live site, so it cannot be changed here."
          >
            <Text code>{record?.section_key}</Text>
          </Form.Item>
        ) : (
          <Form.Item
            name="section_key"
            label="Section key"
            extra="Lowercase letters, digits and underscores. The website renders a block by this key — pick a known one, or a new one the website team has agreed."
            rules={[
              { required: true, message: 'A section key is required' },
              { max: SECTION_KEY_MAX, message: `At most ${SECTION_KEY_MAX} characters` },
              {
                pattern: SECTION_KEY_PATTERN,
                message: 'Lowercase letters, digits and underscores only (e.g. content_ideas).',
              },
            ]}
          >
            <AutoComplete
              placeholder="e.g. content_ideas"
              options={SECTION_KEY_SUGGESTIONS.map((s) => ({
                value: s.value,
                label: (
                  <Space>
                    <Text code>{s.value}</Text>
                    <Text type="secondary">{s.hint}</Text>
                  </Space>
                ),
              }))}
              filterOption={(input, option) =>
                String(option?.value || '').includes((input || '').toLowerCase())
              }
            />
          </Form.Item>
        )}

        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
          {TOKEN_HELP}
        </Paragraph>

        <Form.Item name="eyebrow" label="Eyebrow" extra="The small pill above the heading.">
          <TokenTextField placeholder="e.g. Why Choose Make My Brand?" maxLength={255} />
        </Form.Item>

        <Form.Item name="heading" label="Heading">
          <TokenTextField
            placeholder="e.g. Everything You Need to Market Your {{industry}} Business Online"
            maxLength={255}
          />
        </Form.Item>

        <Form.Item name="subheading" label="Subheading" extra="The sentence or two under the heading.">
          <TokenTextField multiline rows={3} placeholder="Optional" />
        </Form.Item>

        <Form.Item
          name="image_s3_key"
          label="Illustration"
          extra="Optional — the block's image (the phone mockup)."
        >
          <ImageUploadField slot={SECTION_IMAGE_SLOT} />
        </Form.Item>

        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Order is set by dragging the blocks on the page; visibility by the block’s Hide / Show
          buttons.
        </Paragraph>
      </Form>
    </Modal>
  );
}
