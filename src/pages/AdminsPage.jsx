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
import { useAppSelector } from '../app/hooks';
import { selectIdentity } from '../features/auth/authSlice';
import { isSameAdmin } from '../features/auth/permissions';
import FormFields from '../components/FormFields';
import { humanize } from '../components/formUtils';

const { Title } = Typography;

/** Promise-wrapped Modal.confirm so handlers can `await` the answer. */
function confirmAsync(modal, config) {
  return new Promise((resolve) => {
    modal.confirm({
      ...config,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

/** Success toast that names the session side effect the save just triggered. */
function successCopy({ self, deactivating, resettingPassword, name }) {
  if (self && resettingPassword) {
    return 'Password updated. You’re still signed in here; your other devices have been signed out.';
  }
  if (deactivating) return `${name} updated and signed out of the admin panel.`;
  if (resettingPassword) return `${name} updated. They’ve been signed out of every device.`;
  return 'Admin updated';
}

export default function AdminsPage() {
  const perms = usePermissions();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const identity = useAppSelector(selectIdentity);

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
      // Both destructive server behaviours are spelled out up front: deactivating
      // revokes every session immediately, and setting a password revokes the
      // target's *other* sessions (all of them, unless you are the target).
      const self = isSameAdmin(identity, editing);
      return [
        { name: 'name', label: 'Name', type: 'text', required: true },
        roleField,
        {
          name: 'is_active',
          label: 'Active',
          type: 'switch',
          disabled: self,
          help: self
            ? 'You can’t deactivate your own account — ask another admin.'
            : 'Deactivating signs this admin out of the panel immediately.',
        },
        {
          name: 'password',
          label: 'Password',
          type: 'password',
          help: self
            ? 'Leave blank to keep the current password. Changing it signs out your other devices — you stay signed in here. 8–100 characters.'
            : 'Leave blank to keep the current password. Changing it signs this admin out of every device. 8–100 characters.',
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
  }, [editing, canReadRoles, roleOptions, identity]);

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
    if (editing) {
      const self = isSameAdmin(identity, editing);
      const wasActive = editing.is_active === true || editing.is_active === 1;
      const deactivating = wasActive && !values.is_active;
      const resettingPassword = Boolean(values.password);

      // Confirm the session-ending edits before they land. Editing your own
      // password is deliberately not gated — the API keeps this tab signed in.
      if (!self && (deactivating || resettingPassword)) {
        const lines = [];
        if (deactivating)
          lines.push(`This signs ${editing.name} out of the admin panel immediately.`);
        if (resettingPassword)
          lines.push(`Changing the password also signs ${editing.name} out of every device.`);
        const ok = await confirmAsync(modal, {
          title: deactivating ? `Deactivate ${editing.name}?` : `Reset ${editing.name}’s password?`,
          content: lines.join(' '),
          okText: deactivating ? 'Deactivate' : 'Save',
          okButtonProps: { danger: deactivating },
        });
        if (!ok) return;
      }

      setSubmitting(true);
      try {
        // PATCH accepts name, role_id, is_active, password (all optional).
        // `is_active` is omitted when editing yourself — the field is disabled,
        // so sending it could only ever mean an accidental self-lockout.
        const body = { name: values.name, role_id: values.role_id };
        if (!self) body.is_active = values.is_active ? 1 : 0;
        if (values.password) body.password = values.password;
        await updateAdmin({ uid: editing.uid, body }).unwrap();
        message.success(successCopy({ self, deactivating, resettingPassword, name: editing.name }));
        setEditorOpen(false);
      } catch {
        /* notification handled globally */
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setSubmitting(true);
    try {
      await createAdmin({
        name: values.name,
        email: values.email,
        password: values.password,
        role_id: values.role_id,
      }).unwrap();
      message.success('Admin created');
      setEditorOpen(false);
    } catch {
      /* notification handled globally */
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (record, checked) => {
    if (!checked) {
      // Deactivating revokes every session the admin holds and blacklists their
      // current access token — their next request is a 401, with no self-service
      // way back in. Blocked outright for your own account.
      if (isSameAdmin(identity, record)) {
        modal.warning({
          title: 'You can’t deactivate your own account',
          content:
            'This would sign you out of the admin panel the moment you confirmed it, and only another admin could undo it. Ask another admin to deactivate you.',
          okText: 'Got it',
        });
        return;
      }
      const ok = await confirmAsync(modal, {
        title: `Deactivate ${record.name}?`,
        content: `This signs ${record.name} out of the admin panel immediately, on every device. They stay locked out until an admin reactivates them.`,
        okText: 'Deactivate',
        okButtonProps: { danger: true },
      });
      if (!ok) return;
    }
    try {
      await updateStatus({ uid: record.uid, is_active: checked ? 1 : 0 }).unwrap();
      message.success(
        checked ? `${record.name} activated` : `${record.name} deactivated and signed out`,
      );
    } catch {
      /* notification handled globally */
    }
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (value, record) => (
        <Space size={6}>
          {value}
          {isSameAdmin(identity, record) && <Tag color="blue">You</Tag>}
        </Space>
      ),
    },
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
