import { useEffect, useMemo, useState } from 'react';
import {
  Table,
  Typography,
  Space,
  Input,
  Button,
  Tag,
  Drawer,
  Form,
  InputNumber,
  Switch,
  App,
} from 'antd';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ExclamationCircleFilled,
} from '@ant-design/icons';
import { adminApi } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import ImageThumb from '../components/ImageThumb';
import ThemeEditorDrawer from '../components/ThemeEditorDrawer';

const { Title, Text } = Typography;

const isTrue = (v) => v === true || v === 1 || v === '1';
const activeTag = (v) => <Tag color={isTrue(v) ? 'green' : 'default'}>{isTrue(v) ? 'Yes' : 'No'}</Tag>;

/**
 * Two-level theme management: a Theme Groups table whose rows expand to the
 * themes in that group (filtered client-side by group_id, since the themes list
 * is flat/unfiltered). Group delete CASCADES to its themes — the confirm warns
 * hard and names the count.
 */
export default function ThemeGroupsPage() {
  const perms = usePermissions();
  const { message, modal } = App.useApp();

  const canCreate = perms.can('themes', 'create');
  const canUpdate = perms.can('themes', 'update');
  const canDelete = perms.can('themes', 'delete');

  const [search, setSearch] = useState('');
  const [groupEditor, setGroupEditor] = useState({ open: false, record: null });
  const [themeEditor, setThemeEditor] = useState({ open: false, theme: null, groupId: null });

  const groupsQuery = adminApi.endpoints.themeGroupsList.useQuery();
  const themesQuery = adminApi.endpoints.themesList.useQuery();
  const [removeGroup] = adminApi.endpoints.themeGroupsRemove.useMutation();
  const [removeTheme] = adminApi.endpoints.themesRemove.useMutation();

  const groups = useMemo(() => groupsQuery.data || [], [groupsQuery.data]);
  const themes = useMemo(() => themesQuery.data || [], [themesQuery.data]);

  const themesByGroup = useMemo(() => {
    const map = new Map();
    for (const t of themes) {
      if (!map.has(t.group_id)) map.set(t.group_id, []);
      map.get(t.group_id).push(t);
    }
    return map;
  }, [themes]);

  const rows = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups.filter((g) => g.name?.toLowerCase().includes(q));
  }, [groups, search]);

  const reloadAll = () => {
    groupsQuery.refetch();
    themesQuery.refetch();
  };

  const deleteGroup = async (group) => {
    try {
      await removeGroup(group.uid).unwrap();
      message.success('Theme group deleted');
    } catch {
      // error notification handled by baseQuery
    }
  };

  const onDeleteGroup = (group) => {
    const count = (themesByGroup.get(group.id) || []).length;
    if (count > 0) {
      modal.confirm({
        title: `Delete group "${group.name}"?`,
        icon: <ExclamationCircleFilled style={{ color: '#ff4d4f' }} />,
        width: 460,
        content: (
          <div>
            <p style={{ marginTop: 0 }}>
              This group contains <strong>{count}</strong> theme{count > 1 ? 's' : ''}. Deleting the
              group will <strong>permanently delete all of them</strong> (cascade). This cannot be
              undone.
            </p>
          </div>
        ),
        okText: `Delete group + ${count} theme${count > 1 ? 's' : ''}`,
        okButtonProps: { danger: true },
        onOk: () => deleteGroup(group),
      });
    } else {
      modal.confirm({
        title: `Delete group "${group.name}"?`,
        content: 'This group has no themes.',
        okText: 'Delete',
        okButtonProps: { danger: true },
        onOk: () => deleteGroup(group),
      });
    }
  };

  const onDeleteTheme = (theme) => {
    modal.confirm({
      title: `Delete theme "${theme.name}"?`,
      content: 'Its template associations are removed; the templates themselves are untouched.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeTheme(theme.uid).unwrap();
          message.success('Theme deleted');
        } catch {
          // error notification handled by baseQuery
        }
      },
    });
  };

  const groupColumns = [
    { title: 'Group', dataIndex: 'name', key: 'name', render: (v) => <Text strong>{v}</Text> },
    {
      title: 'Slug',
      dataIndex: 'slug',
      key: 'slug',
      width: 160,
      render: (v) => (v ? <Text code>{v}</Text> : <Text type="secondary">—</Text>),
    },
    {
      title: 'Themes',
      key: 'themeCount',
      width: 90,
      render: (_v, g) => (themesByGroup.get(g.id) || []).length,
    },
    {
      title: 'Order',
      dataIndex: 'display_order',
      key: 'display_order',
      width: 80,
      render: (v) => v ?? 0,
    },
    { title: 'Active', dataIndex: 'is_active', key: 'is_active', width: 80, render: activeTag },
    {
      title: 'Actions',
      key: 'actions',
      width: 110,
      fixed: 'right',
      render: (_v, group) => (
        <Space size="small">
          {canUpdate && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setGroupEditor({ open: true, record: group })}
              title="Edit group"
            />
          )}
          {canDelete && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onDeleteGroup(group)}
              title="Delete group"
            />
          )}
        </Space>
      ),
    },
  ];

  const renderThemesPanel = (group) => {
    const groupThemes = themesByGroup.get(group.id) || [];
    return (
      <div style={{ padding: '4px 8px 8px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <Text type="secondary">Themes in {group.name}</Text>
          {canCreate && (
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setThemeEditor({ open: true, theme: null, groupId: group.id })}
            >
              New Theme
            </Button>
          )}
        </div>
        <Table
          rowKey="uid"
          size="small"
          pagination={false}
          dataSource={groupThemes}
          locale={{ emptyText: 'No themes in this group' }}
          columns={[
            {
              title: 'Thumbnail',
              dataIndex: 'thumbnail_s3_key',
              key: 'thumb',
              width: 90,
              render: (k) => <ImageThumb k={k} />,
            },
            { title: 'Name', dataIndex: 'name', key: 'name' },
            {
              title: 'Order',
              dataIndex: 'display_order',
              key: 'order',
              width: 80,
              render: (v) => v ?? 0,
            },
            { title: 'Active', dataIndex: 'is_active', key: 'active', width: 80, render: activeTag },
            {
              title: 'Actions',
              key: 'actions',
              width: 110,
              render: (_v, theme) => (
                <Space size="small">
                  {canUpdate && (
                    <Button
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => setThemeEditor({ open: true, theme, groupId: group.id })}
                      title="Edit theme"
                    />
                  )}
                  {canDelete && (
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => onDeleteTheme(theme)}
                      title="Delete theme"
                    />
                  )}
                </Space>
              ),
            },
          ]}
        />
      </div>
    );
  };

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
          Theme Groups
        </Title>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="Search groups"
            style={{ width: 240 }}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={setSearch}
          />
          <Button icon={<ReloadOutlined />} onClick={reloadAll} loading={themesQuery.isFetching}>
            Reload
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setGroupEditor({ open: true, record: null })}
            >
              New Group
            </Button>
          )}
        </Space>
      </div>

      <Table
        rowKey="uid"
        columns={groupColumns}
        dataSource={rows}
        loading={groupsQuery.isLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        size="middle"
        expandable={{ expandedRowRender: renderThemesPanel }}
      />

      <ThemeGroupEditor
        open={groupEditor.open}
        record={groupEditor.record}
        onClose={() => setGroupEditor({ open: false, record: null })}
        onSaved={reloadAll}
      />

      <ThemeEditorDrawer
        open={themeEditor.open}
        theme={themeEditor.theme}
        defaultGroupId={themeEditor.groupId}
        onClose={() => setThemeEditor({ open: false, theme: null, groupId: null })}
        onSaved={reloadAll}
      />
    </div>
  );
}

// ---- group editor (name / order / active) ----------------------------------

function ThemeGroupEditor({ open, record, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const isEdit = Boolean(record);

  const [createTrigger] = adminApi.endpoints.themeGroupsCreate.useMutation();
  const [updateTrigger] = adminApi.endpoints.themeGroupsUpdate.useMutation();

  useEffect(() => {
    if (!open) return;
    if (record) {
      form.setFieldsValue({
        name: record.name,
        display_order: record.display_order ?? 0,
        is_active: isTrue(record.is_active),
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ is_active: true, display_order: 0 });
    }
  }, [open, record, form]);

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const body = {
      name: values.name.trim(),
      display_order: values.display_order ?? 0,
      is_active: values.is_active ? 1 : 0,
    };
    setSubmitting(true);
    try {
      if (isEdit) {
        await updateTrigger({ id: record.uid, body }).unwrap();
        message.success('Theme group updated');
      } else {
        await createTrigger(body).unwrap();
        message.success('Theme group created');
      }
      onSaved?.();
      onClose();
    } catch {
      // error notification handled by baseQuery
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      title={isEdit ? `Edit "${record?.name}"` : 'New Theme Group'}
      open={open}
      onClose={onClose}
      width={480}
      destroyOnClose
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="primary" loading={submitting} onClick={handleSubmit}>
              Save
            </Button>
          </Space>
        </div>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Name is required' }]}>
          <Input placeholder="Group name" />
        </Form.Item>
        <Form.Item name="display_order" label="Display order">
          <InputNumber style={{ width: '100%' }} min={0} />
        </Form.Item>
        <Form.Item name="is_active" label="Active" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
