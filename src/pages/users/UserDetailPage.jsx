import { useMemo } from 'react';
import {
  App,
  Avatar,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Popconfirm,
  Row,
  Space,
  Statistic,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  BellOutlined,
  CheckCircleFilled,
  ReloadOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  useUserDetailQuery,
  useUserSubscriptionQuery,
  useUserUpdateStatusMutation,
} from '../../features/api/adminApi';
import { usePermissions } from '../../features/auth/usePermissions';
import { formatDate, formatDateTime, formatNumber } from '../../lib/ai';
import { imageUrl, useCdnBaseUrl } from '../../lib/cdn';
import { humanize } from '../../components/formUtils';
import UserQuotaGrantsPanel from '../../components/UserQuotaGrantsPanel';
import { isTruthyFlag, sectionState, userDisplayName } from '../../lib/users';
import { AccountTypeTag } from './userShared';
import UserSubscriptionTab from './UserSubscriptionTab';
import UserSubscriptionHistoryTab from './UserSubscriptionHistoryTab';
import UserPaymentsTab from './UserPaymentsTab';
import UserBusinessesTab from './UserBusinessesTab';
import UserProjectsTab from './UserProjectsTab';
import UserActivityTab from './UserActivityTab';

const { Title, Text } = Typography;

// Fields the Overview lays out itself; everything else the API sends lands in
// "Technical details" so nothing new is ever hidden.
const SHOWN_FIELDS = new Set([
  'name',
  'phone',
  'email',
  'email_verified_at',
  'account_type',
  'onboarding_completed_at',
  'is_active',
  'last_login_at',
  'last_active_at',
  'created_at',
  'has_active_subscription',
  'counts',
  'billing_details',
  'profile_photo_s3_key',
]);

const COUNT_TILES = [
  { key: 'projects', label: 'Designs' },
  { key: 'downloads', label: 'Downloads' },
  { key: 'shares', label: 'Shares' },
  { key: 'ai_jobs', label: 'AI generations' },
  { key: 'businesses', label: 'Businesses' },
  { key: 'active_sessions', label: 'Signed-in devices' },
];

function initials(user) {
  const src = (user?.name || '').trim();
  if (!src) return null;
  return src
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

function rawValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return <Text code>{JSON.stringify(value)}</Text>;
  return String(value);
}

function AccountStatusTags({ user }) {
  if (user.purged_at) {
    return (
      <Tooltip title={`Data permanently deleted on ${formatDate(user.purged_at)} — cannot be reactivated`}>
        <Tag color="red">Deleted</Tag>
      </Tooltip>
    );
  }
  return (
    <>
      {isTruthyFlag(user.is_active) ? <Tag color="green">Active</Tag> : <Tag color="default">Suspended</Tag>}
      {user.deactivated_at && (
        <Tooltip title={`The user deactivated their account on ${formatDate(user.deactivated_at)}`}>
          <Tag color="orange">Deletion pending</Tag>
        </Tooltip>
      )}
    </>
  );
}

function PlanTag({ user, subscription }) {
  if (subscription?.plan && subscription.has_active_subscription) {
    return (
      <Tag color="purple">
        {subscription.plan.name}
        {subscription.is_on_trial ? ' · Trial' : ''}
      </Tag>
    );
  }
  return user.has_active_subscription ? <Tag color="purple">Paid</Tag> : <Tag>Free</Tag>;
}

function StatusControl({ user }) {
  const { message } = App.useApp();
  const [updateStatus, { isLoading }] = useUserUpdateStatusMutation();
  const active = isTruthyFlag(user.is_active);

  const setActive = async (next) => {
    try {
      await updateStatus({ uid: user.uid, is_active: next ? 1 : 0 }).unwrap();
      message.success(next ? 'User activated' : 'User suspended');
    } catch {
      /* toasted globally — 409 means the account was purged */
    }
  };

  const toggle = <Switch checked={active} loading={isLoading} checkedChildren="Active" unCheckedChildren="Suspended" />;

  // Suspending signs the user out everywhere at once, so it asks first;
  // re-activating has nothing to undo and doesn't.
  return active ? (
    <Popconfirm
      title="Suspend this user?"
      description="They are signed out on every device right away. Nothing is deleted."
      okText="Suspend"
      okButtonProps={{ danger: true }}
      onConfirm={() => setActive(false)}
    >
      {toggle}
    </Popconfirm>
  ) : (
    <span onClick={() => setActive(true)}>{toggle}</span>
  );
}

function OverviewTab({ user }) {
  const technical = Object.entries(user).filter(([k]) => !SHOWN_FIELDS.has(k));
  const hasBillingKey = Object.prototype.hasOwnProperty.call(user, 'billing_details');
  const billing = user.billing_details;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="User information">
        <Descriptions size="small" bordered column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label="Name">{user.name || '—'}</Descriptions.Item>
          <Descriptions.Item label="Phone">{user.phone || '—'}</Descriptions.Item>
          <Descriptions.Item label="Email">
            {user.email ? (
              <Space size={4}>
                {user.email}
                {user.email_verified_at ? (
                  <Tooltip title={`Verified ${formatDateTime(user.email_verified_at)}`}>
                    <Tag color="green">verified</Tag>
                  </Tooltip>
                ) : (
                  <Tag>unverified</Tag>
                )}
              </Space>
            ) : (
              '—'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Account">
            <AccountTypeTag value={user.account_type} />
          </Descriptions.Item>
          <Descriptions.Item label="Joined">{formatDateTime(user.created_at)}</Descriptions.Item>
          <Descriptions.Item label="Onboarding">
            {user.onboarding_completed_at ? (
              <Text type="success">
                <CheckCircleFilled /> Completed {formatDate(user.onboarding_completed_at)}
              </Text>
            ) : (
              <Tag color="gold">Not completed</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Last login">{formatDateTime(user.last_login_at)}</Descriptions.Item>
          <Descriptions.Item label="Last active">{formatDateTime(user.last_active_at)}</Descriptions.Item>
        </Descriptions>
      </Card>

      {hasBillingKey && (
        <Card size="small" title="Billing details">
          {billing ? (
            <Descriptions size="small" bordered column={{ xs: 1, md: 2 }}>
              <Descriptions.Item label="Billing name">{billing.billing_name || '—'}</Descriptions.Item>
              <Descriptions.Item label="GSTIN">
                {billing.gstin ? <Text copyable>{billing.gstin}</Text> : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Address" span={2}>
                {[billing.billing_address, billing.billing_state, billing.billing_pincode]
                  .filter(Boolean)
                  .join(', ') || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Last updated">{formatDateTime(billing.updated_at)}</Descriptions.Item>
            </Descriptions>
          ) : (
            <Text type="secondary">Not provided</Text>
          )}
        </Card>
      )}

      <Collapse
        size="small"
        items={[
          {
            key: 'tech',
            label: 'Technical details',
            children: (
              <Descriptions size="small" bordered column={1}>
                {technical.map(([k, v]) => (
                  <Descriptions.Item key={k} label={humanize(k)}>
                    {k.endsWith('_at') && v ? formatDateTime(v) : rawValue(v)}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            ),
          },
        ]}
      />
    </Space>
  );
}

export default function UserDetailPage() {
  const { uid } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const perms = usePermissions();
  const cdnBase = useCdnBaseUrl();
  const [searchParams, setSearchParams] = useSearchParams();

  const canBilling = perms.can('billing', 'read');
  const canActivity = perms.can('activity', 'read');
  const canGrants = perms.can('quota_packs', 'update');
  const canUpdate = perms.can('users', 'update');
  const canAiJobs = perms.can('ai_jobs', 'read');
  const canNotifications = perms.canRead('notifications');

  const { data: user, isLoading, isFetching, error, refetch } = useUserDetailQuery(uid);
  // Only for the plan name in the header; the Subscription tab shares the cache.
  const { data: subscription } = useUserSubscriptionQuery(uid, { skip: !canBilling || !user });

  const tabs = useMemo(() => {
    if (!user) return [];
    const items = [{ key: 'overview', label: 'Overview', children: <OverviewTab user={user} /> }];
    if (canBilling) {
      items.push(
        { key: 'subscription', label: 'Subscription & usage', children: <UserSubscriptionTab uid={uid} /> },
        { key: 'history', label: 'Subscription history', children: <UserSubscriptionHistoryTab uid={uid} /> },
        { key: 'payments', label: 'Payments', children: <UserPaymentsTab uid={uid} /> },
      );
    }
    items.push(
      {
        key: 'businesses',
        label: 'Businesses',
        children: <UserBusinessesTab uid={uid} accountType={user.account_type} />,
      },
      { key: 'designs', label: 'Designs', children: <UserProjectsTab uid={uid} /> },
    );
    if (canActivity) {
      items.push({ key: 'activity', label: 'Activity', children: <UserActivityTab uid={uid} /> });
    }
    if (canGrants) {
      items.push({
        key: 'grants',
        label: 'Quota grants',
        children: <UserQuotaGrantsPanel userUid={uid} userLabel={userDisplayName(user)} />,
      });
    }
    return items;
  }, [user, uid, canBilling, canActivity, canGrants]);

  const goBack = () => {
    // Back keeps the list's filters (they live in its URL); a direct visit has
    // no history entry to go back to.
    if (location.key !== 'default') navigate(-1);
    else navigate('/users');
  };

  const backButton = (
    <Button type="text" icon={<ArrowLeftOutlined />} onClick={goBack}>
      Users
    </Button>
  );

  const state = sectionState({ isLoading, error });
  if (state) {
    return (
      <div>
        {backButton}
        {state}
      </div>
    );
  }
  if (!user) return backButton;

  const requestedTab = searchParams.get('tab');
  const activeTab = tabs.some((t) => t.key === requestedTab) ? requestedTab : 'overview';
  const setTab = (key) => {
    const next = new URLSearchParams(searchParams);
    if (key === 'overview') next.delete('tab');
    else next.set('tab', key);
    setSearchParams(next, { replace: true });
  };

  const photo = imageUrl(cdnBase, user.profile_photo_s3_key);
  const counts = user.counts || {};

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        {backButton}
        <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
          Reload
        </Button>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Avatar size={64} src={photo} style={{ flexShrink: 0, background: photo ? undefined : '#f6d78b', color: '#7a5200' }}>
            {initials(user) || '?'}
          </Avatar>
          <div style={{ flex: 1, minWidth: 220 }}>
            <Title level={4} style={{ margin: 0 }}>
              {userDisplayName(user)}
            </Title>
            <Space size={12} wrap style={{ marginTop: 2 }}>
              {user.name && user.phone && <Text type="secondary">{user.phone}</Text>}
              {user.email && (
                <Text type="secondary">
                  {user.email}{' '}
                  {user.email_verified_at && (
                    <Tooltip title="Email verified">
                      <CheckCircleFilled style={{ color: '#52c41a' }} />
                    </Tooltip>
                  )}
                </Text>
              )}
            </Space>
            <Space size={[4, 4]} wrap style={{ marginTop: 8 }}>
              <AccountStatusTags user={user} />
              <AccountTypeTag value={user.account_type} />
              <PlanTag user={user} subscription={subscription} />
            </Space>
          </div>
          <Space wrap>
            {canUpdate && !user.purged_at && <StatusControl user={user} />}
            {canNotifications && user.id != null && (
              <Link to={`/notification-log?user_id=${user.id}`}>
                <Button icon={<BellOutlined />}>Notifications sent</Button>
              </Link>
            )}
            {canAiJobs && (
              <Link to={`/ai/jobs?user_uid=${encodeURIComponent(user.uid)}`}>
                <Button icon={<RobotOutlined />}>
                  View AI jobs ({formatNumber(counts.ai_jobs ?? 0, 0)})
                </Button>
              </Link>
            )}
          </Space>
        </div>

        <Row gutter={[12, 12]} style={{ marginTop: 20 }}>
          {COUNT_TILES.map((t) => (
            <Col key={t.key} xs={12} sm={8} lg={4}>
              <Card size="small" style={{ background: 'rgba(0,0,0,0.02)' }}>
                <Statistic title={t.label} value={counts[t.key] ?? 0} />
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      <Card>
        <Tabs activeKey={activeTab} onChange={setTab} items={tabs} />
      </Card>
    </div>
  );
}
