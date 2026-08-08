import { useEffect, useMemo, useState } from 'react';
import {
  Table,
  Typography,
  Space,
  Button,
  Tag,
  Switch,
  Form,
  Input,
  Modal,
  Alert,
  App,
} from 'antd';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  HolderOutlined,
} from '@ant-design/icons';
import { useAppDispatch } from '../app/hooks';
import {
  adminApi,
  useLanguageCreateMutation,
  useLanguageUpdateMutation,
  useLanguagesReorderMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';

const { Title, Text, Paragraph } = Typography;

const isTrue = (v) => v === true || v === 1 || v === '1';

// Two lowercase letters, optionally a two-letter region ("ta", "pt-br").
const CODE_PATTERN = /^[a-z]{2}(-[a-z]{2})?$/;

// `code` and `name` are both unique; a 409 names the duplicated column in its
// message but carries no details[], so we infer the field from the text.
const CONFLICT_FIELDS = ['code', 'name'];
const FORM_FIELDS = ['code', 'name', 'native_name'];

const orderCmp = (a, b) =>
  (a.display_order ?? 0) - (b.display_order ?? 0) ||
  String(a.name || '').localeCompare(String(b.name || ''));

// Move an array item from `from` to `to`, returning a new array.
function moveItem(arr, from, to) {
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Push a backend validation/conflict error onto the form. Returns the message to
 * show at form level when it couldn't be pinned to a single field.
 */
function applyServerError(form, err) {
  const details = Array.isArray(err?.details) ? err.details : [];
  const mapped = details.filter((d) => FORM_FIELDS.includes(d.field));
  if (mapped.length) {
    form.setFields(mapped.map((d) => ({ name: d.field, errors: [d.message] })));
    const rest = details.filter((d) => !FORM_FIELDS.includes(d.field));
    return rest.length ? rest.map((d) => d.message).join(' ') : null;
  }
  if (err?.status === 409) {
    const text = String(err?.message || '');
    const field = CONFLICT_FIELDS.find((f) => new RegExp(`\\b${f}\\b`, 'i').test(text));
    if (field) {
      form.setFields([{ name: field, errors: [err.message] }]);
      return null;
    }
  }
  return err?.message || 'Could not save the language.';
}

/**
 * Languages — the CONTENT languages on offer. Users pick "Preferred Languages" in
 * the app and their template browse is filtered to those; this screen owns that
 * list. It is NOT the app's UI language.
 *
 * Row order is the order the app's picker renders, set by drag-and-drop and
 * persisted with one bulk PATCH …/reorder (array position → display_order).
 * Deactivating hides a language from the app without deleting it — deleting
 * un-tags every template that used it, so the UI pushes towards the toggle.
 */
export default function LanguagesPage() {
  const dispatch = useAppDispatch();
  const perms = usePermissions();
  const { message, modal } = App.useApp();

  const canCreate = perms.can('languages', 'create');
  const canUpdate = perms.can('languages', 'update');
  const canDelete = perms.can('languages', 'delete');

  const [editor, setEditor] = useState({ open: false, record: null });
  // One in-flight uid for the row toggle, plus a global lock while the atomic
  // reorder is saving so two quick drops can't race it.
  const [togglingUid, setTogglingUid] = useState(null);
  const [reordering, setReordering] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  const { data, isLoading, isFetching, refetch } = adminApi.endpoints.languagesList.useQuery();
  const [updateLanguage] = useLanguageUpdateMutation();
  const [removeLanguage] = adminApi.endpoints.languagesRemove.useMutation();
  const [reorder] = useLanguagesReorderMutation();

  const rows = useMemo(() => [...(data || [])].sort(orderCmp), [data]);

  const dragEnabled = canUpdate && !reordering;

  const resetDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const handleDrop = async (index) => {
    if (dragIndex == null || dragIndex === index) {
      resetDrag();
      return;
    }
    const nextRows = moveItem(rows, dragIndex, index);
    resetDrag();

    // Optimistic patch: assign display_order by array position (mirrors what the
    // server does), so the table re-sorts into the new order immediately.
    const patch = dispatch(
      adminApi.util.updateQueryData('languagesList', undefined, (draft) => {
        nextRows.forEach((r, i) => {
          const row = draft.find((d) => d.uid === r.uid);
          if (row) row.display_order = i;
        });
      }),
    );
    setReordering(true);
    try {
      await reorder(nextRows.map((r) => r.uid)).unwrap();
    } catch (err) {
      patch.undo();
      message.error(err?.message || 'Failed to save the new order — reverted.');
      refetch();
    } finally {
      setReordering(false);
    }
  };

  const toggleActive = async (record, next) => {
    setTogglingUid(record.uid);
    try {
      await updateLanguage({ uid: record.uid, body: { is_active: next ? 1 : 0 } }).unwrap();
      message.success(
        next
          ? `${record.native_name || record.name} is now offered in the app`
          : `${record.native_name || record.name} is hidden from the app`,
      );
    } catch (err) {
      message.error(err?.message || 'Could not change the language status.');
    } finally {
      setTogglingUid(null);
    }
  };

  const onDelete = (record) => {
    modal.confirm({
      title: `Delete "${record.native_name || record.name}"?`,
      content:
        'Deleting a language un-tags every template that used it. To just hide it from the app, switch it inactive instead.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeLanguage(record.uid).unwrap();
          message.success('Language deleted');
        } catch {
          // error notification handled by baseQuery
        }
      },
    });
  };

  const columns = [
    {
      title: '',
      key: 'drag',
      width: 40,
      render: () => (
        <HolderOutlined
          style={{ color: dragEnabled ? '#999' : '#d9d9d9', cursor: dragEnabled ? 'grab' : 'default' }}
        />
      ),
    },
    {
      // The primary column: this is the string end users actually see.
      title: 'Native name',
      dataIndex: 'native_name',
      key: 'native_name',
      render: (v) => <Text style={{ fontSize: 16, fontWeight: 600 }}>{v || '—'}</Text>,
    },
    {
      title: 'English name',
      dataIndex: 'name',
      key: 'name',
      render: (v) => <Text type="secondary">{v || '—'}</Text>,
    },
    {
      title: 'Code',
      dataIndex: 'code',
      key: 'code',
      width: 100,
      render: (v) => (v ? <Text code>{v}</Text> : <Text type="secondary">—</Text>),
    },
    {
      title: 'Active',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 110,
      render: (v, record) =>
        canUpdate ? (
          <Switch
            size="small"
            checked={isTrue(v)}
            loading={togglingUid === record.uid}
            onChange={(checked) => toggleActive(record, checked)}
          />
        ) : (
          <Tag color={isTrue(v) ? 'green' : 'default'}>{isTrue(v) ? 'Yes' : 'No'}</Tag>
        ),
    },
  ];

  if (canUpdate || canDelete) {
    columns.push({
      title: 'Actions',
      key: 'actions',
      width: 110,
      fixed: 'right',
      render: (_v, record) => (
        <Space size="small">
          {canUpdate && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditor({ open: true, record })}
              title="Edit"
            />
          )}
          {canDelete && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onDelete(record)}
              title="Delete"
            />
          )}
        </Space>
      ),
    });
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
        <Title level={4} style={{ margin: 0 }}>
          Languages
        </Title>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching || reordering}>
            Reload
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setEditor({ open: true, record: null })}
            >
              New Language
            </Button>
          )}
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="These are content languages, not the app's interface language."
        description={
          <>
            Users pick their preferred languages here and their template browse is filtered to them.
            {canUpdate
              ? ' Drag the rows to set the order the picker shows them in — each change saves automatically.'
              : ' You need the languages “update” permission to reorder or edit them.'}
          </>
        }
      />

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        size="middle"
        onRow={(_record, index) => ({
          draggable: dragEnabled,
          onDragStart: (e) => {
            setDragIndex(index);
            e.dataTransfer.effectAllowed = 'move';
            // Firefox requires data to be set for a drag to start.
            e.dataTransfer.setData('text/plain', String(index));
          },
          onDragOver: (e) => {
            if (!dragEnabled || dragIndex == null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (overIndex !== index) setOverIndex(index);
          },
          onDrop: (e) => {
            e.preventDefault();
            handleDrop(index);
          },
          onDragEnd: resetDrag,
          style: {
            cursor: dragEnabled ? 'grab' : 'default',
            opacity: dragIndex === index ? 0.5 : 1,
            boxShadow:
              overIndex === index && dragIndex != null && dragIndex !== index
                ? 'inset 0 2px 0 #1677ff'
                : undefined,
          },
        })}
      />

      <LanguageEditor
        open={editor.open}
        record={editor.record}
        onClose={() => setEditor({ open: false, record: null })}
      />
    </div>
  );
}

// ---- create / edit modal ----------------------------------------------------

function LanguageEditor({ open, record, onClose }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const isEdit = Boolean(record);

  const [createLanguage] = useLanguageCreateMutation();
  const [updateLanguage] = useLanguageUpdateMutation();

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (record) {
      form.setFieldsValue({
        code: record.code,
        name: record.name,
        native_name: record.native_name,
        is_active: isTrue(record.is_active),
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ is_active: true });
    }
  }, [open, record, form]);

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setFormError(null);

    const body = {
      name: values.name.trim(),
      native_name: values.native_name.trim(),
      is_active: values.is_active ? 1 : 0,
    };
    // `code` is a stable key clients hold — set once, never changed.
    if (!isEdit) body.code = values.code.trim().toLowerCase();

    setSubmitting(true);
    try {
      if (isEdit) {
        await updateLanguage({ uid: record.uid, body }).unwrap();
        message.success('Language updated');
      } else {
        await createLanguage(body).unwrap();
        message.success('Language created');
      }
      onClose();
    } catch (err) {
      setFormError(applyServerError(form, err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={isEdit ? `Edit "${record?.native_name || record?.name}"` : 'New Language'}
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      okText="Save"
      confirmLoading={submitting}
      destroyOnClose
    >
      {formError && (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} message={formError} />
      )}
      <Form form={form} layout="vertical">
        <Form.Item
          name="native_name"
          label="Native name — shown to users"
          extra="Write it in the language itself: தமிழ், हिन्दी, বাংলা. This is the label in the app's language picker, so an English word here degrades the app silently."
          rules={[{ required: true, message: 'Native name is required' }]}
        >
          <Input placeholder="e.g. தமிழ்" />
        </Form.Item>

        <Form.Item
          name="name"
          label="English name — admin only"
          extra="The label used on this screen and nowhere in the app. e.g. Tamil."
          rules={[{ required: true, message: 'English name is required' }]}
        >
          <Input placeholder="e.g. Tamil" />
        </Form.Item>

        {isEdit ? (
          <Form.Item label="Code" extra="Stable key held by clients — not editable after creation.">
            <Text code>{record?.code}</Text>
          </Form.Item>
        ) : (
          <Form.Item
            name="code"
            label="Code"
            extra="Lowercase ISO code: two letters, optionally with a region — ta, hi, pt-br."
            normalize={(v) => (v ? v.toLowerCase() : v)}
            rules={[
              { required: true, message: 'Code is required' },
              { pattern: CODE_PATTERN, message: 'Use two lowercase letters, or xx-yy.' },
            ]}
          >
            <Input placeholder="e.g. ta" style={{ width: 160 }} />
          </Form.Item>
        )}

        <Form.Item
          name="is_active"
          label="Active"
          valuePropName="checked"
          extra="Inactive hides the language from the app without deleting it — templates keep their tag."
        >
          <Switch />
        </Form.Item>

        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Position in the app's picker is set by dragging the rows on this screen, not here.
        </Paragraph>
      </Form>
    </Modal>
  );
}
