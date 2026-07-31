import { useState } from 'react';
import {
  Table,
  Typography,
  Space,
  Input,
  Button,
  Switch,
  Tag,
  Drawer,
  Descriptions,
  App,
} from 'antd';
import { ReloadOutlined, EyeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  useUsersListQuery,
  useUserGetQuery,
  useUserUpdateStatusMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import { humanize } from '../components/formUtils';

const { Title } = Typography;

export default function UsersPage() {
  const perms = usePermissions();
  const { message } = App.useApp();
  const canUpdate = perms.can('users', 'update');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [viewUid, setViewUid] = useState(null);

  const { data, isLoading, isFetching, refetch } = useUsersListQuery({
    search: search || undefined,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const [updateStatus, { isLoading: updating }] = useUserUpdateStatusMutation();

  const rows = data?.items || [];
  const total = data?.total || 0;

  const toggleActive = async (record, checked) => {
    try {
      await updateStatus({ uid: record.uid, is_active: checked ? 1 : 0 }).unwrap();
      message.success(`User ${checked ? 'activated' : 'deactivated'}`);
    } catch {
      /* notification handled globally */
    }
  };

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name', render: (v) => v || '—' },
    { title: 'Email', dataIndex: 'email', key: 'email', render: (v) => v || '—' },
    {
      title: 'Active',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 110,
      render: (value, record) => {
        const checked = value === true || value === 1 || value === '1';
        return canUpdate ? (
          <Switch
            size="small"
            checked={checked}
            loading={updating}
            onChange={(c) => toggleActive(record, c)}
          />
        ) : (
          <Tag color={checked ? 'green' : 'default'}>{checked ? 'Active' : 'Inactive'}</Tag>
        );
      },
    },
    {
      title: 'Joined',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (v) => (v && dayjs(v).isValid() ? dayjs(v).format('YYYY-MM-DD') : '—'),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 90,
      render: (_v, record) => (
        <Button size="small" icon={<EyeOutlined />} onClick={() => setViewUid(record.uid)} />
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
          Users
        </Title>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="Search users"
            style={{ width: 260 }}
            onSearch={(val) => {
              setSearch(val);
              setPage(1);
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
            Reload
          </Button>
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

      <UserDetailDrawer uid={viewUid} onClose={() => setViewUid(null)} />
    </div>
  );
}

function UserDetailDrawer({ uid, onClose }) {
  const { data, isFetching } = useUserGetQuery(uid, { skip: !uid });
  return (
    <Drawer title="User details" open={Boolean(uid)} onClose={onClose} width={520} loading={isFetching}>
      {data && (
        <Descriptions column={1} bordered size="small">
          {Object.entries(data).map(([key, value]) => (
            <Descriptions.Item key={key} label={humanize(key)}>
              {value === null || value === undefined || value === ''
                ? '—'
                : typeof value === 'object'
                  ? JSON.stringify(value)
                  : String(value)}
            </Descriptions.Item>
          ))}
        </Descriptions>
      )}
    </Drawer>
  );
}
