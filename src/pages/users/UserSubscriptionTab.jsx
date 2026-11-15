import { Card, Descriptions, Empty, Progress, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useUserSubscriptionQuery } from '../../features/api/adminApi';
import { formatDate, formatNumber } from '../../lib/ai';
import { sectionState, inr } from '../../lib/users';

const { Text } = Typography;

const SUB_TYPE_LABEL = { regular: 'Regular', trial: 'Trial', access_pass: 'Access pass' };
const PAYMENT_METHOD_LABEL = {
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Net banking',
  wallet: 'Wallet',
  emi: 'EMI',
  other: 'Other',
};

/** One entitlement row: boolean → Yes/No, unlimited → plain count, else a bar. */
function FeatureUsage({ f }) {
  if (f.data_type === 'boolean') {
    return <Tag color={f.enabled ? 'green' : 'default'}>{f.enabled ? 'Yes' : 'No'}</Tag>;
  }
  const unit = f.unit === 'MB' ? ' MB' : '';
  const notEnforced = f.enforced === false;
  if (f.unlimited || notEnforced || f.effective_limit === null || f.effective_limit === undefined) {
    return (
      <Space size={8} wrap>
        <Text>
          {formatNumber(f.used, 0)}
          {unit} used
        </Text>
        <Tag color="blue">Unlimited</Tag>
        {notEnforced && (
          <Tooltip title="An ops switch is relaxing this limit right now">
            <Tag color="orange">not enforced</Tag>
          </Tooltip>
        )}
      </Space>
    );
  }
  const limit = Number(f.effective_limit) || 0;
  const used = Number(f.used) || 0;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  return (
    <div style={{ minWidth: 240 }}>
      <Progress
        percent={pct}
        size="small"
        status={used >= limit ? 'exception' : 'normal'}
        format={() => `${formatNumber(used, 0)} / ${formatNumber(limit, 0)}${unit}`}
      />
      <Space size={8} wrap>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {formatNumber(f.remaining, 0)}
          {unit} remaining
        </Text>
        {Number(f.topup_granted) > 0 && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            +{formatNumber(f.topup_granted, 0)} from top-ups
          </Text>
        )}
      </Space>
    </div>
  );
}

const RESET_LABEL = { monthly: 'Monthly', annual: 'Yearly', never: 'Never' };

export default function UserSubscriptionTab({ uid }) {
  const { data, isLoading, error } = useUserSubscriptionQuery(uid);
  const state = sectionState({ isLoading, error });
  if (state) return state;
  if (!data) return <Empty />;

  const sub = data.subscription;
  const plan = data.plan;
  const billing = data.billing;
  const features = data.features || [];

  const featureColumns = [
    { title: 'Feature', dataIndex: 'label', key: 'label', render: (v, f) => v || f.key },
    {
      title: 'Resets',
      dataIndex: 'reset_period',
      key: 'reset_period',
      render: (v) => RESET_LABEL[v] || v || '—',
    },
    { title: 'Usage', key: 'usage', render: (_v, f) => <FeatureUsage f={f} /> },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        size="small"
        title={
          <Space>
            <span>{plan?.name || 'No plan configured'}</span>
            {data.has_active_subscription ? (
              <Tag color="green">Active</Tag>
            ) : (
              <Tag>Free tier</Tag>
            )}
            {data.is_on_trial && <Tag color="gold">Trial</Tag>}
          </Space>
        }
      >
        {plan?.description && (
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            {plan.description}
          </Text>
        )}
        {sub ? (
          <Descriptions size="small" bordered column={{ xs: 1, md: 2 }}>
            <Descriptions.Item label="Type">{SUB_TYPE_LABEL[sub.sub_type] || sub.sub_type}</Descriptions.Item>
            <Descriptions.Item label="Price">
              {billing ? `${inr(billing.price)} / ${billing.cycle === 'annual' ? 'year' : 'month'}` : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Amount paid">{inr(sub.amount_paid)}</Descriptions.Item>
            <Descriptions.Item label="Started">{formatDate(sub.starts_at)}</Descriptions.Item>
            <Descriptions.Item label={sub.renews_on ? 'Renews on' : 'Expires on'}>
              {formatDate(sub.renews_on || sub.ends_at)}
            </Descriptions.Item>
            <Descriptions.Item label="Auto-renew">
              {sub.auto_renew ? <Tag color="green">On</Tag> : <Tag>Off</Tag>}
              {sub.renewal_cancelled_at && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Renewal cancelled on {formatDate(sub.renewal_cancelled_at)}
                </Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Payment method">
              {sub.payment_method
                ? `${PAYMENT_METHOD_LABEL[sub.payment_method] || sub.payment_method}${
                    sub.payment_method_detail ? ` — ${sub.payment_method_detail}` : ''
                  }`
                : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Gateway">{sub.payment_gateway || '—'}</Descriptions.Item>
          </Descriptions>
        ) : (
          <Text type="secondary">
            No active subscription — the user is on the free tier and gets the limits below.
          </Text>
        )}
      </Card>

      <Card
        size="small"
        title="Usage & entitlements"
        extra={
          data.period ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Period {formatDate(data.period.start)} – {formatDate(data.period.end)} · resets on{' '}
              {formatDate(data.period.end)}
            </Text>
          ) : null
        }
      >
        <Table
          rowKey="key"
          size="small"
          columns={featureColumns}
          dataSource={features}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'No features configured for this plan' }}
        />
      </Card>
    </Space>
  );
}
