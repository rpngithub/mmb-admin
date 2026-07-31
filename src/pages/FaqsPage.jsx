import { useMemo, useState } from 'react';
import {
  Typography,
  Space,
  Button,
  Collapse,
  Table,
  Tag,
  Popconfirm,
  Empty,
  Spin,
  Alert,
  Modal,
  Form,
  Input,
  InputNumber,
  Switch,
  App,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';
import { useAppDispatch } from '../app/hooks';
import {
  adminApi,
  useFaqReorderMutation,
  useFaqDeleteMutation,
  useFaqCategoryUpdateMutation,
  useFaqCategoryDeleteMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import FaqEditorDrawer from './FaqEditorDrawer';

const { Title, Text } = Typography;

const UNCATEGORIZED = '__uncategorized__';

const orderCmp = (a, b) =>
  (a.display_order ?? 0) - (b.display_order ?? 0) ||
  String(a.name || a.question || '').localeCompare(String(b.name || b.question || ''));

const statusTag = (status) => (
  <Tag color={status === 'active' ? 'green' : 'default'}>{status || 'inactive'}</Tag>
);

export default function FaqsPage() {
  const dispatch = useAppDispatch();
  const perms = usePermissions();
  const { message } = App.useApp();

  const canCreate = perms.can('faqs', 'create');
  const canUpdate = perms.can('faqs', 'update');
  const canDelete = perms.can('faqs', 'delete');

  const {
    data: faqs = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = adminApi.endpoints.faqsList.useQuery();
  const { data: categories = [] } = adminApi.endpoints.faqCategoriesList.useQuery();

  const [reorder] = useFaqReorderMutation();
  const [deleteFaq] = useFaqDeleteMutation();
  const [updateCategory] = useFaqCategoryUpdateMutation();
  const [deleteCategory] = useFaqCategoryDeleteMutation();

  const [editor, setEditor] = useState({ open: false, faq: null });
  const [catModal, setCatModal] = useState({ open: false, category: null });

  // Group FAQs by category, ordered by category display_order; Uncategorized last.
  const groups = useMemo(() => {
    const sortedCats = [...categories].sort(orderCmp);
    const byCat = new Map();
    for (const c of sortedCats) byCat.set(c.id, { category: c, items: [] });
    const uncategorized = [];
    for (const f of faqs) {
      if (f.category_id != null && byCat.has(f.category_id)) {
        byCat.get(f.category_id).items.push(f);
      } else {
        uncategorized.push(f);
      }
    }
    const result = sortedCats.map((c) => {
      const g = byCat.get(c.id);
      return { key: String(c.id), category: c, items: [...g.items].sort(orderCmp) };
    });
    if (uncategorized.length) {
      result.push({
        key: UNCATEGORIZED,
        category: null,
        items: [...uncategorized].sort(orderCmp),
      });
    }
    return result;
  }, [faqs, categories]);

  // Category groups only (Uncategorized excluded), in display order.
  const categoryGroups = useMemo(() => groups.filter((g) => g.category), [groups]);

  const handleCategoryReorder = async (index, dir) => {
    const target = dir === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= categoryGroups.length) return;
    const next = categoryGroups.map((g) => g.category);
    [next[index], next[target]] = [next[target], next[index]];

    const changed = [];
    next.forEach((c, i) => {
      if ((c.display_order ?? 0) !== i) changed.push({ uid: c.uid, id: c.id, display_order: i });
    });
    if (!changed.length) return;

    const patch = dispatch(
      adminApi.util.updateQueryData('faqCategoriesList', undefined, (draft) => {
        for (const ch of changed) {
          const row = draft.find((r) => r.id === ch.id);
          if (row) row.display_order = ch.display_order;
        }
      }),
    );
    try {
      await Promise.all(
        changed.map((ch) =>
          updateCategory({ uid: ch.uid, body: { display_order: ch.display_order } }).unwrap(),
        ),
      );
    } catch (err) {
      patch.undo();
      message.error(err?.message || 'Failed to reorder — reverted.');
      refetch();
    }
  };

  const handleReorder = async (items, index, dir) => {
    const target = dir === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];

    // Recompute sequential display_order; PATCH only rows that changed.
    const changed = [];
    next.forEach((item, i) => {
      if ((item.display_order ?? 0) !== i) changed.push({ uid: item.uid, display_order: i });
    });
    if (!changed.length) return;

    const patch = dispatch(
      adminApi.util.updateQueryData('faqsList', undefined, (draft) => {
        for (const ch of changed) {
          const row = draft.find((r) => r.uid === ch.uid);
          if (row) row.display_order = ch.display_order;
        }
      }),
    );
    try {
      await Promise.all(
        changed.map((ch) =>
          reorder({ uid: ch.uid, body: { display_order: ch.display_order } }).unwrap(),
        ),
      );
    } catch (err) {
      patch.undo();
      message.error(err?.message || 'Failed to reorder — reverted.');
      refetch();
    }
  };

  const handleDeleteFaq = async (record) => {
    try {
      await deleteFaq(record.uid).unwrap();
      message.success('FAQ deleted');
    } catch (err) {
      if (err?.status === 404) refetch();
      message.error(err?.message || 'Failed to delete FAQ.');
    }
  };

  const handleDeleteCategory = async (category) => {
    try {
      await deleteCategory(category.uid).unwrap();
      message.success(`Category "${category.name}" deleted`);
    } catch (err) {
      message.error(err?.message || 'Failed to delete category.');
    }
  };

  const faqColumns = (items) => [
    {
      title: 'Question',
      dataIndex: 'question',
      key: 'question',
      ellipsis: true,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: statusTag,
    },
    {
      title: 'Order',
      key: 'order',
      width: 90,
      render: (_v, _r, index) => (
        <Space size={0}>
          <Button
            type="text"
            size="small"
            icon={<ArrowUpOutlined />}
            disabled={!canUpdate || index === 0}
            onClick={() => handleReorder(items, index, 'up')}
          />
          <Button
            type="text"
            size="small"
            icon={<ArrowDownOutlined />}
            disabled={!canUpdate || index === items.length - 1}
            onClick={() => handleReorder(items, index, 'down')}
          />
        </Space>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 110,
      render: (_v, record) => (
        <Space size="small">
          {canUpdate && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditor({ open: true, faq: record })}
            />
          )}
          {canDelete && (
            <Popconfirm
              title="Delete this FAQ?"
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDeleteFaq(record)}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const collapseItems = groups.map((g) => {
    const isUncat = g.category === null;
    const catIndex = isUncat ? -1 : categoryGroups.findIndex((cg) => cg.key === g.key);
    return {
      key: g.key,
      label: (
        <Space>
          <Text strong>{isUncat ? 'Uncategorized' : g.category.name}</Text>
          {!isUncat && g.category.slug && (
            <Text type="secondary" code style={{ fontSize: 12 }}>
              {g.category.slug}
            </Text>
          )}
          <Tag>{g.items.length}</Tag>
          {!isUncat && g.category.status !== 'active' && statusTag(g.category.status)}
        </Space>
      ),
      extra: isUncat ? null : (
        <Space size="small" onClick={(e) => e.stopPropagation()}>
          {canUpdate && (
            <>
              <Button
                size="small"
                type="text"
                icon={<ArrowUpOutlined />}
                disabled={catIndex <= 0}
                onClick={() => handleCategoryReorder(catIndex, 'up')}
                title="Move category up"
              />
              <Button
                size="small"
                type="text"
                icon={<ArrowDownOutlined />}
                disabled={catIndex === categoryGroups.length - 1}
                onClick={() => handleCategoryReorder(catIndex, 'down')}
                title="Move category down"
              />
            </>
          )}
          {canUpdate && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setCatModal({ open: true, category: g.category })}
            />
          )}
          {canDelete && (
            <Popconfirm
              title="Delete this category?"
              description={
                g.items.length
                  ? `Its ${g.items.length} FAQ(s) will move to Uncategorized.`
                  : 'This category has no FAQs.'
              }
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDeleteCategory(g.category)}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
      children: (
        <Table
          size="small"
          rowKey="uid"
          columns={faqColumns(g.items)}
          dataSource={g.items}
          pagination={false}
          locale={{ emptyText: 'No FAQs in this category' }}
        />
      ),
    };
  });

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
          FAQs
        </Title>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
            Reload
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setEditor({ open: true, faq: null })}
            >
              New FAQ
            </Button>
          )}
        </Space>
      </div>

      {error ? (
        <Alert
          type="error"
          showIcon
          message="Failed to load FAQs"
          description="Please reload and try again."
        />
      ) : isLoading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
        </div>
      ) : groups.length === 0 ? (
        <Empty description="No FAQs or categories yet" />
      ) : (
        <Collapse items={collapseItems} defaultActiveKey={groups.map((g) => g.key)} />
      )}

      <FaqEditorDrawer
        open={editor.open}
        faq={editor.faq}
        categories={categories}
        onClose={() => setEditor({ open: false, faq: null })}
        onSaved={refetch}
      />

      <CategoryEditModal
        open={catModal.open}
        category={catModal.category}
        onClose={() => setCatModal({ open: false, category: null })}
        onSave={updateCategory}
      />
    </div>
  );
}

/**
 * Rename / change status / reorder a single FAQ category. Duplicate names (any
 * case) surface as a 409 inline error on the name field.
 */
function CategoryEditModal({ open, category, onClose, onSave }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const initialValues = {
    name: category?.name || '',
    display_order: category?.display_order ?? undefined,
    active: category ? category.status === 'active' : true,
  };

  const handleOk = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const body = {
      name: values.name,
      status: values.active ? 'active' : 'inactive',
    };
    if (values.display_order != null && values.display_order !== '') {
      body.display_order = Number(values.display_order);
    }
    setSaving(true);
    try {
      await onSave({ uid: category.uid, body }).unwrap();
      message.success('Category updated');
      onClose();
    } catch (err) {
      if (err?.status === 409) {
        form.setFields([{ name: 'name', errors: [`A category named "${values.name}" already exists.`] }]);
      } else if (err?.code === 'VALIDATION_ERROR' && err.details?.length) {
        form.setFields(
          err.details.filter((d) => d.field).map((d) => ({ name: d.field, errors: [d.message] })),
        );
      } else {
        message.error(err?.message || 'Failed to update category.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Edit category"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={saving}
      okText="Save"
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={initialValues} preserve={false}>
        <Form.Item
          name="name"
          label="Name"
          rules={[{ required: true, message: 'Name is required.' }]}
        >
          <Input placeholder="Category name" />
        </Form.Item>
        <Form.Item name="display_order" label="Sort order">
          <InputNumber min={0} style={{ width: '100%' }} placeholder="0" />
        </Form.Item>
        <Form.Item name="active" label="Active" valuePropName="checked">
          <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
