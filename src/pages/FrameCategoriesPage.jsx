import { useEffect, useMemo, useState } from 'react';
import { Table, Typography, Space, Button, Tag, Switch, Form, Input, Modal, Alert, App } from 'antd';
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
  useFrameCategoryCreateMutation,
  useFrameCategoryUpdateMutation,
  useFrameCategoriesReorderMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import { isTrue } from '../lib/frames';

const { Title, Text, Paragraph } = Typography;

const FORM_FIELDS = ['name', 'slug', 'is_active'];

const orderCmp = (a, b) =>
  (a.display_order ?? 0) - (b.display_order ?? 0) ||
  String(a.name || '').localeCompare(String(b.name || ''));

function moveItem(arr, from, to) {
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The same shape the server derives when `slug` is omitted on create. */
function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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
    const field = /slug/i.test(text) ? 'slug' : 'name';
    form.setFields([{ name: field, errors: [err.message] }]);
    return null;
  }
  return err?.message || 'Could not save the category.';
}

/**
 * Frame Categories — the filter chips users tap in the Frames Store.
 *
 * Flat, not a tree (there is no parent_id), and short enough that the API returns
 * the whole list unpaginated. Row order is the order those chips appear in, set
 * by dragging and persisted with one bulk PATCH …/reorder.
 */
export default function FrameCategoriesPage() {
  const dispatch = useAppDispatch();
  const perms = usePermissions();
  const { message, modal } = App.useApp();

  const canCreate = perms.can('frames', 'create');
  const canUpdate = perms.can('frames', 'update');
  const canDelete = perms.can('frames', 'delete');

  const [editor, setEditor] = useState({ open: false, record: null });
  const [togglingUid, setTogglingUid] = useState(null);
  const [reordering, setReordering] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  const { data, isLoading, isFetching, refetch } =
    adminApi.endpoints.frameCategoriesList.useQuery();
  const [updateCategory] = useFrameCategoryUpdateMutation();
  const [removeCategory] = adminApi.endpoints.frameCategoriesRemove.useMutation();
  const [reorder] = useFrameCategoriesReorderMutation();

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

    // Optimistic patch: display_order = array position, exactly what the server
    // does, so the table settles into the new order immediately.
    const patch = dispatch(
      adminApi.util.updateQueryData('frameCategoriesList', undefined, (draft) => {
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
      await updateCategory({ uid: record.uid, body: { is_active: next ? 1 : 0 } }).unwrap();
      message.success(next ? `${record.name} is back in the store` : `${record.name} hidden`);
    } catch (err) {
      message.error(err?.message || 'Could not change the category status.');
    } finally {
      setTogglingUid(null);
    }
  };

  const onDelete = (record) => {
    modal.confirm({
      title: `Delete "${record.name}"?`,
      content:
        'Frames filed under it lose their category, and an uncategorised frame is unreachable in the store. To just take the chip away, switch it inactive instead.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeCategory(record.uid).unwrap();
          message.success('Category deleted');
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
      render: (v) => <Text strong>{v || '—'}</Text>,
    },
    {
      title: 'Slug',
      dataIndex: 'slug',
      key: 'slug',
      width: 200,
      render: (v) => (v ? <Text code>{v}</Text> : <Text type="secondary">—</Text>),
    },
    {
      title: 'Order',
      dataIndex: 'display_order',
      key: 'display_order',
      width: 80,
      render: (v) => <Text type="secondary">{v ?? 0}</Text>,
    },
    {
      title: 'Active',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 90,
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
          Frame Categories
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
        message="These are the filter chips users tap in the Frames Store."
        description={
          canUpdate
            ? 'Drag the rows to set the order the chips appear in — each change saves automatically.'
            : 'You need the frames “update” permission to reorder or edit them.'
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
        locale={{ emptyText: 'No categories yet — frames need one before they can be published.' }}
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
  // The slug is a public URL key: derived from the name on create, then frozen.
  // Renaming NEVER re-derives it silently — changing it is a deliberate act
  // behind this switch, because anything already linking to the old one breaks.
  const [slugUnlocked, setSlugUnlocked] = useState(false);
  const isEdit = Boolean(record);

  const [createCategory] = useFrameCategoryCreateMutation();
  const [updateCategory] = useFrameCategoryUpdateMutation();

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setSlugUnlocked(false);
    if (record) {
      form.setFieldsValue({
        name: record.name,
        slug: record.slug,
        is_active: isTrue(record.is_active),
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ is_active: true });
    }
  }, [open, record, form]);

  // Create only: keep the slug in step with the name until it is edited by hand.
  const onNameChange = (e) => {
    if (isEdit) return;
    const typed = form.getFieldValue('slug');
    const previous = slugify(form.getFieldValue('name'));
    if (!typed || typed === previous) form.setFieldsValue({ slug: slugify(e.target.value) });
  };

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
      is_active: values.is_active ? 1 : 0,
    };
    // Sent on create (blank → the server derives it), and on edit only when the
    // operator deliberately unlocked the field.
    const slug = (values.slug || '').trim();
    if (slug && (!isEdit || slugUnlocked)) body.slug = slug;
    // `display_order` is owned by the drag-reorder on the list, so it is not a
    // field here — sending it would fight with the order the operator dragged.

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
      title={isEdit ? `Edit "${record?.name}"` : 'New Frame Category'}
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
          extra="The label on the chip in the store."
          rules={[{ required: true, message: 'Name is required' }]}
        >
          <Input placeholder="e.g. Festive" onChange={onNameChange} />
        </Form.Item>

        {isEdit && !slugUnlocked ? (
          <Form.Item
            label="Slug"
            extra="Public URL key, set when the category was created. Renaming leaves it alone on purpose."
          >
            <Space>
              <Text code>{record?.slug || '—'}</Text>
              <Button size="small" onClick={() => setSlugUnlocked(true)}>
                Change slug
              </Button>
            </Space>
          </Form.Item>
        ) : (
          <Form.Item
            name="slug"
            label="Slug"
            extra={
              isEdit
                ? 'Changing this breaks anything already pointing at the old slug.'
                : 'Derived from the name. Leave it as it is unless you need something specific.'
            }
            normalize={(v) => (v ? v.toLowerCase() : v)}
            rules={[
              {
                pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/,
                message: 'Lowercase letters, numbers and single hyphens.',
              },
            ]}
          >
            <Input placeholder="auto-derived from the name" />
          </Form.Item>
        )}

        <Form.Item
          name="is_active"
          label="Active"
          valuePropName="checked"
          extra="Inactive takes the chip out of the store without deleting the category."
        >
          <Switch />
        </Form.Item>

        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Chip order is set by dragging the rows on this screen, not here.
        </Paragraph>
      </Form>
    </Modal>
  );
}
