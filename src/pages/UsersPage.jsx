import { Table, Typography, Space, Input, Button, Switch, Tag, Select, App } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useUsersListQuery, useUserUpdateStatusMutation } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import { formatDate, formatDateTime } from '../lib/ai';
import { ACCOUNT_TYPE_OPTIONS, ACTIVE_OPTIONS, PLAN_STATE_OPTIONS, isTruthyFlag } from '../lib/users';
import { AccountTypeTag, CurrentPlanCell } from './users/userShared';

const { Title, Text } = Typography;

const DEFAULT_PAGE_SIZE = 20;

/**
 * Users list. Every filter and the page live in the URL query, so a filtered
 * list is linkable and survives the round trip to a user's detail page.
 */
export default function UsersPage() {
  const perms = usePermissions();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const canUpdate = perms.can('users', 'update');
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get('search') || '';
  const accountType = searchParams.get('account_type') || undefined;
  const planState = searchParams.get('plan_state') || undefined;
  const isActive = searchParams.get('is_active') ?? undefined;
  const page = Math.max(parseInt(searchParams.get('page'), 10) || 1, 1);
  const pageSize = parseInt(searchParams.get('size'), 10) || DEFAULT_PAGE_SIZE;

  const { data, isLoading, isFetching, refetch } = useUsersListQuery({
    search: search || undefined,
    account_type: accountType,
    plan_state: planState,
    is_active: isActive,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const [updateStatus, { isLoading: updating, originalArgs }] = useUserUpdateStatusMutation();

  // Old deep links (dashboard widgets, bookmarks) opened a drawer with ?uid=.
  const legacyUid = searchParams.get('uid');
  if (legacyUid) return <Navigate to={`/users/${encodeURIComponent(legacyUid)}`} replace />;

  /** Patch the query string; any filter change goes back to page 1. */
  const setParams = (patch, { keepPage = false } = {}) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === '') next.delete(k);
      else next.set(k, String(v));
    }
    if (!keepPage) next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const filtersActive = Boolean(search || accountType || planState || isActive !== undefined);

  const toggleActive = async (record, checked) => {
    try {
      await updateStatus({ uid: record.uid, is_active: checked ? 1 : 0 }).unwrap();
      message.success(`User ${checked ? 'activated' : 'suspended'}`);
    } catch {
      /* notification handled globally (409 = account already purged) */
    }
  };

  const columns = [
    {
      title: 'User',
      key: 'name',
      render: (_v, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{r.name || r.phone || r.email || '—'}</Text>
          {r.name && r.phone && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {r.phone}
            </Text>
          )}
          {r.email && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {r.email}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Account',
      dataIndex: 'account_type',
      key: 'account_type',
      render: (v) => <AccountTypeTag value={v} />,
    },
    {
      title: 'Plan',
      dataIndex: 'current_plan',
      key: 'current_plan',
      render: (v) => <CurrentPlanCell plan={v} />,
    },
    {
      title: 'Active',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (value, record) => {
        const checked = isTruthyFlag(value);
        if (record.purged_at) return <Tag color="red">Deleted</Tag>;
        return canUpdate ? (
          // The row itself navigates — keep the switch's click to itself.
          <span onClick={(e) => e.stopPropagation()}>
            <Switch
              size="small"
              checked={checked}
              loading={updating && originalArgs?.uid === record.uid}
              onChange={(c) => toggleActive(record, c)}
            />
          </span>
        ) : (
          <Tag color={checked ? 'green' : 'default'}>{checked ? 'Active' : 'Suspended'}</Tag>
        );
      },
    },
    {
      title: 'Last active',
      dataIndex: 'last_active_at',
      key: 'last_active_at',
      render: (v) => formatDateTime(v),
    },
    {
      title: 'Joined',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (v) => formatDate(v),
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
          {filtersActive && (
            <Button onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
              Clear filters
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
            Reload
          </Button>
        </Space>
      </div>

      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          // Keyed on the URL value so "Clear filters" empties the box too.
          key={search}
          allowClear
          defaultValue={search}
          placeholder="Name, phone or email"
          style={{ width: 260 }}
          onSearch={(val) => setParams({ search: val.trim() })}
        />
        <Select
          allowClear
          placeholder="Account type"
          style={{ width: 150 }}
          value={accountType}
          onChange={(v) => setParams({ account_type: v })}
          options={ACCOUNT_TYPE_OPTIONS}
        />
        <Select
          allowClear
          placeholder="Plan"
          style={{ width: 210 }}
          value={planState}
          onChange={(v) => setParams({ plan_state: v })}
          options={PLAN_STATE_OPTIONS}
          optionRender={(o) => (
            <Space direction="vertical" size={0}>
              <span>{o.data.label}</span>
              <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'normal' }}>
                {o.data.title}
              </Text>
            </Space>
          )}
        />
        <Select
          allowClear
          placeholder="Status"
          style={{ width: 130 }}
          value={isActive}
          onChange={(v) => setParams({ is_active: v })}
          options={ACTIVE_OPTIONS}
        />
      </Space>

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={data?.items || []}
        loading={isLoading || isFetching}
        scroll={{ x: 'max-content' }}
        onRow={(record) => ({
          onClick: () => navigate(`/users/${record.uid}`),
          style: { cursor: 'pointer' },
        })}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (t) => `${t} total`,
          onChange: (p, ps) =>
            setParams(
              { page: p > 1 ? p : undefined, size: ps !== DEFAULT_PAGE_SIZE ? ps : undefined },
              { keepPage: true },
            ),
        }}
      />
    </div>
  );
}
