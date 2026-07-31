import { useMemo, useState } from 'react';
import {
  Table,
  Typography,
  Space,
  Input,
  Button,
  Switch,
  Tag,
  Form,
  Drawer,
  Descriptions,
  App,
} from 'antd';
import { ReloadOutlined, PlusOutlined, EditOutlined, EyeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  useAdminsListQuery,
  useAdminGetQuery,
  useAdminCreateMutation,
  useAdminUpdateMutation,
  useAdminUpdateStatusMutation,
  adminApi,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import FormFields from '../components/FormFields';
import { humanize } from '../components/formUtils';

const { Title } = Typography;

export default function AdminsPage() {
  const perms = usePermissions();
  const { message } = App.useApp();
  const [form] = Form.useForm();

  const canCreate = perms.can('admins', 'create');
  const canUpdate = perms.can('admins', 'update');
  const canReadRoles = perms.canRead('roles');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [viewUid, setViewUid] = useState(null);

  const { data, isLoading, isFetching, refetch } = useAdminsListQuery({
    search: search || undefined,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const [createAdmin] = useAdminCreateMutation();
  const [updateAdmin] = useAdminUpdateMutation();
  const [updateStatus, { isLoading: togglingStatus }] = useAdminUpdateStatusMutation();

  // Roles for the role select. role_id is the integer `id` (NOT the uid).
  const { data: roles } = adminApi.endpoints.rolesList.useQuery(undefined, { skip: !canReadRoles });
  const roleOptions = useMemo(
    () => (roles || []).map((r) => ({ label: r.name, value: r.id })),
    [roles],
  );

  const rows = data?.items || [];
  const total = data?.total || 0;

  const fields = useMemo(() => {
    const roleField = canReadRoles
      ? { name: 'role_id', label: 'Role', type: 'select', options: roleOptions, required: true }
      : {
          name: 'role_id',
          label: 'Role ID',
          type: 'number',
          required: true,
          help: 'Integer role id from GET /admin/roles.',
        };
    if (editing) {
      return [
        { name: 'name', label: 'Name', type: 'text', required: true },
        roleField,
        { name: 'is_active', label: 'Active', type: 'switch' },
        {
          name: 'password',
          label: 'Password',
          type: 'password',
          help: 'Leave blank to keep the current password. 8–100 characters.',
          rules: [{ min: 8, max: 100, message: '8–100 characters' }],
        },
      ];
    }
    return [
      { name: 'name', label: 'Name', type: 'text', required: true, rules: [{ max: 100 }] },
      {
        name: 'email',
        label: 'Email',
        type: 'text',
        required: true,
        rules: [{ type: 'email', message: 'Enter a valid email' }],
      },
      {
        name: 'password',
        label: 'Password',
        type: 'password',
        required: true,
        rules: [{ min: 8, max: 100, message: '8–100 characters' }],
      },
      roleField,
    ];
  }, [editing, canReadRoles, roleOptions]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setEditorOpen(true);
  };

  const openEdit = (record) => {
    setEditing(record);
    form.resetFields();
    form.setFieldsValue({
      name: record.name,
      role_id: record.role_id,
      is_active: record.is_active === true || record.is_active === 1,
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
    setSubmitting(true);
    try {
      if (editing) {
        // PATCH accepts name, role_id, is_active, password (all optional).
        const body = {
          name: values.name,
          role_id: values.role_id,
          is_active: values.is_active ? 1 : 0,
        };
        if (values.password) body.password = values.password;
        await updateAdmin({ uid: editing.uid, body }).unwrap();
        message.success('Admin updated');
      } else {
        await createAdmin({
          name: values.name,
          email: values.email,
          password: values.password,
          role_id: values.role_id,
        }).unwrap();
        message.success('Admin created');
      }
      setEditorOpen(false);
    } catch {
      /* notification handled globally */
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (record, checked) => {
    try {
      await updateStatus({ uid: record.uid, is_active: checked ? 1 : 0 }).unwrap();
      message.success(`Admin ${checked ? 'activated' : 'deactivated'}`);
    } catch {
      /* notification handled globally */
    }
  };

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    {
      title: 'Role',
      key: 'role',
      render: (_v, r) => r.Role?.name || r.role_id || '—',
    },
    {
      title: 'Active',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 90,
      render: (value, record) => {
        const checked = value === true || value === 1;
        return canUpdate ? (
          <Switch
            size="small"
            checked={checked}
            loading={togglingStatus}
            onChange={(c) => toggleActive(record, c)}
          />
        ) : (
          <Tag color={checked ? 'green' : 'default'}>{checked ? 'Active' : 'Inactive'}</Tag>
        );
      },
    },
    {
      title: 'Last login',
      dataIndex: 'last_login_at',
      key: 'last_login_at',
      render: (v) => (v && dayjs(v).isValid() ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—'),
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (v) => (v && dayjs(v).isValid() ? dayjs(v).format('YYYY-MM-DD') : '—'),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 110,
      render: (_v, record) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => setViewUid(record.uid)} />
          {canUpdate && (
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          )}
        </Space>
      ),
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
          Admins
        </Title>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="Search name or email"
            style={{ width: 240 }}
            onSearch={(val) => {
              setSearch(val);
              setPage(1);
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
            Reload
          </Button>
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              New Admin
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
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `${t} total`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />

      <Drawer
        title={editing ? 'Edit Admin' : 'New Admin'}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        width={520}
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
          <FormFields fields={fields} />
        </Form>
      </Drawer>

      <AdminDetailDrawer uid={viewUid} onClose={() => setViewUid(null)} />
    </div>
  );
}

function AdminDetailDrawer({ uid, onClose }) {
  const { data, isFetching } = useAdminGetQuery(uid, { skip: !uid });
  return (
    <Drawer
      title="Admin details"
      open={Boolean(uid)}
      onClose={onClose}
      width={520}
      loading={isFetching}
    >
      {data && (
        <Descriptions column={1} bordered size="small">
          {Object.entries(data).map(([key, value]) => {
            if (key === 'Role') {
              return (
                <Descriptions.Item key={key} label="Role">
                  {value?.name || '—'}
                  {value?.is_system ? (
                    <Tag color="blue" style={{ marginLeft: 8 }}>
                      System
                    </Tag>
                  ) : null}
                </Descriptions.Item>
              );
            }
            return (
              <Descriptions.Item key={key} label={humanize(key)}>
                {renderValue(value)}
              </Descriptions.Item>
            );
          })}
        </Descriptions>
      )}
    </Drawer>
  );
}

function renderValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') {
    // e.g. the nested Role association
    return (
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return String(value);
}
