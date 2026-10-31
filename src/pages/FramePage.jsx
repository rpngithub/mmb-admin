import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Button,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  Alert,
  Result,
  Row,
  Col,
  App,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  DeleteOutlined,
  MergeCellsOutlined,
} from '@ant-design/icons';
import { adminApi } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import {
  FRAME_TYPE_OPTIONS,
  FIELD_TO_KEY,
  STATUS_COLORS,
  applyFrameServerError,
  checkFrameCompleteness,
  isTrue,
  statusLabel,
  toAmount,
} from '../lib/frames';
import { FRAME_VERSIONS } from '../lib/versionKinds';
import TemplateVersionGrid from '../components/TemplateVersionGrid';
import { MergeFrameModal } from '../components/FrameMoveModals';

const { Title, Text, Paragraph } = Typography;

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
];

/**
 * One FRAME: shared details + the publish gate on top, the language × size
 * version grid below — the same screen as a template design, and the grid +
 * bundle modal are literally the template ones (kind = FRAME_VERSIONS).
 * `/frames/new` shows only the details form; saving it creates a draft and
 * moves to the real screen.
 *
 * `content` / `thumbnail_s3_key` live on the versions (uploaded as a ZIP
 * bundle per version) — /admin/frames rejects them.
 */
export default function FramePage() {
  const { uid: routeUid } = useParams();
  const isCreate = routeUid === 'new';
  const uid = isCreate ? null : routeUid;
  const navigate = useNavigate();
  const location = useLocation();
  const perms = usePermissions();
  const { message, modal } = App.useApp();
  const [mergeOpen, setMergeOpen] = useState(false);

  const canUpdate = perms.can('frames', 'update');
  const canDelete = perms.can('frames', 'delete');

  const {
    data: frame,
    isLoading,
    isFetching,
    error,
  } = adminApi.endpoints.frameGet.useQuery(uid, { skip: !uid });
  const { data: versions, isFetching: versionsFetching } =
    adminApi.endpoints.frameVersionsByFrame.useQuery(uid, { skip: !uid });
  const [removeFrame] = adminApi.endpoints.frameRemove.useMutation();

  // Back returns to the filtered list when we came from it.
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/frames'));

  const onDelete = () => {
    modal.confirm({
      title: `Delete "${frame.name}"?`,
      content:
        'Hard delete of the frame and every one of its versions — it cannot be undone, and the uploaded bundle files are left behind. If anyone owns this frame the database will refuse — retire it instead.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeFrame(frame.uid).unwrap();
          message.success('Frame deleted');
          navigate('/frames', { replace: true });
        } catch (err) {
          if (err?.status === 409) {
            modal.info({
              title: 'Someone already owns this frame',
              content:
                'It can’t be deleted — that is deliberate, so nobody loses something they paid for. Retire it instead: set it to Inactive and it leaves the store while existing owners keep it.',
              okText: 'Got it',
            });
            return;
          }
          message.error(err?.message || 'Could not delete the frame.');
        }
      },
    });
  };

  if (!isCreate && error?.status === 404) {
    return (
      <Result
        status="404"
        title="Frame not found"
        subTitle="It may have been deleted, or merged into another frame."
        extra={<Button onClick={() => navigate('/frames')}>Back to frames</Button>}
      />
    );
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <Space align="center" size={12}>
          <Button icon={<ArrowLeftOutlined />} onClick={goBack} aria-label="Back" />
          <Title level={4} style={{ margin: 0 }}>
            {isCreate ? 'New frame' : frame?.name || 'Frame'}
          </Title>
          {frame && (
            <Tag color={STATUS_COLORS[frame.status] || 'default'}>{statusLabel(frame.status)}</Tag>
          )}
        </Space>
        {frame && (
          <Space wrap>
            {canUpdate && (
              <Button icon={<MergeCellsOutlined />} onClick={() => setMergeOpen(true)}>
                Merge into another frame…
              </Button>
            )}
            {canDelete && (
              <Button danger icon={<DeleteOutlined />} onClick={onDelete}>
                Delete
              </Button>
            )}
          </Space>
        )}
      </div>

      {isCreate ? (
        <Card title="Details" style={{ maxWidth: 720 }}>
          <FrameDetailsForm
            onCreated={(created) => navigate(`/frames/${created.uid}`, { replace: true })}
          />
        </Card>
      ) : (
        <Spin spinning={isLoading}>
          {frame && (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={14}>
                  <Card title="Details">
                    <FrameDetailsForm frame={frame} disabled={!canUpdate} />
                  </Card>
                </Col>
                <Col xs={24} lg={10}>
                  <PublishCard
                    frame={frame}
                    refreshing={isFetching || versionsFetching}
                    canUpdate={canUpdate}
                  />
                </Col>
              </Row>
              <Card
                title="Versions"
                extra={
                  <Text type="secondary">
                    {(versions || []).length} version{(versions || []).length === 1 ? '' : 's'}
                  </Text>
                }
              >
                <TemplateVersionGrid
                  kind={FRAME_VERSIONS}
                  family={frame}
                  versions={versions}
                  loading={versionsFetching && !versions}
                />
              </Card>
            </Space>
          )}
        </Spin>
      )}

      {frame && (
        <MergeFrameModal
          open={mergeOpen}
          frame={frame}
          onClose={() => setMergeOpen(false)}
          onMerged={(targetUid) => {
            setMergeOpen(false);
            navigate(`/frames/${targetUid}`, { replace: true });
          }}
        />
      )}
    </div>
  );
}

// ---- Details ------------------------------------------------------------------

/**
 * The fields every version shares. `status` is deliberately absent: a frame is
 * created as a draft and only the Publish card moves it, so the gate can't be
 * sidestepped by the ordinary save.
 */
function FrameDetailsForm({ frame, disabled, onCreated }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const isEdit = Boolean(frame);

  const { data: categories } = adminApi.endpoints.frameCategoriesList.useQuery();
  const [createFrame] = adminApi.endpoints.frameCreate.useMutation();
  const [updateFrame] = adminApi.endpoints.frameUpdate.useMutation();

  const premium = isTrue(Form.useWatch('is_premium', form));
  const price = toAmount(Form.useWatch('price', form)) ?? 0;
  const strike = toAmount(Form.useWatch('strike_price', form));

  useEffect(() => {
    if (frame) {
      form.setFieldsValue({
        name: frame.name,
        description: frame.description ?? '',
        category_id: frame.category_id ?? undefined,
        frame_type: frame.frame_type || 'static',
        is_premium: isTrue(frame.is_premium),
        // DECIMAL columns arrive as strings — coerce so InputNumber and every
        // comparison below work on numbers.
        price: toAmount(frame.price) ?? 0,
        strike_price: toAmount(frame.strike_price) ?? undefined,
        display_order: frame.display_order ?? 0,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ frame_type: 'static', is_premium: false, price: 0, display_order: 0 });
    }
  }, [frame, form]);

  // Free means free: the server rejects a free frame with a price on publish, so
  // the field follows the switch instead of waiting to fail.
  const onPremiumChange = (checked) => {
    if (!checked) form.setFieldsValue({ price: 0 });
  };

  const submit = async () => {
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
    };

    setSaving(true);
    try {
      if (isEdit) {
        await updateFrame({ uid: frame.uid, body }).unwrap();
        message.success('Details saved');
      } else {
        const created = await createFrame(body).unwrap();
        message.success('Draft frame created — now add its versions');
        onCreated?.(created);
      }
    } catch (err) {
      setFormError(applyFrameServerError(form, err, FORM_FIELDS));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {formError && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={formError} />}
      <Form form={form} layout="vertical" disabled={disabled}>
        <Form.Item
          name="name"
          label="Name"
          extra="Unique across every frame, whatever its category."
          rules={[{ required: true, whitespace: true, message: 'Name is required' }]}
        >
          <Input placeholder="e.g. Gold Ribbon" />
        </Form.Item>

        <Form.Item name="description" label="Description">
          <Input.TextArea rows={2} placeholder="Optional — a line about the look" />
        </Form.Item>

        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item
              name="category_id"
              label="Category"
              extra="Required to publish — the store is browsed by category chip."
            >
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Uncategorised"
                options={(categories || []).map((c) => ({ label: c.name, value: c.id }))}
              />
            </Form.Item>
          </Col>
          <Col xs={12} sm={6}>
            <Form.Item name="frame_type" label="Type" extra="The store’s two tabs.">
              <Select options={FRAME_TYPE_OPTIONS} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={6}>
            <Form.Item
              name="display_order"
              label="Display order"
              extra="Dragging rows on the list rewrites this."
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Paragraph type="secondary" style={{ marginTop: 0 }}>
          A frame is bought on its own, for its own price — no subscription plan unlocks one.
        </Paragraph>

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
            <InputNumber min={0} precision={2} prefix="₹" style={{ width: 160 }} disabled={!premium} />
          </Form.Item>

          <Form.Item
            name="strike_price"
            label="Strike-through price"
            extra="Display only — the “was” figure. Nothing is charged against it."
          >
            <InputNumber min={0} precision={2} prefix="₹" style={{ width: 160 }} placeholder="—" />
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

        {!isEdit && (
          <Paragraph type="secondary">
            New frames are created as <Text code>draft</Text>. Add a version per language and size
            (each with its ZIP bundle), then publish it.
          </Paragraph>
        )}
        {!disabled && (
          <Button type="primary" loading={saving} onClick={submit}>
            {isEdit ? 'Save details' : 'Create frame'}
          </Button>
        )}
      </Form>
    </>
  );
}

// ---- Publish ------------------------------------------------------------------

/**
 * The frame publish gate. The GET carries the server's own verdict
 * (`is_publishable` + `missing_for_publish[{field,message}]`), so that drives
 * the checklist and the button; the client copy (checkFrameCompleteness) is
 * only a fallback for a response without it. A rejected PATCH's details[]
 * replace both until the frame refetches.
 */
function PublishCard({ frame, refreshing, canUpdate }) {
  const { message } = App.useApp();
  const [updateFrame, { isLoading }] = adminApi.endpoints.frameUpdate.useMutation();
  const [serverErrors, setServerErrors] = useState(null);

  // A fresh frame (after any version change) supersedes the last rejection.
  useEffect(() => setServerErrors(null), [frame]);

  const fromServer = Array.isArray(frame.missing_for_publish);
  const { items } = checkFrameCompleteness(frame);
  const blockers = serverErrors?.length
    ? serverErrors
    : fromServer
      ? frame.missing_for_publish
      : items.filter((i) => !i.ok).map((i) => ({ field: i.field, message: i.hint }));
  const keyOf = (b) => FIELD_TO_KEY[b.field];
  const ready =
    typeof frame.is_publishable === 'boolean' ? frame.is_publishable : blockers.length === 0;
  const status = frame.status || 'draft';
  const extra = blockers.filter((b) => !keyOf(b));

  const setStatus = async (next) => {
    setServerErrors(null);
    try {
      await updateFrame({ uid: frame.uid, body: { status: next } }).unwrap();
      message.success(
        next === 'active' ? 'Published — the frame is live in the store' : `Frame set to ${statusLabel(next)}`,
      );
    } catch (err) {
      const details = Array.isArray(err?.details) ? err.details : [];
      if (details.length) setServerErrors(details);
      else message.error(err?.message || 'Could not change the status.');
    }
  };

  return (
    <Card title="Publish" extra={refreshing ? <Spin size="small" /> : null}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          {items.map((item) => {
            const hits = blockers.filter((b) => keyOf(b) === item.key);
            const ok = hits.length === 0;
            return (
              <div key={item.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                {ok ? (
                  <CheckCircleFilled style={{ color: '#52c41a', marginTop: 4 }} />
                ) : (
                  <CloseCircleFilled style={{ color: '#ff4d4f', marginTop: 4 }} />
                )}
                <div>
                  <Text type={ok ? undefined : 'danger'}>{item.label}</Text>
                  {hits.map((h, i) => (
                    <div key={i}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {h.message}
                      </Text>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {extra.map((b, i) => (
            <div key={`x-${i}`} style={{ display: 'flex', gap: 8 }}>
              <CloseCircleFilled style={{ color: '#ff4d4f', marginTop: 4 }} />
              <Text type="danger">{b.message}</Text>
            </div>
          ))}
        </Space>

        {status === 'active' && !ready && (
          <Alert
            type="warning"
            showIcon
            message="Live, but it wouldn’t pass the publish check today"
            description="It stays live. If it’s unpublished it can’t be republished until the items above are fixed."
          />
        )}

        {canUpdate && (
          <Space wrap>
            <Tooltip title={!ready ? 'Fix the items above first' : undefined}>
              <Button
                type="primary"
                loading={isLoading}
                disabled={status === 'active' || !ready}
                onClick={() => setStatus('active')}
              >
                Publish
              </Button>
            </Tooltip>
            {/* Never gated: a frame that would no longer pass can still be pulled. */}
            <Button
              loading={isLoading}
              disabled={status === 'inactive'}
              onClick={() => setStatus('inactive')}
            >
              Retire (inactive)
            </Button>
            <Button loading={isLoading} disabled={status === 'draft'} onClick={() => setStatus('draft')}>
              Back to draft
            </Button>
          </Space>
        )}
        <Text type="secondary" style={{ fontSize: 12 }}>
          Only published frames appear in the store. Retiring is never a clawback — everyone who
          already added or bought the frame keeps it. If the frame loses its last active English (or
          text-free) version, it goes back to draft on its own.
        </Text>
      </Space>
    </Card>
  );
}
