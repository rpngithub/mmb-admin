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
  Tabs,
  App,
} from 'antd';
import { ReloadOutlined, EyeOutlined, BellOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  useUsersListQuery,
  useUserGetQuery,
  useUserUpdateStatusMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import { humanize } from '../components/formUtils';
import UserQuotaGrantsPanel from '../components/UserQuotaGrantsPanel';

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

/**
 * User detail: the raw record, plus the support view of the user's top-up quota.
 *
 * The grants tab is gated on `quota_packs.update` — the permission the list
 * endpoint itself requires — so an admin who would only get a 403 never sees a
 * tab that can't load. It is deliberately NOT a content permission: pricing and
 * the quota it buys are commerce, so a content_admin doesn't hold it.
 */
function UserDetailDrawer({ uid, onClose }) {
  const perms = usePermissions();
  const { data, isFetching } = useUserGetQuery(uid, { skip: !uid });
  const canSeeGrants = perms.can('quota_packs', 'update');
  // "They say they never got it" starts here. The delivery log filters by the
  // numeric user_id, which only the detail record carries.
  const canSeeNotifications = perms.canRead('notifications') && data?.id != null;

  const details = (
    <Descriptions column={1} bordered size="small">
      {Object.entries(data || {}).map(([key, value]) => (
        <Descriptions.Item key={key} label={humanize(key)}>
          {value === null || value === undefined || value === ''
            ? '—'
            : typeof value === 'object'
              ? JSON.stringify(value)
              : String(value)}
        </Descriptions.Item>
      ))}
    </Descriptions>
  );

  const items = [{ key: 'details', label: 'Details', children: data ? details : null }];
  if (canSeeGrants) {
    items.push({
      key: 'grants',
      label: 'Quota grants',
      // Rendered on first activation, so opening the drawer doesn't fetch grants
      // for every user an admin merely glances at.
      children: uid ? (
        <UserQuotaGrantsPanel userUid={uid} userLabel={data?.name || data?.email || uid} />
      ) : null,
    });
  }

  return (
    <Drawer
      title="User details"
      open={Boolean(uid)}
      onClose={onClose}
      width={canSeeGrants ? 900 : 520}
      destroyOnClose
      loading={isFetching}
      extra={
        canSeeNotifications ? (
          <Link to={`/notification-log?user_id=${data.id}`}>
            <Button icon={<BellOutlined />}>Notifications sent</Button>
          </Link>
        ) : null
      }
    >
      <Tabs items={items} />
    </Drawer>
  );
}
