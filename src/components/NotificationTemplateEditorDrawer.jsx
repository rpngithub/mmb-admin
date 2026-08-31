import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Drawer,
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
  Collapse,
  Divider,
  Typography,
  App,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  adminApi,
  useNotificationTemplateCreateMutation,
  useNotificationTemplateUpdateMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import ImageUploadField from './ImageUploadField';
import {
  ACCOUNT_TYPE_OPTIONS,
  COOLDOWN_OPTIONS,
  CTA_ACTION_OPTIONS,
  PENDING_FEATURE_NOTE,
  PLACEHOLDER_HELP,
  PLAN_OPTIONS,
  PROMOTIONAL_EXPLAINER,
  PROMOTIONAL_SYSTEM_WARNING,
  SHOW_AS_IMPORTANT_HELP,
  SYSTEM_LOCKED_EXPLAINER,
  SYSTEM_LOCKED_FIELDS,
  allowedPlaceholders,
  applyNotificationServerError,
  describeTrigger,
  diffBody,
  extractPlaceholders,
  isKnownCtaAction,
  isPendingFeature,
  isTrue,
  jsonToText,
  nullableText,
  numOrNull,
  textToJson,
  unknownPlaceholders,
} from '../lib/notifications';

const { Text, Paragraph } = Typography;

// Every writable key that has a form item, so a 400's details[] pins to its
// field. Deliberately excludes `variables` and `priority` — both are returned by
// the API and rejected on the way back.
const FORM_FIELDS = [
  'code',
  'category_id',
  'title',
  'body',
  'cta_label',
  'cta_action',
  'cta_params',
  'image_s3_key',
  'variable_defaults',
  'trigger_type',
  'trigger_config',
  'audience_account_type',
  'audience_plan',
  'display_priority',
  'is_promotional',
  'cooldown_hours',
  'max_occurrences',
  'is_dismissible',
  'expires_after_days',
  'is_active',
];

const CODE_PATTERN = /^[a-z][a-z0-9_]{2,79}$/;

function formValuesFrom(full) {
  const action = full?.cta_action ?? '';
  return {
    code: full?.code ?? '',
    category_id: full?.category_id ?? undefined,
    title: full?.title ?? '',
    body: full?.body ?? '',
    cta_label: full?.cta_label ?? '',
    // A route key the app added after this list was written stays in the escape
    // hatch rather than being silently dropped by the dropdown.
    cta_action: isKnownCtaAction(action) ? action : undefined,
    cta_action_custom: action && !isKnownCtaAction(action) ? action : '',
    cta_params: jsonToText(full?.cta_params),
    image_s3_key: full?.image_s3_key ?? undefined,
    variable_defaults: full?.variable_defaults && typeof full.variable_defaults === 'object'
      ? { ...full.variable_defaults }
      : {},
    trigger_type: full?.trigger_type ?? '',
    trigger_config: jsonToText(full?.trigger_config),
    audience_account_type: full?.audience_account_type ?? 'all',
    audience_plan: full?.audience_plan ?? 'all',
    // Held as the raw server value so an untouched `low` row is never quietly
    // rewritten to `normal` by a two-state toggle.
    display_priority: full?.display_priority ?? 'normal',
    is_promotional: isTrue(full?.is_promotional),
    cooldown_hours: full?.cooldown_hours ?? null,
    max_occurrences: full?.max_occurrences ?? undefined,
    is_dismissible: full?.is_dismissible === undefined ? true : isTrue(full.is_dismissible),
    expires_after_days: full?.expires_after_days ?? undefined,
    is_active: full?.is_active === undefined ? true : isTrue(full.is_active),
  };
}

/**
 * Build the API body. Only the twenty accepted keys are ever produced — never a
 * spread of the fetched row, which would carry `variables` and `priority` into a
 * 400. Throws with a `field` property when a JSON textarea doesn't parse.
 */
function bodyFrom(values, { placeholders }) {
  const parseJson = (key) => {
    try {
      return textToJson(values[key]);
    } catch (e) {
      const err = new Error(e.message || 'Invalid JSON.');
      err.field = key;
      throw err;
    }
  };

  // A default for a placeholder the copy no longer mentions is a 400 naming the
  // stray key, so drop it rather than sending it.
  const defaults = {};
  for (const [k, v] of Object.entries(values.variable_defaults || {})) {
    if (placeholders.includes(k) && String(v ?? '').trim() !== '') defaults[k] = String(v);
  }

  return {
    code: (values.code || '').trim(),
    category_id: values.category_id ?? null,
    title: values.title ?? '',
    body: values.body ?? '',
    cta_label: nullableText(values.cta_label),
    cta_action: nullableText(values.cta_action || values.cta_action_custom),
    cta_params: parseJson('cta_params'),
    image_s3_key: values.image_s3_key || null,
    variable_defaults: Object.keys(defaults).length ? defaults : null,
    trigger_type: (values.trigger_type || '').trim(),
    trigger_config: parseJson('trigger_config'),
    audience_account_type: values.audience_account_type || 'all',
    audience_plan: values.audience_plan || 'all',
    display_priority: values.display_priority || 'normal',
    is_promotional: values.is_promotional ? 1 : 0,
    cooldown_hours: values.cooldown_hours ?? null,
    max_occurrences: numOrNull(values.max_occurrences),
    is_dismissible: values.is_dismissible ? 1 : 0,
    expires_after_days: numOrNull(values.expires_after_days),
    is_active: values.is_active ? 1 : 0,
  };
}

/**
 * Editor for one notification. FIVE controls are visible — title, message,
 * button label, button action, active — because the realistic jobs are, in
 * order: reword one, turn one off, and only rarely change who gets it. If
 * someone cannot reword a notification without scrolling, the screen is wrong.
 *
 * Everything else lives under a collapsed Advanced panel, and the three keys a
 * built-in row returns 403 for are printed as grey text at the bottom of it —
 * never as disabled inputs, because an input that always rejects you reads as a
 * bug.
 *
 * The admin never maintains the placeholder list: `variables` is server-owned
 * and read-only here, rendered as chips that insert `{{name}}` at the cursor.
 */
export default function NotificationTemplateEditorDrawer({ open, uid, row, onClose, onSaved }) {
  const { message, modal } = App.useApp();
  const perms = usePermissions();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const bodyRef = useRef(null);

  const isEdit = Boolean(uid);
  const canSave = isEdit
    ? perms.can('notifications', 'update')
    : perms.can('notifications', 'create');

  const { data: categories } = adminApi.endpoints.notificationCategoriesList.useQuery();
  const { data: full, isFetching } = adminApi.endpoints.notificationTemplateGet.useQuery(uid, {
    skip: !uid,
  });

  const [createTemplate] = useNotificationTemplateCreateMutation();
  const [updateTemplate] = useNotificationTemplateUpdateMutation();

  // `row` is the list row — available immediately, so the header and the banners
  // render before GET /:uid resolves.
  const record = full || row || null;
  const isSystem = isTrue(record?.is_system);
  const pendingFeature = isPendingFeature(record);

  const title = Form.useWatch('title', form);
  const body = Form.useWatch('body', form);
  const isPromotional = Form.useWatch('is_promotional', form);
  const displayPriority = Form.useWatch('display_priority', form);

  // Server-owned. On a custom template this comes back empty and any placeholder
  // is accepted, so the chip row simply doesn't appear.
  const chips = useMemo(() => allowedPlaceholders(record), [record]);
  // Only ever non-empty for a built-in row: a custom template derives its own
  // variables, so nothing there can be unknown.
  const badPlaceholders = useMemo(
    () => unknownPlaceholders(record, title, body),
    [record, title, body],
  );
  // What the copy actually mentions — this is what gets a fallback slot.
  // Removing a placeholder is a normal edit and is never warned about; its
  // default simply stops being sent.
  const usedPlaceholders = useMemo(() => extractPlaceholders(title, body), [title, body]);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (isEdit) {
      if (full) form.setFieldsValue(formValuesFrom(full));
    } else {
      form.resetFields();
      form.setFieldsValue(formValuesFrom(null));
    }
  }, [open, isEdit, full, form]);

  /** Drop `{{name}}` in at the cursor rather than at the end. */
  const insertPlaceholder = (name) => {
    const token = `{{${name}}}`;
    const el = bodyRef.current?.resizableTextArea?.textArea;
    const current = form.getFieldValue('body') || '';
    if (!el) {
      form.setFieldsValue({ body: `${current}${token}` });
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? start;
    const next = `${current.slice(0, start)}${token}${current.slice(end)}`;
    form.setFieldsValue({ body: next });
    // Put the caret after what was just inserted.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const confirmPromotionalChange = (checked) => {
    if (!isSystem) {
      form.setFieldsValue({ is_promotional: checked });
      return;
    }
    modal.confirm({
      title: checked ? 'Make this promotional?' : 'Make this non-promotional?',
      width: 560,
      content: (
        <Space direction="vertical" size={8}>
          <Text>{PROMOTIONAL_SYSTEM_WARNING}</Text>
          <Text type="secondary">{PROMOTIONAL_EXPLAINER}</Text>
        </Space>
      ),
      okText: 'Change it',
      onOk: () => form.setFieldsValue({ is_promotional: checked }),
      onCancel: () => form.setFieldsValue({ is_promotional: !checked }),
    });
  };

  const submit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setFormError(null);

    let next;
    try {
      next = bodyFrom(values, { placeholders: usedPlaceholders });
    } catch (err) {
      form.setFields([{ name: err.field, errors: [err.message] }]);
      return;
    }

    // A built-in row 403s on any of these three, so they never leave the client.
    if (isSystem) for (const key of SYSTEM_LOCKED_FIELDS) delete next[key];

    setSubmitting(true);
    try {
      if (isEdit) {
        // PATCH is partial — send only what actually moved.
        const before = bodyFrom(formValuesFrom(full), { placeholders: usedPlaceholders });
        const patch = diffBody(next, before);
        if (Object.keys(patch).length === 0) {
          message.info('Nothing to save — no fields changed.');
          setSubmitting(false);
          return;
        }
        await updateTemplate({ uid, body: patch }).unwrap();
        message.success('Notification saved');
      } else {
        await createTemplate(next).unwrap();
        message.success('Notification created');
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      // The placeholder 400 names both the bad token and every valid one — far
      // more useful than anything written here, so it goes up verbatim.
      setFormError(applyNotificationServerError(form, err, FORM_FIELDS));
    } finally {
      setSubmitting(false);
    }
  };

  const categoryOptions = useMemo(
    () =>
      (categories || []).map((c) => ({
        value: c.id,
        label: isTrue(c.is_active) ? c.name : `${c.name} (off)`,
      })),
    [categories],
  );

  return (
    <Drawer
      title={isEdit ? record?.title || 'Notification' : 'New notification'}
      open={open}
      onClose={onClose}
      width={640}
      destroyOnClose
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="primary" loading={submitting} onClick={submit} disabled={!canSave}>
              {isEdit ? 'Save' : 'Create'}
            </Button>
          </Space>
        </div>
      }
    >
      <Spin spinning={isEdit && isFetching}>
        {/* Header: what this is and when it goes out, in a sentence. */}
        {isEdit && record && (
          <div style={{ marginBottom: 16 }}>
            <Space size={8} wrap style={{ marginBottom: 4 }}>
              <Text strong style={{ fontSize: 16 }}>
                {record.title || record.code}
              </Text>
              <Tag color={isSystem ? 'purple' : 'blue'}>{isSystem ? 'Built-in' : 'Custom'}</Tag>
              {!isTrue(record.is_active) && <Tag>Off</Tag>}
            </Space>
            <div>
              <Text type="secondary">{describeTrigger(record)}</Text>
            </div>
          </div>
        )}

        {formError && (
          <Alert type="error" showIcon style={{ marginBottom: 16 }} message={formError} />
        )}

        {pendingFeature && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={PENDING_FEATURE_NOTE}
            description="Switching it on will not make it fire — the feature it describes does not exist yet."
          />
        )}

        {badPlaceholders.length > 0 && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message={`This notification cannot fill ${badPlaceholders
              .map((p) => `{{${p}}}`)
              .join(', ')}.`}
            description={
              chips.length
                ? `Available placeholders: ${chips.map((c) => `{{${c}}}`).join(', ')}`
                : 'This notification has no placeholders available.'
            }
          />
        )}

        <Form form={form} layout="vertical" disabled={!canSave}>
          {/* ---- The five controls ------------------------------------------ */}
          <Form.Item
            name="title"
            label="Title"
            rules={[{ required: true, message: 'Title is required' }]}
          >
            <Input placeholder="e.g. Trial Activated" />
          </Form.Item>

          <Form.Item
            name="body"
            label="Message"
            rules={[{ required: true, message: 'Message is required' }]}
            style={{ marginBottom: chips.length ? 4 : 24 }}
          >
            <Input.TextArea ref={bodyRef} rows={4} placeholder="What the user reads." />
          </Form.Item>

          {chips.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <Space size={4} wrap>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Insert:
                </Text>
                {chips.map((name) => (
                  <Tag
                    key={name}
                    icon={<PlusOutlined />}
                    style={{ cursor: canSave ? 'pointer' : 'default', userSelect: 'none' }}
                    onClick={() => canSave && insertPlaceholder(name)}
                  >
                    {name}
                  </Tag>
                ))}
              </Space>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {PLACEHOLDER_HELP}
                </Text>
              </div>
            </div>
          )}

          <Space size="large" align="start" wrap>
            <Form.Item name="cta_label" label="Button label" style={{ minWidth: 240 }}>
              <Input placeholder="e.g. Explore Premium" />
            </Form.Item>

            <Form.Item
              name="cta_action"
              label="Button opens"
              extra="Not in the list? Set a route key under Advanced."
              style={{ minWidth: 260 }}
            >
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

          <Form.Item name="is_active" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>

          {/* ---- Advanced settings, collapsed ------------------------------- */}
          <Collapse
            ghost
            style={{ marginTop: 8 }}
            items={[
              {
                key: 'advanced',
                label: <Text strong>Advanced settings</Text>,
                children: (
                  <>
                    <Divider orientation="left" plain style={{ marginTop: 0 }}>
                      Who gets it
                    </Divider>
                    <Space size="large" align="start" wrap>
                      <Form.Item name="audience_account_type" label="Account type">
                        <Select options={ACCOUNT_TYPE_OPTIONS} style={{ width: 220 }} />
                      </Form.Item>
                      <Form.Item name="audience_plan" label="Plan">
                        <Select options={PLAN_OPTIONS} style={{ width: 220 }} />
                      </Form.Item>
                    </Space>

                    <Divider orientation="left" plain>
                      How often
                    </Divider>
                    <Form.Item
                      name="cooldown_hours"
                      label="Send to the same person"
                      extra="How long to wait before this notification may reach one user again."
                    >
                      <Select options={COOLDOWN_OPTIONS} style={{ width: 240 }} />
                    </Form.Item>

                    <Space size="large" align="start" wrap>
                      <Form.Item
                        name="max_occurrences"
                        label="Stop after N times"
                        extra="Blank means no limit."
                      >
                        <InputNumber min={0} precision={0} style={{ width: 200 }} placeholder="—" />
                      </Form.Item>
                      <Form.Item
                        name="expires_after_days"
                        label="Hide from the inbox after N days"
                        extra="Blank means never."
                      >
                        <InputNumber min={0} precision={0} style={{ width: 200 }} placeholder="—" />
                      </Form.Item>
                    </Space>

                    <Form.Item
                      name="is_promotional"
                      label="Promotional"
                      valuePropName="checked"
                      extra={PROMOTIONAL_EXPLAINER}
                    >
                      <Switch onChange={confirmPromotionalChange} />
                    </Form.Item>

                    {!isPromotional && (
                      <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                        message="This always gets through."
                        description="Non-promotional notifications ignore the marketing opt-out, the daily and weekly limits and quiet hours. Correct for receipts and payment failures; wrong for anything marketing."
                      />
                    )}

                    <Divider orientation="left" plain>
                      Appearance
                    </Divider>
                    <Space size="large" align="start" wrap>
                      {/* Held as the raw value so an untouched `low` row is not
                          rewritten to `normal` just by rendering the toggle. */}
                      <Form.Item
                        name="display_priority"
                        label="Show as important"
                        extra={SHOW_AS_IMPORTANT_HELP}
                        getValueProps={(v) => ({ checked: v === 'high' })}
                        normalize={(checked) =>
                          checked ? 'high' : displayPriority === 'high' ? 'normal' : displayPriority
                        }
                      >
                        <Switch />
                      </Form.Item>

                      <Form.Item
                        name="is_dismissible"
                        label="User can swipe it away"
                        valuePropName="checked"
                      >
                        <Switch />
                      </Form.Item>
                    </Space>

                    <Form.Item name="image_s3_key" label="Image">
                      <ImageUploadField slot="notification_image" disabled={!canSave} />
                    </Form.Item>

                    <Divider orientation="left" plain>
                      Grouping
                    </Divider>
                    <Form.Item
                      name="category_id"
                      label="Category"
                      extra="The bucket this belongs to — and the one a user mutes to stop receiving it."
                      rules={[{ required: true, message: 'Pick a category' }]}
                    >
                      <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="Pick a category"
                        options={categoryOptions}
                        style={{ maxWidth: 320 }}
                      />
                    </Form.Item>

                    {usedPlaceholders.length > 0 && (
                      <>
                        <Divider orientation="left" plain>
                          Placeholder fallbacks
                        </Divider>
                        <Form.Item
                          name="variable_defaults"
                          extra="Used when a value is missing at send time. Only placeholders your message actually uses can have one."
                        >
                          <VariableDefaultsEditor
                            placeholders={usedPlaceholders}
                            disabled={!canSave}
                          />
                        </Form.Item>
                      </>
                    )}

                    <Divider orientation="left" plain>
                      Button route
                    </Divider>
                    <Form.Item
                      name="cta_action_custom"
                      label="Custom route key"
                      extra="For a screen the app added after this list was written. Leave empty unless the dropdown above has no entry for it."
                    >
                      <Input placeholder="e.g. offers.detail" style={{ maxWidth: 320 }} />
                    </Form.Item>

                    <Form.Item
                      name="cta_params"
                      label="Button parameters"
                      extra="Optional JSON object passed along with the action."
                    >
                      <Input.TextArea rows={2} placeholder='{ "plan": "pro" }' />
                    </Form.Item>

                    {/* ---- Locked, as grey text ---------------------------- */}
                    {isSystem ? (
                      <>
                        <Divider orientation="left" plain>
                          Built in
                        </Divider>
                        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                          Built-in notification. Identifier <Text code>{record?.code}</Text>,{' '}
                          {describeTrigger(record).toLowerCase()}. {SYSTEM_LOCKED_EXPLAINER}
                        </Paragraph>
                      </>
                    ) : (
                      <>
                        <Divider orientation="left" plain>
                          Identifier and trigger
                        </Divider>
                        <Form.Item
                          name="code"
                          label="Identifier"
                          extra="Lowercase, letters/numbers/underscores, starting with a letter. Set once."
                          rules={[
                            { required: true, message: 'An identifier is required' },
                            {
                              pattern: CODE_PATTERN,
                              message: '3–80 characters, lowercase snake_case, starting with a letter.',
                            },
                          ]}
                        >
                          <Input placeholder="e.g. weekly_digest" disabled={isEdit} />
                        </Form.Item>

                        <Form.Item
                          name="trigger_type"
                          label="Trigger type"
                          extra="event, scheduled, behavioral, recurring or manual."
                          rules={[{ required: true, message: 'A trigger type is required' }]}
                        >
                          <Input placeholder="e.g. manual" style={{ maxWidth: 320 }} />
                        </Form.Item>

                        <Form.Item
                          name="trigger_config"
                          label="Trigger config"
                          extra="Optional JSON object that parameterises the trigger."
                        >
                          <Input.TextArea rows={3} placeholder='{ "anchor": "trial_end", "offset": -1 }' />
                        </Form.Item>
                      </>
                    )}
                  </>
                ),
              },
            ]}
          />
        </Form>
      </Spin>
    </Drawer>
  );
}

/**
 * `variable_defaults` — a { name: fallback } map. One row per placeholder the
 * copy actually uses, so it can never hold a stray key (which is a 400 naming
 * it).
 */
function VariableDefaultsEditor({ value, onChange, placeholders, disabled }) {
  const map = value && typeof value === 'object' ? value : {};
  const set = (name, next) => onChange?.({ ...map, [name]: next });

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {placeholders.map((name) => (
        <Space key={name} align="center">
          <Tag style={{ minWidth: 130, textAlign: 'center' }}>{name}</Tag>
          <Input
            value={map[name] ?? ''}
            disabled={disabled}
            onChange={(e) => set(name, e.target.value)}
            placeholder="fallback text"
            style={{ width: 320 }}
          />
        </Space>
      ))}
    </Space>
  );
}
