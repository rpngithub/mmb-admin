import { useEffect, useMemo, useState } from 'react';
import {
  Drawer,
  Steps,
  Form,
  Input,
  InputNumber,
  Select,
  DatePicker,
  Switch,
  Button,
  Space,
  Spin,
  Alert,
  Tag,
  Divider,
  Descriptions,
  Statistic,
  Table,
  Typography,
  App,
} from 'antd';
import { EyeOutlined, SendOutlined, ScheduleOutlined, CopyOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  adminApi,
  useNotificationCampaignCreateMutation,
  useNotificationCampaignUpdateMutation,
  useNotificationCampaignPreviewMutation,
  useNotificationCampaignScheduleMutation,
  useNotificationCampaignSendNowMutation,
  useNotificationTemplatesListQuery,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import ImageUploadField from './ImageUploadField';
import {
  ACCOUNT_TYPE_OPTIONS,
  AUDIENCE_LIMITS,
  AUDIENCE_PRESETS,
  BYPASS_FATIGUE_EXPLAINER,
  BYPASS_FATIGUE_SCOPE,
  CAMPAIGN_COPY_LITERAL_NOTE,
  CAMPAIGN_STATUS_COLORS,
  CTA_ACTION_OPTIONS,
  ONBOARDING_OPTIONS,
  PLAN_OPTIONS,
  SEND_NOW_PACING_NOTE,
  applyNotificationServerError,
  campaignStatusLabel,
  ctaActionLabel,
  diffBody,
  errorText,
  extractPlaceholders,
  isCampaignEditable,
  isKnownCtaAction,
  isTrue,
  jsonToText,
  matchPreset,
  nullableText,
  textToJson,
  validateAudience,
} from '../lib/notifications';

const { Text, Paragraph } = Typography;

const FORM_FIELDS = [
  'name',
  'template_id',
  'category_id',
  'title',
  'body',
  'cta_label',
  'cta_action',
  'cta_params',
  'image_s3_key',
  'audience',
  'scheduled_at',
  'bypass_fatigue',
];

const DATE_FMT = 'YYYY-MM-DD';

function formValuesFrom(full) {
  const action = full?.cta_action ?? '';
  return {
    name: full?.name ?? '',
    template_id: full?.template_id ?? undefined,
    category_id: full?.category_id ?? undefined,
    title: full?.title ?? '',
    body: full?.body ?? '',
    cta_label: full?.cta_label ?? '',
    cta_action: isKnownCtaAction(action) ? action : undefined,
    cta_action_custom: action && !isKnownCtaAction(action) ? action : '',
    cta_params: jsonToText(full?.cta_params),
    image_s3_key: full?.image_s3_key ?? undefined,
    audience: full?.audience && typeof full.audience === 'object' ? { ...full.audience } : {},
    bypass_fatigue: isTrue(full?.bypass_fatigue),
  };
}

function bodyFrom(values) {
  let cta_params = null;
  try {
    cta_params = textToJson(values.cta_params);
  } catch (e) {
    const err = new Error(e.message || 'Invalid JSON.');
    err.field = 'cta_params';
    throw err;
  }
  return {
    name: (values.name || '').trim(),
    template_id: values.template_id ?? null,
    category_id: values.category_id ?? null,
    title: nullableText(values.title),
    body: nullableText(values.body),
    cta_label: nullableText(values.cta_label),
    cta_action: nullableText(values.cta_action || values.cta_action_custom),
    cta_params,
    image_s3_key: values.image_s3_key || null,
    audience: values.audience && typeof values.audience === 'object' ? values.audience : {},
    bypass_fatigue: values.bypass_fatigue ? 1 : 0,
  };
}

/** A fingerprint of what would be sent, so an edit invalidates a preview. */
const fingerprint = (values) => {
  try {
    return JSON.stringify(bodyFrom(values));
  } catch {
    return 'invalid';
  }
};

/**
 * The campaign wizard: Write it → Choose who → Check and send.
 *
 * A flat form with a blank filter builder was what made this section confusing,
 * so the three jobs are three steps and the audience step leads with presets.
 *
 * Three rules shape the whole component:
 *  1. `status` is not writable. It moves only through schedule / send-now /
 *     cancel, and a campaign past draft/scheduled cannot be PATCHed at all (403)
 *     — so it goes read-only and offers "Duplicate into a new draft".
 *  2. Campaign text is identical for everyone who receives it, so it CANNOT
 *     contain {{placeholders}}. Blocked here, not left to the 400.
 *  3. A preview is REQUIRED before Send or Schedule, and any later edit
 *     invalidates it.
 */
export default function NotificationCampaignEditorDrawer({ open, uid, onClose, onSaved }) {
  const [workingUid, setWorkingUid] = useState(uid || null);
  const [step, setStep] = useState(0);
  const [seed, setSeed] = useState(null);

  useEffect(() => {
    if (open) {
      setWorkingUid(uid || null);
      setStep(0);
      setSeed(null);
    }
  }, [open, uid]);

  return (
    <Drawer
      title={workingUid ? 'Campaign' : 'New campaign'}
      open={open}
      onClose={onClose}
      width={880}
      destroyOnClose
    >
      <CampaignWizard
        uid={workingUid}
        seed={seed}
        step={step}
        onStep={setStep}
        onCreated={(newUid) => {
          setWorkingUid(newUid);
          setSeed(null);
          setStep(1);
          onSaved?.();
        }}
        onDuplicate={(values) => {
          // The copy and audience carry across; the counters, schedule and
          // status are not the new draft's to inherit.
          setSeed({ ...values, name: values.name ? `${values.name} (copy)` : '' });
          setWorkingUid(null);
          setStep(0);
        }}
        onSaved={onSaved}
        onClose={onClose}
      />
    </Drawer>
  );
}

function CampaignWizard({ uid, seed, step, onStep, onCreated, onDuplicate, onSaved, onClose }) {
  const { message, modal } = App.useApp();
  const perms = usePermissions();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [preview, setPreview] = useState(null);
  // The content the preview ran against. Any later edit invalidates it.
  const [previewOf, setPreviewOf] = useState(null);

  const isEdit = Boolean(uid);
  const canCreate = perms.can('notification_campaigns', 'create');
  const canUpdate = perms.can('notification_campaigns', 'update');

  const { data: full, isFetching } = adminApi.endpoints.notificationCampaignGet.useQuery(uid, {
    skip: !uid,
  });
  const { data: templates } = useNotificationTemplatesListQuery();
  const { data: categories } = adminApi.endpoints.notificationCategoriesList.useQuery();

  const [createCampaign] = useNotificationCampaignCreateMutation();
  const [updateCampaign] = useNotificationCampaignUpdateMutation();
  const [runPreview, { isLoading: previewing }] = useNotificationCampaignPreviewMutation();
  const [schedule] = useNotificationCampaignScheduleMutation();
  const [sendNow] = useNotificationCampaignSendNowMutation();

  const editable = isEdit ? isCampaignEditable(full) && canUpdate : canCreate;
  const readOnly = isEdit && !isCampaignEditable(full);

  const values = Form.useWatch([], form);
  const title = Form.useWatch('title', form);
  const body = Form.useWatch('body', form);
  const ctaLabel = Form.useWatch('cta_label', form);
  const audience = Form.useWatch('audience', form);
  const bypass = Form.useWatch('bypass_fatigue', form);

  const placeholders = useMemo(
    () => extractPlaceholders(title, body, ctaLabel),
    [title, body, ctaLabel],
  );
  const audienceErrors = useMemo(() => validateAudience(audience || {}), [audience]);

  const currentPrint = values ? fingerprint(values) : null;
  const previewStale = Boolean(preview) && previewOf !== null && previewOf !== currentPrint;
  const previewValid = Boolean(preview) && !previewStale;

  useEffect(() => {
    if (isEdit) {
      if (full) form.setFieldsValue(formValuesFrom(full));
    } else {
      form.setFieldsValue(seed || formValuesFrom(null));
    }
    setPreview(null);
    setPreviewOf(null);
    setFormError(null);
  }, [isEdit, full, seed, form]);

  const templateOptions = useMemo(
    () =>
      (Array.isArray(templates) ? templates : []).map((t) => ({
        value: t.id,
        label: t.title ? `${t.title} (${t.code})` : t.code,
      })),
    [templates],
  );

  const categoryOptions = useMemo(
    () => (categories || []).map((c) => ({ value: c.id, label: c.name })),
    [categories],
  );

  const save = async () => {
    let vals;
    try {
      vals = await form.validateFields();
    } catch {
      return null;
    }
    if (placeholders.length) {
      setFormError(
        `Campaign text cannot contain ${placeholders
          .map((p) => `{{${p}}}`)
          .join(', ')}. ${CAMPAIGN_COPY_LITERAL_NOTE}`,
      );
      onStep(0);
      return null;
    }
    if (audienceErrors.length) {
      setFormError(audienceErrors.join(' '));
      onStep(1);
      return null;
    }
    setFormError(null);

    let next;
    try {
      next = bodyFrom(vals);
    } catch (err) {
      form.setFields([{ name: err.field, errors: [err.message] }]);
      return null;
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        const patch = diffBody(next, bodyFrom(formValuesFrom(full)));
        if (Object.keys(patch).length === 0) return uid;
        await updateCampaign({ uid, body: patch }).unwrap();
        message.success('Campaign saved');
        onSaved?.();
        return uid;
      }
      const created = await createCampaign(next).unwrap();
      message.success('Draft created');
      onCreated?.(created?.uid);
      return created?.uid || null;
    } catch (err) {
      setFormError(applyNotificationServerError(form, err, FORM_FIELDS));
      return null;
    } finally {
      setSubmitting(false);
    }
  };

  const doPreview = async (targetUid = uid) => {
    if (!targetUid) return;
    try {
      const result = await runPreview(targetUid).unwrap();
      setPreview(result);
      setPreviewOf(currentPrint);
      onStep(2);
    } catch (err) {
      message.error(errorText(err, 'Could not build the preview.'));
    }
  };

  const confirmBypass = (checked) => {
    if (!checked) {
      form.setFieldsValue({ bypass_fatigue: false });
      return;
    }
    modal.confirm({
      title: 'Ignore the per-user notification limits?',
      width: 560,
      content: (
        <Space direction="vertical" size={8}>
          <Text>{BYPASS_FATIGUE_EXPLAINER}</Text>
          <Text type="secondary">{BYPASS_FATIGUE_SCOPE}</Text>
        </Space>
      ),
      okText: 'Yes, bypass the limits',
      okButtonProps: { danger: true },
      onOk: () => form.setFieldsValue({ bypass_fatigue: true }),
      onCancel: () => form.setFieldsValue({ bypass_fatigue: false }),
    });
  };

  const doSendNow = () => {
    modal.confirm({
      title: `Send to ${(preview?.audience_count ?? 0).toLocaleString('en-IN')} people now?`,
      width: 580,
      content: (
        <Space direction="vertical" size={8}>
          <Text>{SEND_NOW_PACING_NOTE}</Text>
          {preview?.note && <Text type="secondary">{preview.note}</Text>}
          {isTrue(bypass) && (
            <Text type="danger">
              The per-user limits are bypassed for this campaign. {BYPASS_FATIGUE_SCOPE}
            </Text>
          )}
        </Space>
      ),
      okText: 'Send now',
      onOk: async () => {
        try {
          await sendNow(uid).unwrap();
          message.success('Queued — the counts on the list climb as it goes out.');
          onSaved?.();
          onClose?.();
        } catch (err) {
          message.error(errorText(err, 'Could not start the send.'));
        }
      },
    });
  };

  const doSchedule = async (when) => {
    if (!when || !dayjs(when).isValid()) {
      message.error('Pick a date and time.');
      return;
    }
    if (!dayjs(when).isAfter(dayjs())) {
      message.error('The scheduled time has to be in the future.');
      return;
    }
    try {
      await schedule({ uid, scheduled_at: dayjs(when).toISOString() }).unwrap();
      message.success(`Scheduled for ${dayjs(when).format('YYYY-MM-DD HH:mm')}`);
      onSaved?.();
      onClose?.();
    } catch (err) {
      message.error(errorText(err, 'Could not schedule the campaign.'));
    }
  };

  // ---- Step 1: write it -----------------------------------------------------
  const writeStep = (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={CAMPAIGN_COPY_LITERAL_NOTE}
        description="Either write the whole thing here, or start from a notification and override the fields you want to change."
      />

      {placeholders.length > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Remove ${placeholders.map((p) => `{{${p}}}`).join(', ')}.`}
          description="A campaign with a placeholder in it is rejected — it would go out to everyone with the braces still showing."
        />
      )}

      <Form.Item
        name="name"
        label="Campaign name"
        extra="Internal label — users never see this."
        rules={[{ required: true, message: 'Give the campaign a name' }]}
      >
        <Input placeholder="e.g. Diwali 2026 offer" />
      </Form.Item>

      <Form.Item
        name="template_id"
        label="Start from a notification"
        extra="Optional. Inherits its copy; anything you fill in below overrides it."
      >
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Write it from scratch"
          options={templateOptions}
        />
      </Form.Item>

      <Form.Item name="title" label="Title">
        <Input placeholder="The headline everyone sees" />
      </Form.Item>

      <Form.Item name="body" label="Message">
        <Input.TextArea rows={4} placeholder="The same text for every recipient." />
      </Form.Item>

      <Space size="large" align="start" wrap>
        <Form.Item name="cta_label" label="Button label" style={{ minWidth: 240 }}>
          <Input placeholder="e.g. See the offer" />
        </Form.Item>
        <Form.Item name="cta_action" label="Button opens" style={{ minWidth: 260 }}>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Pick a screen"
            options={CTA_ACTION_OPTIONS}
            style={{ width: 260 }}
          />
        </Form.Item>
      </Space>

      <Space size="large" align="start" wrap>
        <Form.Item name="category_id" label="Category" style={{ minWidth: 240 }}>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Optional"
            options={categoryOptions}
            style={{ width: 240 }}
          />
        </Form.Item>
        <Form.Item name="image_s3_key" label="Image">
          <ImageUploadField slot="notification_image" disabled={!editable} />
        </Form.Item>
      </Space>

      <Form.Item
        name="cta_action_custom"
        label="Custom route key"
        extra="Only for a screen the dropdown above has no entry for."
      >
        <Input placeholder="e.g. offers.detail" style={{ maxWidth: 320 }} />
      </Form.Item>

      <Form.Item name="cta_params" label="Button parameters" extra="Optional JSON object.">
        <Input.TextArea rows={2} placeholder='{ "tab": "offers" }' />
      </Form.Item>

      <Divider orientation="left" plain>
        Limits
      </Divider>

      <Form.Item
        name="bypass_fatigue"
        label="Ignore the per-user notification limits"
        valuePropName="checked"
        extra={BYPASS_FATIGUE_SCOPE}
      >
        <Switch onChange={confirmBypass} />
      </Form.Item>

      {isTrue(bypass) && (
        <Alert type="warning" showIcon message={BYPASS_FATIGUE_EXPLAINER} />
      )}
    </>
  );

  // ---- Step 2: choose who ---------------------------------------------------
  const audienceStep = (
    <>
      {audienceErrors.length > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={audienceErrors.join(' ')}
        />
      )}
      <Form.Item name="audience" noStyle>
        <AudienceStep disabled={!editable} />
      </Form.Item>
    </>
  );

  // ---- Step 3: check and send ----------------------------------------------
  const sendStep = (
    <CheckAndSend
      uid={uid}
      preview={preview}
      stale={previewStale}
      previewing={previewing}
      onPreview={() => doPreview()}
      onSendNow={doSendNow}
      onSchedule={doSchedule}
      canSend={previewValid && canUpdate && isCampaignEditable(full)}
      campaign={full}
      bypass={isTrue(bypass)}
    />
  );

  const steps = [
    { title: 'Write it' },
    { title: 'Choose who' },
    { title: 'Check and send', disabled: !isEdit },
  ];

  return (
    <Spin spinning={isEdit && isFetching}>
      {isEdit && full && (
        <Descriptions size="small" column={4} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="Status">
            <Tag color={CAMPAIGN_STATUS_COLORS[full.status] || 'default'}>
              {campaignStatusLabel(full.status)}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Audience">
            {full.audience_count != null ? full.audience_count.toLocaleString('en-IN') : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Sent">
            {full.sent_count != null ? full.sent_count.toLocaleString('en-IN') : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Scheduled">
            {full.scheduled_at && dayjs(full.scheduled_at).isValid()
              ? dayjs(full.scheduled_at).format('YYYY-MM-DD HH:mm')
              : '—'}
          </Descriptions.Item>
        </Descriptions>
      )}

      {readOnly && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`This campaign is ${campaignStatusLabel(full?.status).toLowerCase()} and can no longer be edited.`}
          description="Once a campaign leaves draft or scheduled the server refuses any change — the copy and audience are part of what was sent."
          action={
            canCreate ? (
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={() => onDuplicate?.(formValuesFrom(full))}
              >
                Duplicate into a new draft
              </Button>
            ) : null
          }
        />
      )}

      <Steps
        current={step}
        items={steps}
        onChange={(next) => {
          if (next === 2 && !isEdit) return;
          onStep(next);
        }}
        style={{ marginBottom: 24 }}
      />

      {formError && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={formError} />}

      <Form form={form} layout="vertical" disabled={!editable}>
        <div style={{ display: step === 0 ? 'block' : 'none' }}>{writeStep}</div>
        <div style={{ display: step === 1 ? 'block' : 'none' }}>{audienceStep}</div>
      </Form>
      {step === 2 && sendStep}

      <Divider />

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button onClick={onClose}>Close</Button>
        <Space>
          {step > 0 && <Button onClick={() => onStep(step - 1)}>Back</Button>}
          {step === 0 && (
            <Button type="primary" loading={submitting} onClick={() => onStep(1)}>
              Next: choose who
            </Button>
          )}
          {step === 1 && editable && (
            <Button
              type="primary"
              loading={submitting || previewing}
              onClick={async () => {
                const savedUid = await save();
                if (savedUid) doPreview(savedUid);
              }}
            >
              Next: check and send
            </Button>
          )}
          {step === 1 && !editable && isEdit && (
            <Button type="primary" onClick={() => onStep(2)}>
              Next: check and send
            </Button>
          )}
          {editable && (
            <Button loading={submitting} onClick={save}>
              Save draft
            </Button>
          )}
        </Space>
      </div>
    </Spin>
  );
}

// ---- Step 3 -----------------------------------------------------------------

/**
 * The preview is required, not optional: Send and Schedule stay disabled until
 * it has run, and any edit afterwards invalidates it.
 *
 * `note` is rendered VERBATIM. Without that sentence the first thing that
 * happens in production is someone seeing "sent 8,412 of 10,000" and filing it
 * as a bug — it is the consent and fatigue rules working as designed.
 */
function CheckAndSend({
  uid,
  preview,
  stale,
  previewing,
  onPreview,
  onSendNow,
  onSchedule,
  canSend,
  campaign,
  bypass,
}) {
  const [when, setWhen] = useState(null);

  if (!uid) {
    return <Paragraph type="secondary">Save the draft first.</Paragraph>;
  }

  if (!preview) {
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type="warning"
          showIcon
          message="Run a preview before sending."
          description="It re-runs the audience query and shows how many people match, a sample of who they are, and the notification exactly as it will arrive. Send and Schedule stay disabled until it has."
        />
        <Button type="primary" icon={<EyeOutlined />} loading={previewing} onClick={onPreview}>
          Run preview
        </Button>
      </Space>
    );
  }

  const sample = Array.isArray(preview.sample) ? preview.sample : [];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {stale && (
        <Alert
          type="error"
          showIcon
          message="This preview is out of date."
          description="The campaign has changed since it ran. Preview again — a count from before your last edit is not a count of what you are about to send."
          action={
            <Button size="small" loading={previewing} onClick={onPreview}>
              Re-run
            </Button>
          }
        />
      )}

      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <PhoneMock preview={preview.preview} />

        <Space direction="vertical" size={16} style={{ flex: '1 1 340px', minWidth: 300 }}>
          <Space size="large" align="start" wrap>
            <Statistic
              title="People matching this audience"
              value={preview.audience_count ?? 0}
              formatter={(v) => Number(v).toLocaleString('en-IN')}
            />
            <Button icon={<EyeOutlined />} loading={previewing} onClick={onPreview}>
              Re-run preview
            </Button>
          </Space>

          {/* Verbatim, on purpose. */}
          {preview.note && <Alert type="info" showIcon message={preview.note} />}

          {sample.length > 0 && (
            <div>
              <Text strong>Sample recipients</Text>
              <Table
                rowKey={(r) => r.uid}
                size="small"
                pagination={false}
                style={{ marginTop: 8 }}
                dataSource={sample}
                columns={[
                  { title: 'Name', dataIndex: 'name', key: 'name', render: (v) => v || '—' },
                  {
                    title: 'Account',
                    dataIndex: 'account_type',
                    key: 'account_type',
                    width: 110,
                    render: (v) => (v ? <Tag>{v}</Tag> : '—'),
                  },
                ]}
              />
            </div>
          )}
        </Space>
      </div>

      <Divider orientation="left" plain style={{ margin: 0 }}>
        Send
      </Divider>

      <Alert type="info" showIcon message={SEND_NOW_PACING_NOTE} />
      {bypass && (
        <Alert type="warning" showIcon message={BYPASS_FATIGUE_EXPLAINER} description={BYPASS_FATIGUE_SCOPE} />
      )}

      <Space wrap align="start">
        <Button
          type="primary"
          icon={<SendOutlined />}
          disabled={!canSend || stale}
          onClick={onSendNow}
        >
          Send now
        </Button>
        <DatePicker
          showTime={{ format: 'HH:mm' }}
          format="YYYY-MM-DD HH:mm"
          value={when}
          onChange={setWhen}
          disabledDate={(d) => d && d < dayjs().startOf('day')}
          placeholder="Pick a future time"
        />
        <Button
          icon={<ScheduleOutlined />}
          disabled={!canSend || stale || !when}
          onClick={() => onSchedule(when)}
        >
          Schedule
        </Button>
      </Space>

      {!canSend && !stale && (
        <Text type="secondary">
          {campaign && !isCampaignEditable(campaign)
            ? `This campaign is ${campaignStatusLabel(campaign.status).toLowerCase()} — it can no longer be sent or rescheduled.`
            : 'You need the campaigns “update” permission to send or schedule.'}
        </Text>
      )}
    </Space>
  );
}

/** A phone-shaped mock so the copy is judged as it arrives, not as a form. */
function PhoneMock({ preview }) {
  if (!preview) return null;
  return (
    <div
      style={{
        width: 280,
        border: '10px solid #1f1f1f',
        borderRadius: 28,
        background: '#f0f2f5',
        padding: 12,
        flex: '0 0 auto',
      }}
    >
      <div style={{ height: 18 }} />
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 12,
          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4, wordBreak: 'break-word' }}>
          {preview.title || <Text type="secondary">(no title)</Text>}
        </div>
        <div style={{ fontSize: 13, color: '#555', wordBreak: 'break-word' }}>
          {preview.body || <Text type="secondary">(no message)</Text>}
        </div>
        {preview.cta_label && (
          <div style={{ marginTop: 10 }}>
            <Tag color="blue" style={{ margin: 0 }}>
              {preview.cta_label}
            </Tag>
            {preview.cta_action && (
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  opens {ctaActionLabel(preview.cta_action)}
                </Text>
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ height: 18 }} />
    </div>
  );
}

// ---- Step 2 -----------------------------------------------------------------

/**
 * Presets first, full builder second. Every condition is ANDed — there is no OR
 * and no nesting, and none is built here.
 *
 * The builder only ever emits the eleven accepted keys, and only the ones
 * actually set: an unknown key is a 400 by design, because a silently-ignored
 * filter would make the audience BIGGER than intended.
 */
function AudienceStep({ value, onChange, disabled }) {
  const a = value && typeof value === 'object' ? value : {};
  const preset = matchPreset(a);
  const [custom, setCustom] = useState(preset === null);

  const { data: industries } = adminApi.endpoints.businessCategoriesList.useQuery();

  const set = (key, next) => {
    const out = { ...a };
    const empty =
      next === undefined ||
      next === null ||
      next === '' ||
      (Array.isArray(next) && next.length === 0);
    if (empty) delete out[key];
    else out[key] = next;
    onChange?.(out);
  };

  const industryOptions = useMemo(
    () => (industries || []).map((i) => ({ value: i.id, label: i.name })),
    [industries],
  );

  const uidsText = Array.isArray(a.user_uids) ? a.user_uids.join('\n') : '';

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Text strong>Who should get this?</Text>
        <div style={{ marginTop: 8 }}>
          <Space size={8} wrap>
            {AUDIENCE_PRESETS.map((p) => (
              <Button
                key={p.key}
                type={!custom && preset === p.key ? 'primary' : 'default'}
                disabled={disabled}
                onClick={() => {
                  setCustom(false);
                  onChange?.({ ...p.audience });
                }}
              >
                {p.label}
              </Button>
            ))}
            <Button
              type={custom ? 'primary' : 'dashed'}
              disabled={disabled}
              onClick={() => setCustom(true)}
            >
              Custom…
            </Button>
          </Space>
        </div>
      </div>

      {!custom && (
        <Alert
          type="info"
          showIcon
          message={`Sending to: ${
            AUDIENCE_PRESETS.find((p) => p.key === preset)?.label || 'a custom audience'
          }`}
          description="The exact number is confirmed on the next step, before anything goes out."
        />
      )}

      {custom && (
        <>
          <Alert
            type="info"
            showIcon
            message="Every filter you set is combined with AND."
            description="Only the fields below are accepted — the server rejects anything else outright, because a filter it silently ignored would make the audience bigger than you intended. Leave a field empty to not filter on it."
          />

          <Space size="large" align="start" wrap>
            <LabeledField label="Account type">
              <Select
                allowClear
                disabled={disabled}
                style={{ width: 200 }}
                value={a.account_type}
                onChange={(v) => set('account_type', v)}
                options={ACCOUNT_TYPE_OPTIONS}
                placeholder="Any"
              />
            </LabeledField>

            <LabeledField label="Plan">
              <Select
                allowClear
                disabled={disabled}
                style={{ width: 200 }}
                value={a.plan}
                onChange={(v) => set('plan', v)}
                options={PLAN_OPTIONS}
                placeholder="Any"
              />
            </LabeledField>

            <LabeledField label="Has a business">
              <Select
                allowClear
                disabled={disabled}
                style={{ width: 200 }}
                value={a.has_business}
                onChange={(v) => set('has_business', v)}
                options={[
                  { value: true, label: 'Yes' },
                  { value: false, label: 'No' },
                ]}
                placeholder="Any"
              />
            </LabeledField>

            <LabeledField label="Setup">
              <Select
                allowClear
                disabled={disabled}
                style={{ width: 200 }}
                value={a.onboarding}
                onChange={(v) => set('onboarding', v)}
                options={ONBOARDING_OPTIONS}
                placeholder="Any"
              />
            </LabeledField>
          </Space>

          <LabeledField
            label="Industries"
            help={`At most ${AUDIENCE_LIMITS.industry_ids}.`}
          >
            <Select
              mode="multiple"
              allowClear
              disabled={disabled}
              showSearch
              optionFilterProp="label"
              style={{ width: '100%', maxWidth: 640 }}
              value={a.industry_ids || []}
              onChange={(v) => set('industry_ids', v)}
              options={industryOptions}
              placeholder="Any industry"
              maxTagCount={8}
            />
          </LabeledField>

          <Space size="large" align="start" wrap>
            <LabeledField label="Away at least (days)">
              <InputNumber
                min={0}
                precision={0}
                disabled={disabled}
                style={{ width: 200 }}
                value={a.inactive_days_min ?? null}
                onChange={(v) => set('inactive_days_min', v ?? undefined)}
                placeholder="—"
              />
            </LabeledField>

            <LabeledField label="…and at most (days)">
              <InputNumber
                min={0}
                precision={0}
                disabled={disabled}
                style={{ width: 200 }}
                value={a.inactive_days_max ?? null}
                onChange={(v) => set('inactive_days_max', v ?? undefined)}
                placeholder="—"
              />
            </LabeledField>

            <LabeledField label="Signed up after">
              <DatePicker
                disabled={disabled}
                style={{ width: 200 }}
                value={a.signed_up_after ? dayjs(a.signed_up_after) : null}
                onChange={(d) => set('signed_up_after', d ? d.format(DATE_FMT) : undefined)}
              />
            </LabeledField>

            <LabeledField label="Signed up before">
              <DatePicker
                disabled={disabled}
                style={{ width: 200 }}
                value={a.signed_up_before ? dayjs(a.signed_up_before) : null}
                onChange={(d) => set('signed_up_before', d ? d.format(DATE_FMT) : undefined)}
              />
            </LabeledField>
          </Space>

          <LabeledField label="Cities" help={`At most ${AUDIENCE_LIMITS.cities}. Type and press enter.`}>
            <Select
              mode="tags"
              allowClear
              disabled={disabled}
              open={false}
              suffixIcon={null}
              style={{ width: '100%', maxWidth: 640 }}
              value={a.cities || []}
              onChange={(v) => set('cities', v)}
              placeholder="Any city"
            />
          </LabeledField>

          <LabeledField
            label="Named recipients"
            help={`Paste user UIDs, one per line — at most ${AUDIENCE_LIMITS.user_uids}.`}
          >
            <Input.TextArea
              rows={3}
              disabled={disabled}
              value={uidsText}
              onChange={(e) =>
                set(
                  'user_uids',
                  e.target.value
                    .split(/[\s,]+/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
              placeholder="one uuid per line"
            />
            {Array.isArray(a.user_uids) && a.user_uids.length > 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {a.user_uids.length} uid{a.user_uids.length === 1 ? '' : 's'}
              </Text>
            )}
          </LabeledField>

          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Sent as:
            </Text>
            <pre
              style={{
                margin: '4px 0 0',
                padding: 12,
                background: '#fafafa',
                borderRadius: 6,
                fontSize: 12,
                maxHeight: 160,
                overflow: 'auto',
              }}
            >
              {JSON.stringify(a, null, 2)}
            </pre>
          </div>
        </>
      )}
    </Space>
  );
}

function LabeledField({ label, help, children }) {
  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        <Text strong>{label}</Text>
      </div>
      {children}
      {help && (
        <div style={{ marginTop: 4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {help}
          </Text>
        </div>
      )}
    </div>
  );
}
