import { useEffect, useMemo, useState } from 'react';
import {
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Button,
  Space,
  Divider,
  Typography,
  App,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  useFaqCreateMutation,
  useFaqUpdateMutation,
  useFaqCategoryCreateMutation,
} from '../features/api/adminApi';

const { Text } = Typography;

/**
 * Create / edit a FAQ. The category picker is a searchable Select that can also
 * create a new category inline: typing a name that matches no existing option
 * offers a "+ Create category «X»" row → POST /admin/faq-categories, then links
 * the returned id as category_id. Duplicate names (any case) surface as a 409
 * inline error on the field.
 *
 * Maps the contract keys: question, answer, category_id|null, display_order?,
 * status ("active"|"inactive"). 400 VALIDATION_ERROR details map to inline
 * field errors.
 */
export default function FaqEditorDrawer({ open, faq, categories = [], onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const isEdit = Boolean(faq);

  const [createFaq, { isLoading: creating }] = useFaqCreateMutation();
  const [updateFaq, { isLoading: updating }] = useFaqUpdateMutation();
  const [createCategory, { isLoading: creatingCat }] = useFaqCategoryCreateMutation();

  const [catSearch, setCatSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setCatSearch('');
    form.setFieldsValue({
      question: faq?.question || '',
      answer: faq?.answer || '',
      category_id: faq?.category_id ?? undefined,
      display_order: faq?.display_order ?? undefined,
      active: faq ? faq.status === 'active' : true,
    });
  }, [open, faq, form]);

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ label: c.name, value: c.id })),
    [categories],
  );

  // Whether the current search exactly matches an existing category (case-insensitive).
  const searchMatchesExisting = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    if (!q) return true;
    return categories.some((c) => (c.name || '').trim().toLowerCase() === q);
  }, [catSearch, categories]);

  const handleCreateCategory = async () => {
    const name = catSearch.trim();
    if (!name) return;
    try {
      const created = await createCategory({ name }).unwrap();
      message.success(`Category "${created.name}" created`);
      form.setFieldsValue({ category_id: created.id });
      form.setFields([{ name: 'category_id', errors: [] }]);
      setCatSearch('');
      onSaved?.();
    } catch (err) {
      if (err?.status === 409) {
        form.setFields([
          { name: 'category_id', errors: [`A category named "${name}" already exists.`] },
        ]);
      } else {
        message.error(err?.message || 'Failed to create category.');
      }
    }
  };

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const body = {
      question: values.question,
      answer: values.answer,
      category_id: values.category_id ?? null,
      status: values.active ? 'active' : 'inactive',
    };
    if (values.display_order != null && values.display_order !== '') {
      body.display_order = Number(values.display_order);
    }

    try {
      if (isEdit) {
        await updateFaq({ uid: faq.uid, body }).unwrap();
        message.success('FAQ updated');
      } else {
        await createFaq(body).unwrap();
        message.success('FAQ created');
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      if (err?.code === 'VALIDATION_ERROR' && err.details?.length) {
        form.setFields(
          err.details
            .filter((d) => d.field)
            .map((d) => ({ name: d.field, errors: [d.message] })),
        );
      } else {
        message.error(err?.message || 'Failed to save FAQ.');
      }
    }
  };

  return (
    <Drawer
      title={isEdit ? 'Edit FAQ' : 'New FAQ'}
      open={open}
      onClose={onClose}
      width={600}
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={creating || updating} onClick={handleSubmit}>
            Save
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="question"
          label="Question"
          rules={[{ required: true, message: 'Question is required.' }]}
        >
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="The question" />
        </Form.Item>

        <Form.Item
          name="answer"
          label="Answer"
          extra="Long text — HTML is allowed."
          rules={[{ required: true, message: 'Answer is required.' }]}
        >
          <Input.TextArea autoSize={{ minRows: 4, maxRows: 12 }} placeholder="The answer" />
        </Form.Item>

        <Form.Item
          name="category_id"
          label="FAQ Category"
          extra="Optional. Type a new name to create a category on the fly."
        >
          <Select
            showSearch
            allowClear
            placeholder="Uncategorized"
            options={categoryOptions}
            searchValue={catSearch}
            onSearch={setCatSearch}
            optionFilterProp="label"
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            dropdownRender={(menu) => (
              <>
                {menu}
                {catSearch.trim() && !searchMatchesExisting && (
                  <>
                    <Divider style={{ margin: '8px 0' }} />
                    <Button
                      type="text"
                      block
                      icon={<PlusOutlined />}
                      loading={creatingCat}
                      style={{ textAlign: 'left' }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleCreateCategory}
                    >
                      Create category <Text strong>«{catSearch.trim()}»</Text>
                    </Button>
                  </>
                )}
              </>
            )}
          />
        </Form.Item>

        <Form.Item
          name="display_order"
          label="Sort order"
          extra="Optional manual override — reorder arrows on the list are the primary mechanism."
        >
          <InputNumber min={0} style={{ width: '100%' }} placeholder="0" />
        </Form.Item>

        <Form.Item name="active" label="Active" valuePropName="checked">
          <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
