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
  Checkbox,
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
  useNotificationCategoryCreateMutation,
  useNotificationCategoryUpdateMutation,
  useNotificationCategoriesReorderMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import { isTrue, errorText, nullableText } from '../lib/notifications';

const { Title, Text, Paragraph } = Typography;

// Every writable key with a form item, so a 400's details[] pins to its field.
const FORM_FIELDS = ['name', 'slug', 'description', 'icon'];

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const orderCmp = (a, b) =>
  (a.display_order ?? 0) - (b.display_order ?? 0) ||
  String(a.name || '').localeCompare(String(b.name || ''));

function moveItem(arr, from, to) {
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Push a backend error onto the form. `name` is unique case-insensitively and
 * its 409 carries no details[], so it is pinned to the name field rather than
 * left as a toast.
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
    form.setFields([
      { name: 'name', errors: [err.message || 'A category with this name already exists.'] },
    ]);
    return null;
  }
  return errorText(err, 'Could not save the category.');
}

/**
 * Notification categories — the bucket every notification belongs to, and the
 * thing a USER MUTES. Ten are seeded, so this screen is overwhelmingly about
 * renaming and reordering; creating one is rare.
 *
 * Order is set by dragging the rows and saved with one bulk PATCH …/reorder
 * (array position → display_order), not by typing a number.
 *
 * `slug` is derived from the name ON CREATE ONLY and is never re-derived when
 * the name changes — an existing slug is a key clients hold. Changing it is
 * therefore an explicit, opt-in act behind a checkbox in the editor.
 */
export default function NotificationCategoriesPage() {
  const dispatch = useAppDispatch();
  const perms = usePermissions();
  const { message, modal } = App.useApp();

  const canCreate = perms.can('notifications', 'create');
  const canUpdate = perms.can('notifications', 'update');
  const canDelete = perms.can('notifications', 'delete');

  const [editor, setEditor] = useState({ open: false, record: null });
  const [togglingUid, setTogglingUid] = useState(null);
  const [reordering, setReordering] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  const { data, isLoading, isFetching, refetch } =
    adminApi.endpoints.notificationCategoriesList.useQuery();
  const [updateCategory] = useNotificationCategoryUpdateMutation();
  const [removeCategory] = adminApi.endpoints.notificationCategoriesRemove.useMutation();
  const [reorder] = useNotificationCategoriesReorderMutation();

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

    // Optimistic patch: assign display_order by array position (what the server
    // does), so the table re-sorts into the new order immediately.
    const patch = dispatch(
      adminApi.util.updateQueryData('notificationCategoriesList', undefined, (draft) => {
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
      message.error(errorText(err, 'Failed to save the new order — reverted.'));
      refetch();
    } finally {
      setReordering(false);
    }
  };

  const toggleActive = async (record, next) => {
    setTogglingUid(record.uid);
    try {
      await updateCategory({ uid: record.uid, body: { is_active: next ? 1 : 0 } }).unwrap();
      message.success(next ? `${record.name} is live again` : `${record.name} is switched off`);
    } catch (err) {
      message.error(errorText(err, 'Could not change the category status.'));
    } finally {
      setTogglingUid(null);
    }
  };

  const onDelete = (record) => {
    modal.confirm({
      title: `Delete “${record.name}”?`,
      content:
        'Categories are seeded to match what the app groups notifications by, and a user’s mute setting points at one. If you only want to stop using it, switch it inactive instead.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeCategory(record.uid).unwrap();
          message.success('Category deleted');
        } catch (err) {
          message.error(errorText(err, 'Could not delete the category.'));
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
          style={{
            color: dragEnabled ? '#999' : '#d9d9d9',
            cursor: dragEnabled ? 'grab' : 'default',
          }}
        />
      ),
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (v, r) => (
        <Space size={6}>
          {r.icon ? <Text type="secondary">{r.icon}</Text> : null}
          <Text strong>{v || '—'}</Text>
        </Space>
      ),
    },
    {
      title: 'Slug',
      dataIndex: 'slug',
      key: 'slug',
      width: 200,
      render: (v) => (v ? <Text code>{v}</Text> : <Text type="secondary">—</Text>),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (v) => v || <Text type="secondary">—</Text>,
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
          Notification Categories
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
              New Category
            </Button>
          )}
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="A category is the bucket a notification belongs to — and the thing a user mutes."
        description={
          <>
            The ten seeded categories match how the app groups notifications, so this screen is
            mostly for renaming and reordering; new ones are rare.
            {canUpdate
              ? ' Drag the rows to set the order — each change saves automatically.'
              : ' You need the notifications “update” permission to reorder or edit them.'}
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

      <CategoryEditor
        open={editor.open}
        record={editor.record}
        onClose={() => setEditor({ open: false, record: null })}
      />
    </div>
  );
}

// ---- create / edit modal ----------------------------------------------------

function CategoryEditor({ open, record, onClose }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  // The slug is only ever sent when the admin deliberately asks to change it.
  const [changeSlug, setChangeSlug] = useState(false);
  const isEdit = Boolean(record);

  const [createCategory] = useNotificationCategoryCreateMutation();
  const [updateCategory] = useNotificationCategoryUpdateMutation();

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setChangeSlug(false);
    if (record) {
      form.setFieldsValue({
        name: record.name ?? '',
        slug: record.slug ?? '',
        description: record.description ?? '',
        icon: record.icon ?? '',
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
      name: (values.name || '').trim(),
      description: nullableText(values.description),
      icon: nullableText(values.icon),
      is_active: values.is_active ? 1 : 0,
    };
    // On create the server derives the slug from the name unless one is given;
    // on edit it is only ever sent when the admin opted in, because a rename
    // must NOT move the slug.
    const slug = (values.slug || '').trim();
    if (slug && (!isEdit || changeSlug)) body.slug = slug;

    setSubmitting(true);
    try {
      if (isEdit) {
        await updateCategory({ uid: record.uid, body }).unwrap();
        message.success('Category updated');
      } else {
        await createCategory(body).unwrap();
        message.success('Category created');
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
      title={isEdit ? `Edit “${record?.name}”` : 'New Notification Category'}
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      okText="Save"
      confirmLoading={submitting}
      destroyOnClose
    >
      {formError && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={formError} />}

      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label="Name"
          extra="Unique, ignoring case — a duplicate is rejected."
          rules={[{ required: true, message: 'Name is required' }]}
        >
          <Input placeholder="e.g. Account & Billing" />
        </Form.Item>

        {isEdit ? (
          <>
            <Form.Item label="Slug" style={{ marginBottom: 8 }}>
              {changeSlug ? null : <Text code>{record?.slug || '—'}</Text>}
            </Form.Item>
            <Checkbox
              checked={changeSlug}
              onChange={(e) => setChangeSlug(e.target.checked)}
              style={{ marginBottom: changeSlug ? 8 : 16 }}
            >
              Change the slug too
            </Checkbox>
            {changeSlug && (
              <>
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="Renaming a category never moves its slug on its own."
                  description="The slug is a stable key — change it only if you know what is reading it."
                />
                <Form.Item
                  name="slug"
                  normalize={(v) => (v ? v.toLowerCase() : v)}
                  rules={[
                    { required: true, message: 'Enter a slug or untick the box' },
                    { pattern: SLUG_PATTERN, message: 'Lowercase words joined by hyphens.' },
                  ]}
                >
                  <Input placeholder="e.g. account-billing" />
                </Form.Item>
              </>
            )}
          </>
        ) : (
          <Form.Item
            name="slug"
            label="Slug"
            extra="Leave empty and it is derived from the name. It is never re-derived afterwards, so a later rename keeps whatever is set here."
            normalize={(v) => (v ? v.toLowerCase() : v)}
            rules={[{ pattern: SLUG_PATTERN, message: 'Lowercase words joined by hyphens.' }]}
          >
            <Input placeholder="auto" />
          </Form.Item>
        )}

        <Form.Item name="description" label="Description">
          <Input.TextArea rows={2} placeholder="Optional — what belongs in this category" />
        </Form.Item>

        <Form.Item
          name="icon"
          label="Icon"
          extra="The icon name the app resolves for this category."
        >
          <Input placeholder="e.g. bell" style={{ width: 240 }} />
        </Form.Item>

        <Form.Item
          name="is_active"
          label="Active"
          valuePropName="checked"
          extra="Inactive hides the category without deleting it."
        >
          <Switch />
        </Form.Item>

        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Display order is set by dragging the rows on this screen, not here
          {isEdit && record?.display_order != null ? (
            <>
              {' '}
              — currently <Text code>{record.display_order}</Text>
            </>
          ) : null}
          .
        </Paragraph>
      </Form>
    </Modal>
  );
}
