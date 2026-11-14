import { Link } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ReloadOutlined,
  CheckCircleTwoTone,
  CloseCircleTwoTone,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { adminApi } from '../../features/api/adminApi';
import { usePermissions } from '../../features/auth/usePermissions';
import {
  CIRCUIT,
  PROVIDER_STATUS_COLORS,
  UNAVAILABLE_REASONS,
  formatAge,
  formatDateTime,
  formatInr,
  formatNumber,
  toNum,
} from '../../lib/ai';

const { Title, Text } = Typography;

const Check = ({ on }) =>
  on ? (
    <CheckCircleTwoTone twoToneColor="#52c41a" />
  ) : (
    <CloseCircleTwoTone twoToneColor="#ff4d4f" />
  );

/** Tolerate a couple of spellings for the booleans the brief names loosely. */
const flag = (row, ...keys) => keys.some((k) => row?.[k] === true || row?.[k] === 1);

function oldestQueuedAge(queue) {
  if (!queue) return null;
  const secs =
    queue.oldest_queued_age_seconds ?? queue.oldest_queued_seconds ?? queue.oldest_queued_age;
  if (toNum(secs) !== null) return formatAge(secs);
  if (queue.oldest_queued_at) {
    return formatAge((Date.now() - new Date(queue.oldest_queued_at).getTime()) / 1000);
  }
  return null;
}

function BalanceCell({ balance, billing, canSeePurchases }) {
  // Postpaid: no prepaid balance exists (always null) — invoices come monthly.
  if (billing === 'postpaid') {
    return (
      <Tooltip title="Postpaid — the provider bills monthly; record each invoice on Credit purchases.">
        <Text type="secondary">Billed monthly</Text>
      </Tooltip>
    );
  }
  if (!balance) {
    return canSeePurchases ? (
      <Link to="/ai/purchases">record a purchase</Link>
    ) : (
      <Text type="secondary">record a purchase</Text>
    );
  }
  const remaining = toNum(balance.remaining_units) ?? 0;
  const bought = toNum(balance.bought_units) ?? 0;
  const pct = bought > 0 ? Math.max(0, Math.min(100, (remaining / bought) * 100)) : 0;
  const low = Boolean(balance.low);
  return (
    <Tooltip
      title={
        <div>
          <div>
            Estimate from our own records (purchases recorded here minus what jobs used) — not
            read from the provider.
          </div>
          <div>
            Bought {formatNumber(bought)} · used {formatNumber(balance.used_units)} · alert below{' '}
            {formatNumber(balance.alert_below_units)}
          </div>
        </div>
      }
    >
      <div style={{ minWidth: 160 }}>
        <Text type={low ? 'danger' : undefined} strong={low}>
          {formatNumber(remaining)} left {low && '— low'}
        </Text>
        <Progress
          percent={pct}
          size="small"
          showInfo={false}
          status={low ? 'exception' : 'normal'}
          strokeColor={low ? '#ff4d4f' : undefined}
        />
      </div>
    </Tooltip>
  );
}

/**
 * AI Health — the landing page of the section. Everything about workers and
 * circuits is THIS server instance's view; other instances may differ.
 */
export default function AiHealthPage() {
  const perms = usePermissions();
  const canSeePurchases = perms.canRead('ai_providers');
  const { data, isLoading, isFetching, refetch } = adminApi.endpoints.aiHealth.useQuery(undefined, {
    pollingInterval: 30000,
  });

  const queue = data?.queue || data?.jobs || data?.worker?.queue || {};
  const failed24h = data?.failed_last_24h ?? data?.failed_24h ?? queue?.failed_last_24h;
  const masterKey = data?.master_key_configured ?? data?.master_key?.configured;
  const providers = data?.providers || [];
  const worker = data?.worker && typeof data.worker === 'object' ? data.worker : null;
  const workerEntries = worker
    ? Object.entries(worker).filter(([, v]) => v === null || typeof v !== 'object')
    : [];

  const columns = [
    {
      title: 'Provider',
      key: 'name',
      render: (_v, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{r.name || r.key}</Text>
          <Text type="secondary" code style={{ fontSize: 12 }}>
            {r.key}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (v) => <Tag color={PROVIDER_STATUS_COLORS[v] || 'default'}>{v || '—'}</Tag>,
    },
    {
      title: 'Available',
      dataIndex: 'unavailable_reason',
      key: 'unavailable_reason',
      render: (v) =>
        v ? (
          <Tooltip title={UNAVAILABLE_REASONS[v] || v}>
            <Tag color="red">{v}</Tag>
          </Tooltip>
        ) : (
          <Tag color="green">OK</Tag>
        ),
    },
    {
      title: 'API key',
      key: 'api_key',
      align: 'center',
      render: (_v, r) => <Check on={flag(r, 'active_api_key', 'has_active_api_key')} />,
    },
    {
      title: 'Webhook secret',
      key: 'webhook_secret',
      align: 'center',
      render: (_v, r) => (
        <Check on={flag(r, 'active_webhook_secret', 'has_active_webhook_secret')} />
      ),
    },
    {
      title: (
        <Tooltip title="This server instance's view of the provider's recent calls.">
          Circuit <InfoCircleOutlined />
        </Tooltip>
      ),
      dataIndex: 'circuit',
      key: 'circuit',
      render: (v) => {
        const c = CIRCUIT[v];
        if (!c) return <Text type="secondary">{v || '—'}</Text>;
        return (
          <Tooltip title={c.hint}>
            <Tag color={c.color}>{c.label}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: 'Cost / unit',
      dataIndex: 'cost_per_unit_inr',
      key: 'cost',
      render: (v, r) =>
        v === null || v === undefined ? (
          <Text type="secondary">—</Text>
        ) : (
          <span>
            {formatInr(v, { digits: 4 })}
            {r.cost_unit && <Text type="secondary"> / {r.cost_unit}</Text>}
          </span>
        ),
    },
    {
      title: 'Billing',
      dataIndex: 'billing',
      key: 'billing',
      render: (v) => (v === 'postpaid' ? <Tag color="purple">postpaid</Tag> : <Tag>{v || 'prepaid'}</Tag>),
    },
    {
      title: (
        <Tooltip title="An ESTIMATE from our own records, not the provider's live balance.">
          Balance <InfoCircleOutlined />
        </Tooltip>
      ),
      dataIndex: 'balance',
      key: 'balance',
      render: (v, r) => (
        <BalanceCell balance={v} billing={r.billing} canSeePurchases={canSeePurchases} />
      ),
    },
  ];

  const attention = providers.filter((p) =>
    ['auth_failed', 'out_of_credits'].includes(p.unavailable_reason),
  );

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
          AI Health
        </Title>
        <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
          Reload
        </Button>
      </div>

      {masterKey === false && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="AI_SECRETS_MASTER_KEY is not set on this server — keys cannot be stored"
          description="Set the environment variable and restart. Until then no API key or webhook secret can be added, and stored ones cannot be decrypted."
        />
      )}

      {attention.map((p) => (
        <Alert
          key={p.uid || p.key}
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            p.unavailable_reason === 'auth_failed'
              ? `${p.name || p.key}: the provider rejected our API key — rotate it.`
              : `${p.name || p.key}: our prepaid balance at the provider is empty — top up.`
          }
          description="This clears by itself about 5 minutes after the fix."
        />
      ))}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" loading={isLoading}>
            <Statistic
              title="Master key"
              value={masterKey === undefined ? '—' : masterKey ? 'Configured' : 'Missing'}
              valueStyle={{ color: masterKey === false ? '#cf1322' : masterKey ? '#389e0d' : undefined }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" loading={isLoading}>
            <Statistic
              title="Failed in the last 24 h"
              value={toNum(failed24h) ?? '—'}
              valueStyle={{ color: toNum(failed24h) > 0 ? '#cf1322' : undefined }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" loading={isLoading} title="Queue">
            <Space size="large" wrap>
              <Statistic title="Queued" value={toNum(queue.queued) ?? 0} />
              <Statistic title="Sending" value={toNum(queue.sending) ?? 0} />
              <Statistic title="Processing" value={toNum(queue.processing) ?? 0} />
              <Statistic
                title="Unknown"
                value={toNum(queue.unknown) ?? 0}
                valueStyle={{ color: toNum(queue.unknown) > 0 ? '#d46b08' : undefined }}
              />
              <Statistic title="Oldest queued" value={oldestQueuedAge(queue) || '—'} />
            </Space>
          </Card>
        </Col>
      </Row>

      <Card size="small" title="Providers" style={{ marginBottom: 16 }}>
        <Table
          rowKey={(r) => r.uid || r.key}
          size="middle"
          columns={columns}
          dataSource={providers}
          loading={isLoading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'No providers configured.' }}
        />
      </Card>

      {worker && (
        <Card
          size="small"
          title={
            <Space>
              Worker
              <Tag>this instance</Tag>
            </Space>
          }
          extra={<Text type="secondary">Other server instances may see something different.</Text>}
        >
          <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
            {workerEntries.map(([k, v]) => (
              <Descriptions.Item key={k} label={k.replace(/_/g, ' ')}>
                {typeof v === 'boolean'
                  ? v
                    ? 'yes'
                    : 'no'
                  : /_at$/.test(k)
                    ? formatDateTime(v)
                    : String(v ?? '—')}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
      )}
    </div>
  );
}
