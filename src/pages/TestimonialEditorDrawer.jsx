import { useEffect, useMemo } from 'react';
import {
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Rate,
  Button,
  Space,
  App,
} from 'antd';
import {
  adminApi,
  useTestimonialCreateMutation,
  useTestimonialUpdateMutation,
} from '../features/api/adminApi';
import ImageUploadField from '../components/ImageUploadField';

/**
 * Create / edit a testimonial. Only Author (name) + Content are required;
 * designation, business category, rating, photo and order are optional. Maps
 * contract keys: name, content, designation?, business_category_id|null,
 * rating?(1–5), photo_s3_key?, display_order?, status. 400 VALIDATION_ERROR
 * details map to inline field errors.
 */
export default function TestimonialEditorDrawer({ open, testimonial, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const isEdit = Boolean(testimonial);

  const [createTestimonial, { isLoading: creating }] = useTestimonialCreateMutation();
  const [updateTestimonial, { isLoading: updating }] = useTestimonialUpdateMutation();

  const { data: businessCategories = [] } = adminApi.endpoints.businessCategoriesList.useQuery();

  const categoryOptions = useMemo(
    () => businessCategories.map((c) => ({ label: c.name, value: c.id })),
    [businessCategories],
  );

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      name: testimonial?.name || '',
      content: testimonial?.content || '',
      designation: testimonial?.designation || '',
      business_category_id: testimonial?.business_category_id ?? undefined,
      rating: testimonial?.rating ?? undefined,
      photo_s3_key: testimonial?.photo_s3_key ?? undefined,
      display_order: testimonial?.display_order ?? undefined,
      active: testimonial ? testimonial.status === 'active' : true,
    });
  }, [open, testimonial, form]);

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const body = {
      name: values.name,
      content: values.content,
      designation: values.designation || null,
      business_category_id: values.business_category_id ?? null,
      rating: values.rating || null,
      photo_s3_key: values.photo_s3_key || null,
      status: values.active ? 'active' : 'inactive',
    };
    if (values.display_order != null && values.display_order !== '') {
      body.display_order = Number(values.display_order);
    }

    try {
      if (isEdit) {
        await updateTestimonial({ uid: testimonial.uid, body }).unwrap();
        message.success('Testimonial updated');
      } else {
        await createTestimonial(body).unwrap();
        message.success('Testimonial created');
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      if (err?.code === 'VALIDATION_ERROR' && err.details?.length) {
        form.setFields(
          err.details.filter((d) => d.field).map((d) => ({ name: d.field, errors: [d.message] })),
        );
      } else {
        message.error(err?.message || 'Failed to save testimonial.');
      }
    }
  };

  return (
    <Drawer
      title={isEdit ? 'Edit Testimonial' : 'New Testimonial'}
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
          name="name"
          label="Author"
          extra="Name shown on the testimonial card."
          rules={[{ required: true, message: 'Author name is required.' }]}
        >
          <Input placeholder="e.g. Jane Doe" />
        </Form.Item>

        <Form.Item
          name="content"
          label="Content"
          extra="The quote/review text."
          rules={[{ required: true, message: 'Content is required.' }]}
        >
          <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} placeholder="The testimonial" />
        </Form.Item>

        <Form.Item
          name="designation"
          label="Designation / Headline"
          extra="The bold line under the name — a role (e.g. 'Founder, Acme Bakery') or a short headline."
        >
          <Input placeholder="Founder, Acme Bakery" />
        </Form.Item>

        <Form.Item
          name="business_category_id"
          label="Industry"
          extra="Tags which industry this customer is in — used to show relevant testimonials. Not shown on the public card."
        >
          <Select
            showSearch
            allowClear
            placeholder="Select an industry"
            options={categoryOptions}
            optionFilterProp="label"
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </Form.Item>

        <Form.Item name="rating" label="Rating" extra="Optional 1–5 star rating.">
          <Rate allowClear />
        </Form.Item>

        <Form.Item
          name="photo_s3_key"
          label="Photo"
          extra="Square image works best; shown as the avatar."
        >
          <ImageUploadField slot="testimonial" />
        </Form.Item>

        <Form.Item name="display_order" label="Sort order">
          <InputNumber min={0} style={{ width: '100%' }} placeholder="0" />
        </Form.Item>

        <Form.Item name="active" label="Active" valuePropName="checked">
          <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
