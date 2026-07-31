import { useMemo, useState } from 'react';
import {
  Table,
  Typography,
  Space,
  Input,
  Button,
  Tag,
  Form,
  Drawer,
  Descriptions,
  Popconfirm,
  App,
} from 'antd';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { adminApi, useRoleDeleteMutation } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import { normalizePermissions } from '../features/auth/permissions';
import PermissionEditor from '../components/PermissionEditor';

const { Title, Text } = Typography;

export default function RolesPage() {
  const perms = usePermissions();
  const { message } = App.useApp();
  const [form] = Form.useForm();

  const canCreate = perms.can('roles', 'create');
  const canUpdate = perms.can('roles', 'update');
  const canDelete = perms.can('roles', 'delete');

  const [search, setSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [viewRole, setViewRole] = useState(null);

  const { data, isLoading, isFetching, refetch } = adminApi.endpoints.rolesList.useQuery();
  const [createRole] = adminApi.endpoints.rolesCreate.useMutation();
  const [updateRole] = adminApi.endpoints.rolesUpdate.useMutation();
  const [deleteRole] = useRoleDeleteMutation();

  const rows = useMemo(() => {
    const all = data || [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (r) =>
        r.name?.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q),
    );
  }, [data, search]);

  const isSystem = (r) => r.is_system === 1 || r.is_system === true;

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ name: '', description: '', permissions: [] });
    setEditorOpen(true);
  };

  const openEdit = (record) => {
    setEditing(record);
    form.resetFields();
    form.setFieldsValue({
      name: record.name,
      description: record.description || '',
      permissions: normalizePermissions(record.permissions),
    });
    setEditorOpen(true);
  };

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const body = {
      name: values.name,
      description: values.description ?? '',
      permissions: values.permissions || [],
    };
    setSubmitting(true);
    try {
      if (editing) {
        await updateRole({ id: editing.uid, body }).unwrap();
        message.success('Role updated');
      } else {
        await createRole(body).unwrap();
        message.success('Role created');
      }
      setEditorOpen(false);
    } catch {
      // 409 (duplicate name) etc. surface via the global notification; keep open
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (record) => {
    try {
      await deleteRole(record.uid).unwrap();
      message.success('Role deleted');
    } catch (err) {
      // roleDelete is silent — map the backend FK-RESTRICT 500 to a clear message.
      if (err?.status === 500) {
        message.error('This role is assigned to one or more admins and cannot be deleted.');
      } else {
        message.error(err?.message || 'Failed to delete role.');
      }
    }
  };

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (v) => v || '—',
    },
    {
      title: 'Type',
      dataIndex: 'is_system',
      key: 'is_system',
      width: 100,
      render: (_v, r) =>
        isSystem(r) ? <Tag color="blue">System</Tag> : <Tag>Custom</Tag>,
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 120,
      render: (v) => (v && dayjs(v).isValid() ? dayjs(v).format('YYYY-MM-DD') : '—'),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 130,
      fixed: 'right',
      render: (_v, record) => {
        const system = isSystem(record);
        return (
          <Space size="small">
            <Button size="small" icon={<EyeOutlined />} onClick={() => setViewRole(record)} />
            {canUpdate && !system && (
              <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
            )}
            {canDelete && !system && (
              <Popconfirm
                title="Delete this role?"
                description="This cannot be undone."
                okText="Delete"
                okButtonProps={{ danger: true }}
                onConfirm={() => handleDelete(record)}
              >
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

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
          Roles
        </Title>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="Search roles"
            style={{ width: 240 }}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={setSearch}
          />
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
            Reload
          </Button>
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              New Role
            </Button>
          )}
        </Space>
      </div>

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `${t} total` }}
      />

      <Drawer
        title={editing ? `Edit Role — ${editing.name}` : 'New Role'}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        width={640}
        destroyOnClose
        footer={
          <div style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setEditorOpen(false)}>Cancel</Button>
              <Button type="primary" loading={submitting} onClick={handleSubmit}>
                Save
              </Button>
            </Space>
          </div>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="Name"
            rules={[
              { required: true, message: 'Name is required' },
              { max: 100, message: 'Max 100 characters' },
            ]}
          >
            <Input placeholder="e.g. content_editor" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} placeholder="What is this role for?" />
          </Form.Item>
          <Form.Item name="permissions" label="Permissions">
            <PermissionEditor />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        title={viewRole ? `Role — ${viewRole.name}` : 'Role'}
        open={Boolean(viewRole)}
        onClose={() => setViewRole(null)}
        width={520}
      >
        {viewRole && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Name">{viewRole.name}</Descriptions.Item>
            <Descriptions.Item label="Type">
              {isSystem(viewRole) ? <Tag color="blue">System</Tag> : <Tag>Custom</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Description">
              {viewRole.description || '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Permissions">
              {(() => {
                const list = normalizePermissions(viewRole.permissions);
                if (list.length === 0) return <Text type="secondary">No permissions</Text>;
                if (list.includes('*')) return <Tag color="gold">Superuser (*)</Tag>;
                return list.map((p) => (
                  <Tag key={p} style={{ marginBottom: 4 }}>
                    {p}
                  </Tag>
                ));
              })()}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
}
