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
  Row,
  Col,
  Spin,
  Alert,
  Tooltip,
  App,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import {
  adminApi,
  useFeatureTypeMetersQuery,
  usePlanBillingOptionsByPlanQuery,
  usePlanFeaturesByPlanQuery,
  usePlanCreateMutation,
  usePlanUpdateMutation,
  useBillingOptionCreateMutation,
  useBillingOptionUpdateMutation,
  useBillingOptionDeleteMutation,
  usePlanFeatureCreateMutation,
  usePlanFeatureUpdateMutation,
  usePlanFeatureDeleteMutation,
} from '../../features/api/adminApi';
import { usePermissions } from '../../features/auth/usePermissions';
import FeatureValueInput from '../../components/FeatureValueInput';
import FeatureTypeEditorModal from '../../components/FeatureTypeEditorModal';
import {
  RESET_MEANING,
  isUnenforced,
  meterMap,
  meteredFeatureTypes,
  isFreePlan,
  freePlanStatusSentence,
  otherActiveFreePlan,
} from '../../lib/meteredFeatures';

const { Title, Text } = Typography;

const CYCLE_OPTS = [
  { label: 'Monthly', value: 'monthly' },
  { label: 'Annual', value: 'annual' },
];

const FREE_TYPE_LABEL = 'Free tier — users without a subscription';

const isTrue = (v) => v === 1 || v === true;

// ---- mappers: server row <-> form row --------------------------------------

function toBillingForm(r) {
  return {
    id: r.id,
    billing_cycle: r.billing_cycle,
    price: r.price != null ? Number(r.price) : null,
    discounted_price: r.discounted_price != null ? Number(r.discounted_price) : null,
    discount_label: r.discount_label || undefined,
    currency: r.currency || 'INR',
    is_active: r.is_active === 1 || r.is_active === true,
    razorpay_plan_id: r.razorpay_plan_id || undefined,
  };
}

function toBillingPayload(b) {
  const p = {
    billing_cycle: b.billing_cycle,
    price: Number(b.price),
    currency: b.currency || 'INR',
    is_active: b.is_active ? 1 : 0,
  };
  if (b.discounted_price != null && b.discounted_price !== '')
    p.discounted_price = Number(b.discounted_price);
  if (b.discount_label) p.discount_label = b.discount_label;
  if (b.razorpay_plan_id) p.razorpay_plan_id = b.razorpay_plan_id;
  return p;
}

function toFeatureForm(r) {
  return {
    id: r.id,
    feature_type_id: r.feature_type_id,
    value: r.value,
    display_label: r.display_label || undefined,
    display_order: r.display_order ?? 0,
    show_on_card: r.show_on_card === 1 || r.show_on_card === true,
  };
}

function toFeaturePayload(f) {
  const p = {
    feature_type_id: Number(f.feature_type_id),
    value: Number(f.value),
    show_on_card: f.show_on_card ? 1 : 0,
    display_order: f.display_order ?? 0,
  };
  if (f.display_label) p.display_label = f.display_label;
  return p;
}

// ---- one feature row (needs its own hook to watch the selected type) -------

function FeatureRow({
  field,
  remove,
  form,
  featureTypes,
  meters,
  meterByKey,
  usedIds,
  canFeatureCreate,
  onCreateNew,
}) {
  const ftId = Form.useWatch(['features', field.name, 'feature_type_id'], form);
  const ft = (featureTypes || []).find((f) => f.id === ftId);
  const dataType = ft?.data_type || 'integer';
  const meter = ft ? meterByKey.get(ft.key) : undefined;
  const unit = meter?.unit && meter.unit !== 'count' ? meter.unit : undefined;

  // Retired integer features (key not metered) are not offered — only metered
  // integers plus every boolean. A row that already holds one keeps it so it
  // still renders. Unfiltered while /meters is unknown.
  const offerable = (f) => !meters || f.data_type === 'boolean' || meterByKey.has(f.key);
  const options = (featureTypes || [])
    .filter((f) => f.id === ftId || (!usedIds.includes(f.id) && offerable(f)))
    .map((f) => ({ label: f.label, value: f.id }));

  let valueHint = null;
  if (ft && isUnenforced(ft, meters)) {
    valueHint = <Text type="danger">Not enforced — nothing counts this feature</Text>;
  } else if (dataType === 'integer' && RESET_MEANING[ft?.reset_period]) {
    valueHint = <Text type="secondary">{RESET_MEANING[ft.reset_period]}</Text>;
  }

  return (
    <Row gutter={8} align="top" style={{ marginBottom: 8 }}>
      <Col flex="190px">
        <Form.Item
          name={[field.name, 'feature_type_id']}
          rules={[{ required: true, message: 'Pick a feature' }]}
          style={{ marginBottom: 0 }}
        >
          <Select
            placeholder="Feature"
            showSearch
            optionFilterProp="label"
            options={options}
            dropdownRender={(menu) => (
              <>
                {menu}
                {canFeatureCreate && (
                  <>
                    <Divider style={{ margin: '8px 0' }} />
                    <Button
                      type="link"
                      icon={<PlusOutlined />}
                      block
                      onClick={() => onCreateNew(field.name)}
                    >
                      Create new feature type…
                    </Button>
                  </>
                )}
              </>
            )}
          />
        </Form.Item>
      </Col>
      <Col flex="250px">
        <Form.Item
          name={[field.name, 'value']}
          rules={[{ required: true, message: 'Value required' }]}
          extra={valueHint}
          style={{ marginBottom: 0 }}
        >
          <FeatureValueInput dataType={dataType} unit={unit} />
        </Form.Item>
      </Col>
      <Col flex="150px">
        <Form.Item name={[field.name, 'display_label']} style={{ marginBottom: 0 }}>
          <Input placeholder="Label override" />
        </Form.Item>
      </Col>
      <Col flex="80px">
        <Form.Item name={[field.name, 'display_order']} style={{ marginBottom: 0 }}>
          <InputNumber placeholder="Order" style={{ width: '100%' }} />
        </Form.Item>
      </Col>
      <Col flex="90px">
        <Form.Item name={[field.name, 'show_on_card']} valuePropName="checked" style={{ marginBottom: 0 }}>
          <Switch checkedChildren="Card" unCheckedChildren="Hide" />
        </Form.Item>
      </Col>
      <Col>
        <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
      </Col>
    </Row>
  );
}

// ---- main drawer -----------------------------------------------------------

export default function PlanEditorDrawer({ open, plan, onClose, onSaved }) {
  const isEdit = Boolean(plan);
  const { message, notification, modal } = App.useApp();
  const perms = usePermissions();
  const canFeatureCreate = perms.can('features', 'create');
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [ftModal, setFtModal] = useState({ open: false, rowName: null });

  const { data: featureTypes } = adminApi.endpoints.featureTypesList.useQuery();
  const { data: meters } = useFeatureTypeMetersQuery(undefined, { skip: !open });
  const meterByKey = useMemo(() => meterMap(meters), [meters]);
  // Shares PlansPage's cache — used to find another active free plan.
  const { data: allPlans } = adminApi.endpoints.plansList.useQuery(undefined, { skip: !open });
  const { data: billingRows, isFetching: loadingBilling } = usePlanBillingOptionsByPlanQuery(
    plan?.id,
    { skip: !open || !plan?.id },
  );
  const { data: featureRows, isFetching: loadingFeatures } = usePlanFeaturesByPlanQuery(plan?.id, {
    skip: !open || !plan?.id,
  });

  const [createPlan] = usePlanCreateMutation();
  const [updatePlan] = usePlanUpdateMutation();
  const [createBilling] = useBillingOptionCreateMutation();
  const [updateBilling] = useBillingOptionUpdateMutation();
  const [deleteBilling] = useBillingOptionDeleteMutation();
  const [createFeature] = usePlanFeatureCreateMutation();
  const [updateFeature] = usePlanFeatureUpdateMutation();
  const [deleteFeature] = usePlanFeatureDeleteMutation();

  const origBilling = useMemo(() => (isEdit ? billingRows || [] : []), [isEdit, billingRows]);
  const origFeatures = useMemo(() => (isEdit ? featureRows || [] : []), [isEdit, featureRows]);

  // Populate the form on open (and when the per-plan rows arrive in edit mode).
  useEffect(() => {
    if (!open) return;
    if (isEdit) {
      form.setFieldsValue({
        name: plan.name,
        description: plan.description || '',
        plan_type: plan.plan_type || 'subscription',
        status: plan.status || 'active',
        is_popular: plan.is_popular === 1 || plan.is_popular === true,
        display_order: plan.display_order ?? 0,
        trial_days: plan.trial_days ?? null,
        pass_price: plan.pass_price != null ? Number(plan.pass_price) : null,
        pass_days: plan.pass_days ?? null,
        billing: (billingRows || []).map(toBillingForm),
        features: (featureRows || []).map(toFeatureForm),
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        plan_type: 'subscription',
        status: 'active',
        is_popular: false,
        display_order: 0,
        trial_days: null,
        pass_price: null,
        pass_days: null,
        billing: [],
        features: [],
      });
    }
  }, [open, isEdit, plan, billingRows, featureRows, form]);

  const featuresWatch = Form.useWatch('features', form) || [];
  const usedFeatureIds = featuresWatch
    .map((f) => f?.feature_type_id)
    .filter((v) => v !== undefined && v !== null);

  const planType = Form.useWatch('plan_type', form) || 'subscription';
  const status = Form.useWatch('status', form) || 'active';
  const isAccessPass = planType === 'access_pass';
  const isFree = planType === 'free';

  // Only one free plan may be active: offer `free` only when no other one is.
  // A plan that is already free keeps the option (activating it would 409, and
  // that message is shown on save).
  const otherFree = otherActiveFreePlan(allPlans, plan?.uid);
  const freeBlocked = Boolean(otherFree) && !isFreePlan(plan);
  const planTypeOpts = [
    { label: 'Subscription', value: 'subscription' },
    { label: 'Access Pass', value: 'access_pass' },
    {
      value: 'free',
      disabled: freeBlocked,
      label: freeBlocked ? (
        <Tooltip
          title={`"${otherFree.name}" is already the active free plan — only one can be active.`}
        >
          <span>{FREE_TYPE_LABEL}</span>
        </Tooltip>
      ) : (
        FREE_TYPE_LABEL
      ),
    },
  ];

  // Converting a plan to free is refused while it has active billing options.
  const activeBillingCount = origBilling.filter((b) => isTrue(b.is_active)).length;

  // Integer features the plan has no row for → unlimited on them.
  const missingMetered = meteredFeatureTypes(featureTypes, meters).filter(
    (f) => !usedFeatureIds.includes(f.id),
  );

  const buildPlanBody = (v) => {
    const type = v.plan_type || 'subscription';
    const isPass = type === 'access_pass';
    const numOrNull = (x) => (x != null && x !== '' ? Number(x) : null);
    const body = {
      name: v.name,
      description: v.description || undefined,
      plan_type: type,
      status: v.status || 'active',
      is_popular: v.is_popular ? 1 : 0,
      display_order: v.display_order ?? 0,
    };
    // The free plan takes no trial/pass fields — the API 400s on any, so none
    // are sent.
    if (type === 'free') return body;
    // Only the fields relevant to the chosen plan_type are sent; the others
    // are nulled so stale values from a type switch never reach the server.
    body.trial_days = isPass ? null : numOrNull(v.trial_days);
    body.pass_price = isPass ? numOrNull(v.pass_price) : null;
    body.pass_days = isPass ? numOrNull(v.pass_days) : null;
    return body;
  };

  /**
   * Activating / deactivating the free plan (including converting an active
   * one away from free) switches limits on or off for every user without a
   * subscription, so it is confirmed first. Resolves false on cancel.
   */
  const confirmEnforcementChange = (v) => {
    const wasEnforced = isEdit && isFreePlan(plan) && plan.status === 'active';
    const willEnforce = v.plan_type === 'free' && v.status === 'active';
    if (wasEnforced === willEnforce) return Promise.resolve(true);
    return new Promise((resolve) => {
      modal.confirm({
        title: willEnforce ? 'Turn on free-tier limits?' : 'Turn off free-tier limits?',
        content: freePlanStatusSentence(willEnforce ? 'active' : 'inactive'),
        okText: willEnforce ? 'Activate' : 'Deactivate',
        okButtonProps: { danger: !willEnforce },
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  };

  const reportFailures = (failures, successMsg) => {
    if (failures.length) {
      notification.warning({
        message: 'Saved with some errors',
        description: (
          <div>
            <div>These rows were not saved. Re-open the plan to fix them:</div>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {failures.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        ),
        duration: 0,
      });
    } else {
      message.success(successMsg);
    }
  };

  const saveCreate = async (v) => {
    let created;
    try {
      created = await createPlan(buildPlanBody(v)).unwrap();
    } catch (e) {
      message.error(e?.message || 'Could not create the plan.');
      return; // step 1 failed → nothing created, stay on the form
    }
    const planId = created.id;
    const failures = [];

    // The free plan never has billing options (the API 400s on them).
    for (const b of v.plan_type === 'free' ? [] : v.billing || []) {
      try {
        await createBilling({ plan_id: planId, ...toBillingPayload(b) }).unwrap();
      } catch (e) {
        failures.push(`Billing (${b.billing_cycle || '?'}): ${e?.message || 'failed'}`);
      }
    }
    for (const f of v.features || []) {
      if (f.feature_type_id == null) continue;
      try {
        await createFeature({ plan_id: planId, ...toFeaturePayload(f) }).unwrap();
      } catch (e) {
        failures.push(`Feature: ${e?.message || 'failed'}`);
      }
    }

    reportFailures(failures, 'Plan created');
    onSaved?.();
    onClose?.();
  };

  const saveEdit = async (v) => {
    const failures = [];

    const typeChanged = (v.plan_type || 'subscription') !== (plan.plan_type || 'subscription');
    try {
      await updatePlan({ id: plan.uid, body: buildPlanBody(v) }).unwrap();
    } catch (e) {
      // A refused type change (e.g. to free while billing options are active —
      // "deactivate them first") would leave the rows below written against
      // the wrong type, so stop and keep the drawer open.
      if (typeChanged) {
        message.error(e?.message || 'Could not change the plan type.');
        return;
      }
      failures.push(`Plan details: ${e?.message || 'failed'}`);
    }

    // Billing diff — skipped for the free plan, whose billing section is
    // hidden: nothing there is offered, so nothing is created or removed.
    const isFreeSave = v.plan_type === 'free';
    const formBilling = isFreeSave ? [] : v.billing || [];
    const keepBilling = new Set(formBilling.filter((b) => b.id).map((b) => b.id));
    for (const o of isFreeSave ? [] : origBilling) {
      if (!keepBilling.has(o.id)) {
        try {
          await deleteBilling(o.id).unwrap();
        } catch (e) {
          failures.push(
            `Remove billing: ${e?.status === 409 ? 'in use by a subscription' : e?.message || 'failed'}`,
          );
        }
      }
    }
    for (const b of formBilling) {
      try {
        if (b.id) await updateBilling({ id: b.id, body: toBillingPayload(b) }).unwrap();
        else await createBilling({ plan_id: plan.id, ...toBillingPayload(b) }).unwrap();
      } catch (e) {
        failures.push(`Billing (${b.billing_cycle || '?'}): ${e?.message || 'failed'}`);
      }
    }

    // Feature diff
    const formFeatures = v.features || [];
    const keepFeatures = new Set(formFeatures.filter((f) => f.id).map((f) => f.id));
    for (const o of origFeatures) {
      if (!keepFeatures.has(o.id)) {
        try {
          await deleteFeature(o.id).unwrap();
        } catch (e) {
          failures.push(`Remove feature: ${e?.message || 'failed'}`);
        }
      }
    }
    for (const f of formFeatures) {
      if (f.feature_type_id == null) continue;
      try {
        if (f.id) await updateFeature({ id: f.id, body: toFeaturePayload(f) }).unwrap();
        else await createFeature({ plan_id: plan.id, ...toFeaturePayload(f) }).unwrap();
      } catch (e) {
        failures.push(`Feature: ${e?.message || 'failed'}`);
      }
    }

    reportFailures(failures, 'Plan updated');
    onSaved?.();
    onClose?.();
  };

  const handleSave = async () => {
    let v;
    try {
      v = await form.validateFields();
    } catch {
      return;
    }
    if (!(await confirmEnforcementChange(v))) return;
    setSaving(true);
    try {
      if (isEdit) await saveEdit(v);
      else await saveCreate(v);
    } finally {
      setSaving(false);
    }
  };

  const handleFtSaved = (created) => {
    if (ftModal.rowName != null && created?.id != null) {
      form.setFieldValue(['features', ftModal.rowName, 'feature_type_id'], created.id);
    }
    setFtModal({ open: false, rowName: null });
  };

  const loading = isEdit && (loadingBilling || loadingFeatures);

  return (
    <Drawer
      title={isEdit ? `Edit Plan — ${plan.name}` : 'New Plan'}
      open={open}
      onClose={onClose}
      width={920}
      destroyOnClose
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="primary" loading={saving} onClick={handleSave}>
              Save plan
            </Button>
          </Space>
        </div>
      }
    >
      <Spin spinning={loading}>
        <Form form={form} layout="vertical">
          {/* 1. Plan details */}
          <Divider orientation="left" style={{ marginTop: 0 }}>
            <Title level={5} style={{ margin: 0 }}>
              Plan details
            </Title>
          </Divider>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="name"
                label="Name"
                rules={[{ required: true, message: 'Name is required' }]}
              >
                <Input placeholder="e.g. Pro" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="status"
                label="Status"
                extra={
                  isFree ? (
                    <Text type={status === 'active' ? 'warning' : 'secondary'}>
                      {freePlanStatusSentence(status)}
                    </Text>
                  ) : undefined
                }
              >
                <Select
                  options={[
                    { label: 'Active', value: 'active' },
                    { label: 'Inactive', value: 'inactive' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="plan_type" label="Plan type">
                <Select
                  options={planTypeOpts}
                  popupMatchSelectWidth={false}
                  onChange={(val) =>
                    // Clear the fields that don't apply to the new type so stale
                    // values aren't submitted.
                    val === 'free'
                      ? form.setFieldsValue({ trial_days: null, pass_price: null, pass_days: null })
                      : val === 'access_pass'
                        ? form.setFieldsValue({ trial_days: null })
                        : form.setFieldsValue({ pass_price: null, pass_days: null })
                  }
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="is_popular" label="Popular" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="display_order" label="Display order">
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          {/* Type-specific pricing fields. The free plan sells nothing: no
              trial, no pass, no billing options. */}
          {isFree ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="Free tier — the limits a user without a subscription is held to."
              description={
                <>
                  Nothing is sold on it and it never appears on the pricing grid. Only one free
                  plan can be active.
                  {isEdit && !isFreePlan(plan) && activeBillingCount > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <Text type="danger">
                        This plan still has {activeBillingCount} active billing option
                        {activeBillingCount === 1 ? '' : 's'}, so it can&apos;t become the free
                        plan — deactivate them first (switch the type back, turn them off, save),
                        then convert it.
                      </Text>
                    </div>
                  )}
                </>
              }
            />
          ) : isAccessPass ? (
            <Row gutter={16}>
              <Col xs={12} md={8}>
                <Form.Item
                  name="pass_price"
                  label="Pass price"
                  rules={[
                    { type: 'number', min: 0, message: 'Must be 0 or more' },
                    { required: true, message: 'Pass price is required' },
                  ]}
                  tooltip="One-time fee the user pays for this access pass."
                >
                  <InputNumber
                    min={0}
                    precision={2}
                    prefix="₹"
                    placeholder="0.00"
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
              <Col xs={12} md={8}>
                <Form.Item
                  name="pass_days"
                  label="Pass duration"
                  rules={[
                    { type: 'integer', min: 1, message: 'Must be at least 1 day' },
                    { required: true, message: 'Pass duration is required' },
                  ]}
                  tooltip="How many days the pass grants access before it expires."
                >
                  <InputNumber min={1} addonAfter="days" placeholder="30" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          ) : (
            <Row gutter={16}>
              <Col xs={24} md={8}>
                <Form.Item
                  name="trial_days"
                  label="Free trial"
                  rules={[{ type: 'integer', min: 0, message: 'Must be 0 or more' }]}
                  tooltip="Free days before the subscription auto-charges. 0 or empty = no trial. Requires a Razorpay plan mapping on the billing option to take payment."
                >
                  <InputNumber min={0} addonAfter="days" placeholder="0" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          )}

          {/* 2. Billing options — hidden (but kept mounted) for the free plan. */}
          <Divider orientation="left" style={{ display: isFree ? 'none' : undefined }}>
            <Title level={5} style={{ margin: 0 }}>
              Billing options
            </Title>
          </Divider>
          {isAccessPass && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="Access-pass plans don't use recurring billing options."
              description="Pricing is set by the pass price above. Any existing billing options are kept but not editable here."
            />
          )}
          <div style={{ display: isAccessPass || isFree ? 'none' : 'block' }}>
          <Form.List name="billing">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Row key={field.key} gutter={8} style={{ marginBottom: 8 }}>
                    <Col flex="120px">
                      <Form.Item
                        name={[field.name, 'billing_cycle']}
                        rules={[{ required: true, message: 'Cycle?' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Select placeholder="Cycle" options={CYCLE_OPTS} />
                      </Form.Item>
                    </Col>
                    <Col flex="110px">
                      <Form.Item
                        name={[field.name, 'price']}
                        rules={[{ required: true, message: 'Price?' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber min={0} placeholder="Price" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col flex="120px">
                      <Form.Item name={[field.name, 'discounted_price']} style={{ marginBottom: 0 }}>
                        <InputNumber min={0} placeholder="Disc. price" style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col flex="130px">
                      <Form.Item name={[field.name, 'discount_label']} style={{ marginBottom: 0 }}>
                        <Input placeholder="Disc. label" />
                      </Form.Item>
                    </Col>
                    <Col flex="80px">
                      <Form.Item name={[field.name, 'currency']} style={{ marginBottom: 0 }}>
                        <Input placeholder="INR" />
                      </Form.Item>
                    </Col>
                    <Col flex="90px">
                      <Form.Item
                        name={[field.name, 'is_active']}
                        valuePropName="checked"
                        style={{ marginBottom: 0 }}
                      >
                        <Switch checkedChildren="Active" unCheckedChildren="Off" />
                      </Form.Item>
                    </Col>
                    <Col flex="auto">
                      <Form.Item name={[field.name, 'razorpay_plan_id']} style={{ marginBottom: 0 }}>
                        <Input placeholder="razorpay_plan_id (advanced)" />
                      </Form.Item>
                    </Col>
                    <Col>
                      <Button
                        danger
                        type="text"
                        icon={<DeleteOutlined />}
                        onClick={() => remove(field.name)}
                      />
                    </Col>
                  </Row>
                ))}
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  block
                  onClick={() => add({ billing_cycle: 'monthly', currency: 'INR', is_active: true })}
                >
                  Add billing option
                </Button>
              </>
            )}
          </Form.List>
          </div>

          {/* 3. Features */}
          <Divider orientation="left" style={{ marginTop: 24 }}>
            <Title level={5} style={{ margin: 0 }}>
              Features
            </Title>
          </Divider>
          <Form.List name="features">
            {(fields, { add, remove }) => (
              <>
                {/* A plan with no row for a metered feature is UNLIMITED on it. */}
                {!loading && missingMetered.length > 0 && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="These limits are not set, so this plan is unlimited on them"
                    description={
                      <div>
                        {missingMetered.map((f) => (
                          <div
                            key={f.id}
                            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                          >
                            <span>
                              <Text strong>{f.label}</Text>: not set (unlimited)
                            </span>
                            <Button
                              size="small"
                              type="link"
                              icon={<PlusOutlined />}
                              onClick={() =>
                                add({
                                  feature_type_id: f.id,
                                  value: 0,
                                  show_on_card: true,
                                  display_order: 0,
                                })
                              }
                            >
                              Add
                            </Button>
                          </div>
                        ))}
                      </div>
                    }
                  />
                )}
                {fields.map((field) => (
                  <FeatureRow
                    key={field.key}
                    field={field}
                    remove={remove}
                    form={form}
                    featureTypes={featureTypes}
                    meters={meters}
                    meterByKey={meterByKey}
                    usedIds={usedFeatureIds}
                    canFeatureCreate={canFeatureCreate}
                    onCreateNew={(rowName) => setFtModal({ open: true, rowName })}
                  />
                ))}
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  block
                  onClick={() => add({ value: 0, show_on_card: true, display_order: 0 })}
                >
                  Add feature
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Spin>

      <FeatureTypeEditorModal
        open={ftModal.open}
        onClose={() => setFtModal({ open: false, rowName: null })}
        onSaved={handleFtSaved}
      />
    </Drawer>
  );
}
