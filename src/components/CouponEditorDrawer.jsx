import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Checkbox,
  DatePicker,
  Button,
  Space,
  Spin,
  Alert,
  Row,
  Col,
  Tag,
  Divider,
  Typography,
  App,
} from 'antd';
import dayjs from 'dayjs';
import { adminApi } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import {
  DISCOUNT_TYPE_OPTIONS,
  STATUS_OPTIONS,
  AUDIENCE_OPTIONS,
  applicableLabel,
  formatDateTime,
  formatUsage,
} from '../lib/coupons';

const { Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;

// Only letters, numbers, - and _ — no spaces, no %.
const CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

// Server details[].field → the form item it belongs to. valid_from/valid_to are
// both halves of one RangePicker, so they land on the same item.
const FIELD_ALIAS = { valid_from: 'validity', valid_to: 'validity' };

const FORM_FIELDS = new Set([
  'code',
  'title',
  'discount_type',
  'discount_value',
  'target_audience',
  'max_uses',
  'validity',
  'status',
  'plan_ids',
]);

const byNumber = (x, y) => x - y;

/** Order-insensitive comparison, so re-picking the same plans isn't a change. */
function sameIds(a = [], b = []) {
  if (a.length !== b.length) return false;
  const left = [...a].sort(byNumber);
  const right = [...b].sort(byNumber);
  return left.every((v, i) => v === right[i]);
}

/**
 * Create/edit a coupon.
 *
 * Two writes, in order: the coupon fields (POST / PATCH), then — only when the
 * selection actually changed — the plan scoping (PUT …/plans), which is a full
 * replace and owns the derived `applicable_to`. The coupon must exist before it
 * can be scoped, so on create the POST's uid feeds the PUT; if that second call
 * fails the coupon still exists (unscoped) and we say so instead of implying
 * nothing saved.
 */
export default function CouponEditorDrawer({ open, coupon, onClose, onSaved }) {
  const { message } = App.useApp();
  const perms = usePermissions();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const uid = coupon?.uid || null;
  const isEdit = Boolean(uid);
  // The PUT needs coupons.update — an admin who may only create can't scope.
  const canScope = perms.can('coupons', 'update');

  // Baseline for "did the selection change?", so an untouched form doesn't
  // churn applicable_to on every save.
  const initialPlanIds = useRef([]);

  const { data: full, isFetching } = adminApi.endpoints.couponsGet.useQuery(uid, { skip: !uid });
  const { data: scoping, isFetching: scopingFetching } =
    adminApi.endpoints.couponPlans.useQuery(uid, { skip: !uid });
  const plansQuery = adminApi.endpoints.plansList.useQuery();

  const [createCoupon] = adminApi.endpoints.couponCreate.useMutation();
  const [updateCoupon] = adminApi.endpoints.couponUpdate.useMutation();
  const [setCouponPlans] = adminApi.endpoints.couponSetPlans.useMutation();

  const discountType = Form.useWatch('discount_type', form) || 'percentage';
  const unlimited = Form.useWatch('unlimited_uses', form);

  // Already-redeemed uses are the floor for max_uses (the server rejects less).
  const usedCount = Number(full?.used_count ?? coupon?.used_count ?? 0) || 0;

  useEffect(() => {
    if (!open) return;
    if (isEdit && full) {
      form.setFieldsValue({
        code: full.code,
        title: full.title,
        discount_type: full.discount_type || 'percentage',
        discount_value: full.discount_value == null ? undefined : Number(full.discount_value),
        target_audience: full.target_audience || 'all',
        unlimited_uses: full.max_uses == null,
        max_uses: full.max_uses == null ? undefined : Number(full.max_uses),
        validity: [
          full.valid_from ? dayjs(full.valid_from) : null,
          full.valid_to ? dayjs(full.valid_to) : null,
        ],
        status: full.status || 'active',
      });
    } else if (!isEdit) {
      form.resetFields();
      form.setFieldsValue({
        discount_type: 'percentage',
        target_audience: 'all',
        status: 'active',
        unlimited_uses: true,
        plan_ids: [],
      });
      initialPlanIds.current = [];
    }
  }, [open, isEdit, full, form]);

  // Plan scoping arrives from its own endpoint; keep it out of the effect above
  // so a coupon refetch can't wipe a selection the admin is mid-way through.
  useEffect(() => {
    if (!open || !scoping) return;
    const ids = (scoping.plans || []).map((p) => p.id);
    initialPlanIds.current = ids;
    form.setFieldsValue({ plan_ids: ids });
  }, [open, scoping, form]);

  /**
   * Access-pass plans are filtered out: the access-pass purchase endpoint takes
   * no coupon code, so a coupon scoped to one could never be redeemed (and the
   * API 400s on it). Inactive plans stay selectable — an existing coupon may
   * already be scoped to one, and dropping it here would silently wipe that
   * link on the next save.
   */
  const planOptions = useMemo(
    () =>
      (plansQuery.data || [])
        .filter((p) => p.plan_type !== 'access_pass')
        .map((p) => {
          const inactive = p.status === 'inactive';
          return {
            // label stays a plain string so optionFilterProp="label" can search it
            label: inactive ? `${p.name} (inactive)` : p.name,
            value: p.id,
            name: p.name,
            inactive,
          };
        }),
    [plansQuery.data],
  );

  const applicableTo = scoping?.applicable_to || full?.applicable_to;

  /** Map a coupon 400/409 onto the form; anything unmappable becomes a toast. */
  const applyServerErrors = (err) => {
    if (err?.status === 409) {
      form.setFields([
        { name: 'code', errors: [err.message || 'A coupon with this code already exists'] },
      ]);
      return;
    }
    const details = Array.isArray(err?.details) ? err.details : [];
    const byField = new Map();
    const rest = [];
    for (const d of details) {
      const name = FIELD_ALIAS[d.field] || d.field;
      // A PATCH is validated against the merged row, so a field the admin never
      // touched (discount_value after a type switch) can come back here.
      if (name && FORM_FIELDS.has(name)) {
        byField.set(name, [...(byField.get(name) || []), d.message]);
      } else {
        // e.g. used_count leaking into the payload — never a form item.
        rest.push(d.field ? `${d.field}: ${d.message}` : d.message);
      }
    }
    if (byField.size) {
      form.setFields([...byField].map(([name, errors]) => ({ name, errors })));
    }
    if (rest.length) message.error(rest.join('; '));
    else if (!byField.size) message.error(err?.message || 'Failed to save coupon.');
  };

  /** Map a plan-scoping PUT failure. Nothing is written on 400/404/403. */
  const applyScopingErrors = (err) => {
    if (err?.status === 404) {
      // A plan was deleted in another tab. Retrying the same ids can't work —
      // reload the options and let the admin re-pick.
      plansQuery.refetch();
      message.error(
        'Some of the selected plans no longer exist. The plan list has been reloaded — please re-pick.',
      );
      return;
    }
    const details = (Array.isArray(err?.details) ? err.details : []).filter((d) => d.message);
    if (details.length) {
      form.setFields([{ name: 'plan_ids', errors: details.map((d) => d.message) }]);
    } else {
      message.error(err?.message || 'Failed to save plan scoping.');
    }
  };

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const [from, to] = values.validity || [];
    // Read-only fields (uid, used_count, created_at, updated_at) and the derived
    // applicable_to are never part of the payload.
    const body = {
      code: values.code.trim(),
      title: values.title.trim(),
      discount_type: values.discount_type,
      discount_value: Number(values.discount_value),
      target_audience: values.target_audience,
      max_uses: values.unlimited_uses ? null : Number(values.max_uses),
      valid_from: from.toISOString(),
      valid_to: to ? to.toISOString() : null,
      status: values.status,
    };

    const planIds = values.plan_ids || [];
    setSubmitting(true);

    // ---- 1. the coupon itself ------------------------------------------------
    let targetUid = uid;
    try {
      if (isEdit) {
        // Full form, not just the dirty fields: the server validates the merged
        // state, so a partial PATCH would show the admin an inconsistent picture.
        await updateCoupon({ uid, body }).unwrap();
      } else {
        const created = await createCoupon(body).unwrap();
        targetUid = created?.uid;
      }
    } catch (err) {
      applyServerErrors(err);
      setSubmitting(false);
      return; // never fire the scoping PUT after a failed coupon write
    }

    // ---- 2. the plan scoping (only when it changed) --------------------------
    // A new coupon is already all_plans, so an empty selection needs no PUT.
    const changed = isEdit ? !sameIds(planIds, initialPlanIds.current) : planIds.length > 0;
    if (changed && canScope && targetUid) {
      try {
        await setCouponPlans({ uid: targetUid, plan_ids: planIds }).unwrap();
        initialPlanIds.current = planIds;
      } catch (err) {
        applyScopingErrors(err);
        onSaved?.(); // the coupon itself DID save — the list is stale either way
        setSubmitting(false);
        if (isEdit) {
          // PATCH landed, scoping untouched; stay open so the admin can retry.
          message.warning('Coupon saved, but plan scoping failed — the previous scoping is intact.');
        } else {
          message.warning(
            'Coupon created, but plan scoping failed — retry from the edit screen.',
          );
          onClose?.();
        }
        return;
      }
    }

    message.success(isEdit ? 'Coupon saved' : 'Coupon created');
    onSaved?.();
    setSubmitting(false);
    onClose?.();
  };

  return (
    <Drawer
      title={isEdit ? `Edit "${coupon?.code ?? 'coupon'}"` : 'New Coupon'}
      open={open}
      onClose={onClose}
      width={680}
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={submitting} onClick={handleSubmit}>
            {isEdit ? 'Save coupon' : 'Create coupon'}
          </Button>
        </Space>
      }
    >
      <Spin spinning={isEdit && (isFetching || scopingFetching)}>
        <Form form={form} layout="vertical" requiredMark>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="code"
                label="Code"
                rules={[
                  { required: true, message: 'Code is required' },
                  { min: 3, max: 50, message: 'Code must be 3–50 characters' },
                  {
                    pattern: CODE_PATTERN,
                    message: 'Only letters, numbers, - and _ (no spaces or %)',
                  },
                ]}
                extra="Case-insensitively unique. This is what the customer types."
              >
                <Input placeholder="NEWYEAR20" maxLength={50} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="title"
                label="Title"
                rules={[
                  { required: true, message: 'Title is required' },
                  { max: 200, message: 'Title must be at most 200 characters' },
                ]}
                extra="Customer-visible label."
              >
                <Input placeholder="New Year 20% off" maxLength={200} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="discount_type"
                label="Discount type"
                rules={[{ required: true, message: 'Discount type is required' }]}
              >
                <Select
                  options={DISCOUNT_TYPE_OPTIONS}
                  onChange={() => {
                    // A type switch changes what counts as valid, so re-check the
                    // value already in the box (150 fixed → percentage must ERROR,
                    // not silently clamp to 100).
                    if (form.getFieldValue('discount_value') != null) {
                      form.validateFields(['discount_value']).catch(() => {});
                    }
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="discount_value"
                label="Discount value"
                rules={[
                  { required: true, message: 'Discount value is required' },
                  {
                    validator: (_r, v) => {
                      if (v == null || v === '') return Promise.resolve();
                      const n = Number(v);
                      if (!Number.isFinite(n) || n <= 0) {
                        return Promise.reject(new Error('Must be greater than 0'));
                      }
                      // The ≤100 ceiling is percentage-only; a fixed amount is
                      // rupees and may exceed 100.
                      if (discountType === 'percentage' && n > 100) {
                        return Promise.reject(
                          new Error('A percentage discount cannot exceed 100'),
                        );
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                {/* No `max` prop on purpose — it would clamp the value on blur and
                    hide the "150 is not a valid percentage" problem. */}
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  addonAfter={discountType === 'percentage' ? '%' : '₹'}
                  placeholder={discountType === 'percentage' ? '20' : '150'}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="target_audience"
                label="Target audience"
                rules={[{ required: true, message: 'Target audience is required' }]}
              >
                <Select options={AUDIENCE_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="status"
                label="Status"
                rules={[{ required: true, message: 'Status is required' }]}
              >
                <Select options={STATUS_OPTIONS} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="validity"
            label="Valid window"
            rules={[
              {
                validator: (_r, v) => {
                  const [start, end] = v || [];
                  if (!start) return Promise.reject(new Error('A start date is required'));
                  if (end && !end.isAfter(start)) {
                    return Promise.reject(new Error('The end must be after the start'));
                  }
                  return Promise.resolve();
                },
              },
            ]}
            extra="Leave the end empty for a coupon with no end date."
            required
          >
            <RangePicker
              style={{ width: '100%' }}
              showTime
              allowEmpty={[false, true]}
              format="YYYY-MM-DD HH:mm"
            />
          </Form.Item>

          <Form.Item label="Usage limit" style={{ marginBottom: 0 }}>
            <Space align="start" size={16} wrap>
              <Form.Item name="unlimited_uses" valuePropName="checked" noStyle>
                <Checkbox
                  onChange={(e) => {
                    // Unlimited is max_uses: null — clear the number rather than
                    // asking the admin to blank the field.
                    if (e.target.checked) form.setFieldsValue({ max_uses: undefined });
                  }}
                >
                  Unlimited
                </Checkbox>
              </Form.Item>
              <Form.Item
                name="max_uses"
                rules={[
                  {
                    validator: (_r, v) => {
                      if (unlimited) return Promise.resolve();
                      if (v == null || v === '') {
                        return Promise.reject(new Error('Set a limit or tick Unlimited'));
                      }
                      const n = Number(v);
                      if (!Number.isInteger(n) || n < 1) {
                        return Promise.reject(new Error('Must be a whole number of 1 or more'));
                      }
                      if (isEdit && n < usedCount) {
                        return Promise.reject(
                          new Error(`Cannot be below the ${usedCount} uses already redeemed`),
                        );
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
                extra={
                  isEdit && usedCount > 0
                    ? `At least ${usedCount} — this coupon has already been redeemed ${usedCount} time(s).`
                    : 'Total number of times this coupon may be redeemed.'
                }
              >
                <InputNumber
                  style={{ width: 200 }}
                  min={isEdit ? Math.max(1, usedCount) : 1}
                  step={1}
                  precision={0}
                  disabled={unlimited}
                  placeholder="e.g. 100"
                />
              </Form.Item>
            </Space>
          </Form.Item>

          <Divider orientation="left" plain style={{ marginTop: 8 }}>
            Applies to
          </Divider>

          <Form.Item
            name="plan_ids"
            label={
              <Space size={8}>
                <span>Plans</span>
                {isEdit && applicableTo && (
                  <Tag color={applicableTo === 'specific_plans' ? 'blue' : 'default'}>
                    {applicableLabel(applicableTo)}
                  </Tag>
                )}
              </Space>
            }
            extra="Leave empty to apply this coupon to every plan."
          >
            <Select
              mode="multiple"
              allowClear
              placeholder="All plans"
              options={planOptions}
              optionFilterProp="label"
              optionRender={(opt) => (
                <span>
                  {opt.data.name}
                  {opt.data.inactive && <Text type="secondary"> (inactive)</Text>}
                </span>
              )}
              disabled={!canScope}
              maxTagCount="responsive"
              loading={plansQuery.isFetching}
            />
          </Form.Item>

          {!canScope && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="You don't have permission to change plan scoping."
            />
          )}

          <Paragraph type="secondary" style={{ marginBottom: 16 }}>
            Access-pass plans are not listed — the access-pass purchase flow takes no coupon code,
            so a coupon scoped to one could never be redeemed. Selecting plans switches this coupon
            to <Text code>specific_plans</Text>; clearing them switches it back to{' '}
            <Text code>all_plans</Text>.
          </Paragraph>

          {isEdit && (
            <>
              <Divider orientation="left" plain>
                Read-only
              </Divider>
              <Space direction="vertical" size={2}>
                <Text type="secondary">{formatUsage(full || coupon || {})}</Text>
                <Text type="secondary">
                  Created {formatDateTime((full || coupon)?.created_at)} · Updated{' '}
                  {formatDateTime((full || coupon)?.updated_at)}
                </Text>
                <Text type="secondary" copyable={{ text: uid }}>
                  {uid}
                </Text>
              </Space>
            </>
          )}
        </Form>
      </Spin>
    </Drawer>
  );
}
