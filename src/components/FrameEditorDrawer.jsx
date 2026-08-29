import { useEffect, useState } from 'react';
import {
  Drawer,
  Tabs,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Button,
  Space,
  Spin,
  Alert,
  Tag,
  Tooltip,
  Descriptions,
  Divider,
  Typography,
  App,
} from 'antd';
import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import {
  adminApi,
  useFrameCreateMutation,
  useFrameUpdateMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import {
  FRAME_TYPE_OPTIONS,
  FIELD_TO_KEY,
  STATUS_COLORS,
  applyFrameServerError,
  checkFrameCompleteness,
  formatPrice,
  isTrue,
  statusLabel,
  toAmount,
} from '../lib/frames';
import ImageUploadField from './ImageUploadField';

const { Text, Paragraph } = Typography;

// Every writable key that has a form item, so a 400's details[] can be pinned to
// the field that caused it.
const FORM_FIELDS = [
  'name',
  'description',
  'category_id',
  'frame_type',
  'is_premium',
  'price',
  'strike_price',
  'display_order',
  'thumbnail_s3_key',
  'content',
];

/**
 * Tabbed frame editor: Details (every writable field, including the design
 * payload and thumbnail) and Publish (the checklist + status actions).
 *
 * Frames are self-contained — the design references no uploaded asset files — so
 * there is no bundle step: `content` is a plain string that goes up with the
 * rest of the form, and the thumbnail is the only file involved.
 *
 * `status` is deliberately absent from Details. A frame is created as a draft
 * and only the Publish tab moves it, so the gate can't be sidestepped by the
 * ordinary save.
 */
export default function FrameEditorDrawer({ open, uid, onClose, onSaved }) {
  const [workingUid, setWorkingUid] = useState(uid || null);
  const [tab, setTab] = useState('details');

  useEffect(() => {
    if (open) {
      setWorkingUid(uid || null);
      setTab('details');
    }
  }, [open, uid]);

  const isCreate = !workingUid;

  return (
    <Drawer
      title={isCreate ? 'New Frame' : 'Edit Frame'}
      open={open}
      onClose={onClose}
      width={760}
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
                  onSaved?.();
                }}
                onSaved={onSaved}
              />
            ),
          },
          {
            key: 'publish',
            label: 'Publish',
            disabled: isCreate,
            children: workingUid ? (
              <PublishPanel uid={workingUid} onSaved={onSaved} onGoToDetails={() => setTab('details')} />
            ) : (
              <Alert type="info" showIcon message="Save the frame details first to unlock this step." />
            ),
          },
        ]}
      />
    </Drawer>
  );
}

// ---- Details ---------------------------------------------------------------

function DetailsForm({ uid, onCreated, onSaved }) {
  const { message } = App.useApp();
  const perms = usePermissions();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const isEdit = Boolean(uid);

  const canSave = isEdit ? perms.can('frames', 'update') : perms.can('frames', 'create');

  const { data: categories } = adminApi.endpoints.frameCategoriesList.useQuery();
  // ALWAYS the full record: the list omits `content`, so seeding this form from a
  // list row would PATCH an empty design payload over a real one.
  const { data: full, isFetching } = adminApi.endpoints.frameGet.useQuery(uid, { skip: !uid });
  const [createFrame] = useFrameCreateMutation();
  const [updateFrame] = useFrameUpdateMutation();

  const premium = isTrue(Form.useWatch('is_premium', form));
  const price = toAmount(Form.useWatch('price', form)) ?? 0;
  const strike = toAmount(Form.useWatch('strike_price', form));
  const content = Form.useWatch('content', form);

  useEffect(() => {
    if (isEdit && full) {
      form.setFieldsValue({
        name: full.name,
        description: full.description ?? '',
        category_id: full.category_id ?? undefined,
        frame_type: full.frame_type || 'static',
        is_premium: isTrue(full.is_premium),
        // DECIMAL columns arrive as strings — coerce so InputNumber and every
        // comparison below work on numbers.
        price: toAmount(full.price) ?? 0,
        strike_price: toAmount(full.strike_price) ?? undefined,
        display_order: full.display_order ?? 0,
        thumbnail_s3_key: full.thumbnail_s3_key || undefined,
        content: full.content ?? '',
      });
    } else if (!isEdit) {
      form.resetFields();
      form.setFieldsValue({
        frame_type: 'static',
        is_premium: false,
        price: 0,
        display_order: 0,
        content: '',
      });
    }
  }, [isEdit, full, form]);

  // Free means free: the server rejects a free frame with a price on publish, so
  // the field follows the switch instead of waiting to fail.
  const onPremiumChange = (checked) => {
    if (!checked) form.setFieldsValue({ price: 0 });
  };

  const formatContent = () => {
    const raw = form.getFieldValue('content');
    try {
      form.setFieldsValue({ content: JSON.stringify(JSON.parse(raw), null, 2) });
    } catch {
      message.warning('Not valid JSON — left as it is.');
    }
  };

  const contentIsJson = (() => {
    const raw = (content || '').trim();
    if (!raw) return null;
    try {
      JSON.parse(raw);
      return true;
    } catch {
      return false;
    }
  })();

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setFormError(null);

    const isPremium = Boolean(values.is_premium);
    const body = {
      name: values.name.trim(),
      // Empty string rather than null: clearing an optional text field this way
      // avoids the null-vs-omit rejection other endpoints here have.
      description: (values.description || '').trim(),
      category_id: values.category_id ?? null,
      frame_type: values.frame_type || 'static',
      is_premium: isPremium ? 1 : 0,
      price: isPremium ? Number(values.price || 0) : 0,
      strike_price: toAmount(values.strike_price),
      display_order: Number(values.display_order ?? 0),
      thumbnail_s3_key: values.thumbnail_s3_key || null,
      content: values.content || '',
    };
    // `status` is never sent here — it belongs to the Publish tab, and the API
    // creates every frame as a draft.

    setSubmitting(true);
    try {
      if (isEdit) {
        await updateFrame({ uid, body }).unwrap();
        message.success('Frame saved');
        onSaved?.();
      } else {
        const created = await createFrame(body).unwrap();
        message.success('Draft created — add the thumbnail and design, then publish it.');
        onCreated?.(created.uid);
      }
    } catch (err) {
      setFormError(applyFrameServerError(form, err, FORM_FIELDS));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Spin spinning={isEdit && isFetching}>
      {formError && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={formError} />}
      <Form form={form} layout="vertical" disabled={!canSave}>
        <Form.Item
          name="name"
          label="Name"
          extra="Unique across every frame, whatever its category."
          rules={[{ required: true, message: 'Name is required' }]}
        >
          <Input placeholder="e.g. Gold Ribbon" />
        </Form.Item>

        <Form.Item name="description" label="Description">
          <Input.TextArea rows={2} placeholder="Optional — a line about the look" />
        </Form.Item>

        <Space size="large" align="start" wrap>
          <Form.Item
            name="category_id"
            label="Category"
            extra="Required to publish — the store is browsed by category chip."
            style={{ minWidth: 260 }}
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Uncategorised"
              options={(categories || []).map((c) => ({ label: c.name, value: c.id }))}
            />
          </Form.Item>

          <Form.Item
            name="frame_type"
            label="Type"
            extra="The two tabs users see in the store."
            style={{ minWidth: 180 }}
          >
            <Select options={FRAME_TYPE_OPTIONS} />
          </Form.Item>

          <Form.Item
            name="display_order"
            label="Display order"
            extra="Dragging rows on the Frames list rewrites this."
          >
            <InputNumber min={0} style={{ width: 140 }} />
          </Form.Item>
        </Space>

        <Divider orientation="left" plain style={{ marginTop: 0 }}>
          Pricing
        </Divider>

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="A frame is bought on its own, for its own price."
          description="No subscription plan unlocks a frame — it is either free for everyone, or bought individually."
        />

        <Space size="large" align="start" wrap>
          <Form.Item
            name="is_premium"
            label="Premium"
            valuePropName="checked"
            extra="Off = anyone can add it."
          >
            <Switch onChange={onPremiumChange} />
          </Form.Item>

          <Form.Item
            name="price"
            label="Price"
            extra={premium ? 'What the user pays. Must be above zero.' : 'Free frames are priced at 0.'}
            rules={[
              {
                validator: (_r, v) => {
                  const n = toAmount(v) ?? 0;
                  if (premium && n <= 0) {
                    return Promise.reject(new Error('A premium frame needs a price above zero.'));
                  }
                  if (!premium && n !== 0) {
                    return Promise.reject(new Error('A free frame must be priced at 0.'));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <InputNumber
              min={0}
              precision={2}
              prefix="₹"
              style={{ width: 180 }}
              disabled={!premium}
            />
          </Form.Item>

          <Form.Item
            name="strike_price"
            label="Strike-through price"
            extra="Display only — the “was” figure struck out beside the price in the store. Nothing is ever charged against it, and it applies no discount."
          >
            <InputNumber min={0} precision={2} prefix="₹" style={{ width: 180 }} placeholder="—" />
          </Form.Item>
        </Space>

        {strike !== null && strike > 0 && strike <= price && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="The strike-through price is not above the price, so the store would show a “was” figure that reads as an increase."
          />
        )}

        <Divider orientation="left" plain>
          Artwork
        </Divider>

        <Form.Item
          name="thumbnail_s3_key"
          label="Thumbnail"
          extra="Uploads straight away, but only attaches to the frame when you save."
        >
          <ImageUploadField slot="frame_thumbnail" disabled={!canSave} />
        </Form.Item>

        <Form.Item
          name="content"
          label={
            <Space size={8}>
              <span>Content — the design payload</span>
              <Button size="small" onClick={formatContent} disabled={!canSave}>
                Format JSON
              </Button>
              {contentIsJson === false && <Tag color="warning">not valid JSON</Tag>}
            </Space>
          }
          extra="Self-contained: frame designs reference no uploaded asset files, so there is no bundle to upload. Stored as-is."
        >
          <Input.TextArea
            rows={10}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
            placeholder="Paste the design payload"
          />
        </Form.Item>

        <Paragraph type="secondary">
          New frames are created as <Text code>draft</Text>. Publishing happens on the Publish tab,
          once the category, design, thumbnail and price are in place.
        </Paragraph>

        <Button type="primary" loading={submitting} onClick={handleSubmit} disabled={!canSave}>
          {isEdit ? 'Save frame' : 'Create frame'}
        </Button>
      </Form>
    </Spin>
  );
}

// ---- Publish ---------------------------------------------------------------

function PublishPanel({ uid, onSaved, onGoToDetails }) {
  const { message } = App.useApp();
  const perms = usePermissions();
  const canUpdate = perms.can('frames', 'update');

  const { data: full, isFetching } = adminApi.endpoints.frameGet.useQuery(uid, { skip: !uid });
  const { data: categories } = adminApi.endpoints.frameCategoriesList.useQuery();
  const [updateFrame, { isLoading }] = useFrameUpdateMutation();

  const [serverErrors, setServerErrors] = useState({}); // requirement key → message
  const [otherError, setOtherError] = useState(null);

  const status = full?.status || 'draft';
  const { items, missing, complete } = checkFrameCompleteness(full);

  const categoryName =
    (categories || []).find((c) => c.id === full?.category_id)?.name ||
    (full?.category_id ? `#${full.category_id}` : null);

  const setStatus = async (next) => {
    setServerErrors({});
    setOtherError(null);
    try {
      await updateFrame({ uid, body: { status: next } }).unwrap();
      message.success(
        next === 'active'
          ? 'Published — the frame is live in the store'
          : `Status set to ${statusLabel(next)}`,
      );
      onSaved?.();
    } catch (err) {
      // The server runs the same checklist and is the authority; map its 400
      // details[] back onto our rows so a rejection reads inline, not as a toast.
      const details = Array.isArray(err?.details) ? err.details : [];
      const mapped = {};
      const rest = [];
      details.forEach((d) => {
        const key = FIELD_TO_KEY[d.field];
        if (key) mapped[key] = d.message;
        else rest.push(d.message);
      });
      setServerErrors(mapped);
      setOtherError(
        rest.length
          ? rest.join(' ')
          : Object.keys(mapped).length
            ? null
            : err?.message || 'Could not change the status.',
      );
    }
  };

  const strike = toAmount(full?.strike_price);

  return (
    <Spin spinning={isFetching}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space>
          <Text>Current status:</Text>
          <Tag color={STATUS_COLORS[status] || 'default'}>{statusLabel(status)}</Tag>
          {status !== 'active' && <Text type="secondary">Not in the store.</Text>}
        </Space>

        <Descriptions
          size="small"
          column={1}
          bordered
          items={[
            { key: 'name', label: 'Name', children: full?.name || <Text type="secondary">—</Text> },
            {
              key: 'category',
              label: 'Category',
              children: categoryName || <Text type="secondary">Uncategorised</Text>,
            },
            { key: 'type', label: 'Type', children: full?.frame_type || <Text type="secondary">—</Text> },
            {
              key: 'price',
              label: 'Price',
              children: isTrue(full?.is_premium) ? (
                <Space size={6}>
                  <Text strong>{formatPrice(full?.price)}</Text>
                  {strike !== null && strike > 0 && (
                    <Text type="secondary" delete>
                      {formatPrice(strike)}
                    </Text>
                  )}
                  <Tag color="gold">Premium</Tag>
                </Space>
              ) : (
                <Tag color="green">Free</Tag>
              ),
            },
            {
              key: 'content',
              label: 'Design',
              children: full?.content ? (
                <Tag color="green">Content saved</Tag>
              ) : (
                <Tag>No content</Tag>
              ),
            },
            {
              key: 'thumbnail',
              label: 'Thumbnail',
              children: full?.thumbnail_s3_key ? (
                <Tag color="green">Uploaded</Tag>
              ) : (
                <Tag>Missing</Tag>
              ),
            },
          ]}
        />

        {otherError && <Alert type="error" showIcon message={otherError} />}

        <div>
          <Text strong>Ready to publish?</Text>
          <Space direction="vertical" size={4} style={{ width: '100%', marginTop: 8 }}>
            {items.map((item) => (
              <Space key={item.key} size={8} align="start">
                {item.ok ? (
                  <CheckCircleFilled style={{ color: '#52c41a' }} />
                ) : (
                  <CloseCircleFilled style={{ color: '#ff4d4f' }} />
                )}
                <Text type={item.ok ? undefined : 'danger'}>{item.label}</Text>
                {!item.ok && (
                  <>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {serverErrors[item.key] || item.hint}
                    </Text>
                    <Button type="link" size="small" onClick={onGoToDetails}>
                      Go to details
                    </Button>
                  </>
                )}
              </Space>
            ))}
          </Space>
          <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            This reflects the last saved version — save your edits on Details first.
          </Paragraph>
        </div>

        <Divider style={{ margin: '4px 0' }} />

        <Paragraph type="secondary" style={{ margin: 0 }}>
          Only published frames appear in the store; a draft or retired frame is invisible there even
          to someone with a direct link. Retiring is never a clawback — everyone who already added or
          bought the frame keeps it.
        </Paragraph>

        <Space wrap>
          <Tooltip
            title={
              complete ? undefined : `Still missing: ${missing.map((m) => m.label).join(', ')}`
            }
          >
            <Button
              type="primary"
              loading={isLoading}
              disabled={!canUpdate || status === 'active' || !complete}
              onClick={() => setStatus('active')}
            >
              Publish
            </Button>
          </Tooltip>
          {/* Never gated: a frame that would no longer pass the checklist can
              still be pulled from the store. */}
          <Button
            loading={isLoading}
            disabled={!canUpdate || status === 'inactive'}
            onClick={() => setStatus('inactive')}
          >
            Retire (inactive)
          </Button>
          <Button
            loading={isLoading}
            disabled={!canUpdate || status === 'draft'}
            onClick={() => setStatus('draft')}
          >
            Back to draft
          </Button>
        </Space>
      </Space>
    </Spin>
  );
}
