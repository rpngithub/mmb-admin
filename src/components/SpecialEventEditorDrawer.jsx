import { useEffect, useMemo, useState } from 'react';
import {
  Drawer,
  Tabs,
  Form,
  Input,
  Select,
  Switch,
  Segmented,
  DatePicker,
  Button,
  Space,
  Spin,
  Alert,
  Row,
  Col,
  Typography,
  App,
} from 'antd';
import dayjs from 'dayjs';
import { adminApi } from '../features/api/adminApi';
import ImageUploadField from './ImageUploadField';

const { Text, Paragraph } = Typography;
const isTrue = (v) => v === true || v === 1 || v === '1';

const TYPE_OPTIONS = [
  { label: 'Holiday', value: 'holiday' },
  { label: 'Observance', value: 'observance' },
  { label: 'Awareness', value: 'awareness' },
  { label: 'Custom', value: 'custom' },
];

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => {
  const mm = String(i + 1).padStart(2, '0');
  return { label: dayjs().month(i).format('MMMM'), value: mm };
});

const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => {
  const dd = String(i + 1).padStart(2, '0');
  return { label: dd, value: dd };
});

/**
 * Tabbed editor for a special event:
 *   • Details — name, description, type, recurrence-driven date, thumbnail,
 *     banner, active.
 *   • Linked designs — the templates surfaced when a user taps this event
 *     (full replace of template_ids).
 *
 * Linked designs needs an event uid, so for a NEW event you save Details first;
 * the drawer keeps that uid and unlocks the tab.
 */
export default function SpecialEventEditorDrawer({ open, event, onClose, onSaved }) {
  const [workingUid, setWorkingUid] = useState(event?.uid || null);
  const [tab, setTab] = useState('details');

  useEffect(() => {
    if (open) {
      setWorkingUid(event?.uid || null);
      setTab('details');
    }
  }, [open, event]);

  const isCreate = !workingUid;

  return (
    <Drawer
      title={isCreate ? 'New Special Event' : `Edit "${event?.name ?? 'Special Event'}"`}
      open={open}
      onClose={onClose}
      width={680}
      destroyOnClose
    >
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'details',
            label: 'Details',
            children: (
              <DetailsForm
                uid={workingUid}
                onCreated={(newUid) => {
                  setWorkingUid(newUid);
                  setTab('templates');
                  onSaved?.();
                }}
                onSaved={onSaved}
              />
            ),
          },
          {
            key: 'templates',
            label: 'Linked designs',
            disabled: isCreate,
            children: workingUid ? <TemplatesPanel uid={workingUid} /> : <NeedsUid />,
          },
        ]}
      />
    </Drawer>
  );
}

function NeedsUid() {
  return <Alert type="info" showIcon message="Save the event details first to unlock this step." />;
}

// ---- Details ---------------------------------------------------------------

function DetailsForm({ uid, onCreated, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const isEdit = Boolean(uid);

  const { data: full, isFetching } = adminApi.endpoints.specialEventsGet.useQuery(uid, {
    skip: !uid,
  });
  const [createEvent] = adminApi.endpoints.specialEventCreate.useMutation();
  const [updateEvent] = adminApi.endpoints.specialEventUpdate.useMutation();

  // Drives which date control is shown AND is_recurring.
  const recurrence = Form.useWatch('recurrence', form);

  useEffect(() => {
    if (isEdit && full) {
      const recurring = isTrue(full.is_recurring);
      const [mm, dd] = (full.event_date || '').split('-');
      form.setFieldsValue({
        name: full.name,
        description: full.description ?? '',
        type: full.type ?? undefined,
        recurrence: recurring ? 'yearly' : 'one_time',
        event_month: mm || undefined,
        event_day: dd || undefined,
        full_date: full.full_date ? dayjs(full.full_date) : undefined,
        thumbnail_s3_key: full.thumbnail_s3_key ?? undefined,
        banner_s3_key: full.banner_s3_key ?? undefined,
        is_active: isTrue(full.is_active),
      });
    } else if (!isEdit) {
      form.resetFields();
      form.setFieldsValue({ recurrence: 'yearly', is_active: true });
    }
  }, [isEdit, full, form]);

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const description = values.description?.trim();
    const body = {
      name: values.name.trim(),
      type: values.type,
      thumbnail_s3_key: values.thumbnail_s3_key ?? null,
      banner_s3_key: values.banner_s3_key ?? null,
      is_active: values.is_active ? 1 : 0,
    };
    // description is optional — the server's Joi.string() rejects null
    // ("description must be a string"), so send it only when non-empty rather
    // than sending null for a blank field.
    if (description) body.description = description;
    // Send only the date field for the chosen mode. The server treats
    // event_date/full_date as Joi.string(), so nulling the inactive one 400s
    // ("... must be a string") — omit it instead.
    if (values.recurrence === 'one_time') {
      body.is_recurring = 0;
      body.full_date = values.full_date.format('YYYY-MM-DD');
    } else {
      body.is_recurring = 1;
      body.event_date = `${values.event_month}-${values.event_day}`;
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        await updateEvent({ uid, body }).unwrap();
        message.success('Details saved');
        onSaved?.();
      } else {
        const created = await createEvent(body).unwrap();
        message.success('Event created — now link the designs it should surface');
        onCreated?.(created.uid);
      }
    } catch (err) {
      if (err?.status === 409) {
        form.setFields([{ name: 'name', errors: ['An event with this name already exists'] }]);
      } else {
        // Best-effort inline mapping onto fields that ACTUALLY exist in this
        // form; anything else (e.g. event_date / full_date / is_recurring, which
        // aren't 1:1 with a rendered item) is surfaced as a toast so a 400 is
        // never silent.
        const FORM_FIELDS = new Set([
          'name',
          'description',
          'type',
          'event_month',
          'event_day',
          'full_date',
          'is_active',
        ]);
        const details = Array.isArray(err?.details) ? err.details : [];
        const inline = details.filter((d) => d.field && FORM_FIELDS.has(d.field));
        if (inline.length) {
          form.setFields(inline.map((d) => ({ name: d.field, errors: [d.message] })));
        }
        const rest = details
          .filter((d) => !inline.includes(d))
          .map((d) => (d.field ? `${d.field}: ${d.message}` : d.message));
        if (rest.length) {
          message.error(rest.join('; '));
        } else if (!inline.length) {
          message.error(err?.message || 'Failed to save event.');
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Spin spinning={isEdit && isFetching}>
      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label="Name"
          rules={[{ required: true, message: 'Name is required' }]}
        >
          <Input placeholder="e.g. Christmas" maxLength={200} />
        </Form.Item>

        <Form.Item name="description" label="Description">
          <Input.TextArea rows={3} placeholder="Optional — shown on the event" />
        </Form.Item>

        <Form.Item
          name="type"
          label="Type"
          rules={[{ required: true, message: 'Type is required' }]}
        >
          <Select options={TYPE_OPTIONS} placeholder="Select a type" />
        </Form.Item>

        <Form.Item name="recurrence" label="When">
          <Segmented
            options={[
              { label: 'Repeats every year', value: 'yearly' },
              { label: 'One-time date', value: 'one_time' },
            ]}
          />
        </Form.Item>

        {recurrence === 'one_time' ? (
          <Form.Item
            name="full_date"
            label="Date"
            rules={[{ required: true, message: 'Pick the date' }]}
          >
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
        ) : (
          <Form.Item label="Recurring date" required style={{ marginBottom: 0 }}>
            <Row gutter={12}>
              <Col span={14}>
                <Form.Item
                  name="event_month"
                  rules={[{ required: true, message: 'Month is required' }]}
                >
                  <Select options={MONTH_OPTIONS} placeholder="Month" />
                </Form.Item>
              </Col>
              <Col span={10}>
                <Form.Item
                  name="event_day"
                  rules={[{ required: true, message: 'Day is required' }]}
                >
                  <Select options={DAY_OPTIONS} placeholder="Day" showSearch />
                </Form.Item>
              </Col>
            </Row>
          </Form.Item>
        )}

        <Space size="large" align="start" wrap>
          <Form.Item name="thumbnail_s3_key" label="Thumbnail (card cover)">
            <ImageUploadField slot="special_event_thumbnail" />
          </Form.Item>

          <Form.Item name="banner_s3_key" label="Banner (wide hero)">
            <ImageUploadField slot="special_event_banner" />
          </Form.Item>
        </Space>

        <Form.Item name="is_active" label="Active" valuePropName="checked">
          <Switch />
        </Form.Item>

        <div>
          <Button type="primary" loading={submitting} onClick={handleSubmit}>
            {isEdit ? 'Save details' : 'Create event'}
          </Button>
        </div>
      </Form>
    </Spin>
  );
}

// ---- Linked designs — assigned templates (full replace) --------------------

function TemplatesPanel({ uid }) {
  const { message } = App.useApp();
  const { data: full, isFetching } = adminApi.endpoints.specialEventTemplates.useQuery(uid, {
    skip: !uid,
  });
  const { data: templatesPage } = adminApi.endpoints.templatesList.useQuery({ limit: 1000 });
  const [setTemplates, { isLoading: saving }] =
    adminApi.endpoints.specialEventSetTemplates.useMutation();

  const [value, setValue] = useState([]);

  useEffect(() => {
    if (full) setValue((full.Templates || []).map((t) => t.id));
  }, [full]);

  const options = useMemo(
    () =>
      (templatesPage?.items || []).map((t) => ({
        label: t.template_type ? `${t.name} · ${t.template_type}` : t.name,
        value: t.id,
      })),
    [templatesPage],
  );

  const save = async () => {
    try {
      // Full replace of template_ids (numeric ids). An empty array unlinks all.
      await setTemplates({ uid, template_ids: value }).unwrap();
      message.success('Linked designs saved');
    } catch {
      // error notification handled by baseQuery
    }
  };

  return (
    <Spin spinning={isFetching}>
      <Space direction="vertical" style={{ width: '100%' }} size={14}>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          The designs surfaced when a user taps this event on the calendar (full replace). Clear all
          to unlink every design.
        </Paragraph>
        <div>
          <Text type="secondary">Linked designs</Text>
          <Select
            mode="multiple"
            allowClear
            style={{ width: '100%', marginTop: 4 }}
            value={value}
            onChange={setValue}
            options={options}
            optionFilterProp="label"
            placeholder="Select designs to link"
            maxTagCount="responsive"
          />
        </div>
        <Button type="primary" loading={saving} onClick={save}>
          Save linked designs
        </Button>
      </Space>
    </Spin>
  );
}
