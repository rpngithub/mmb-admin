import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { Alert, Button, Card, DatePicker, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { InfoCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { adminApi } from '../../features/api/adminApi';
import { usePermissions } from '../../features/auth/usePermissions';
import { formatInr, formatNumber, formatPct, toNum } from '../../lib/ai';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const BELOW_TARGET_BG = { background: 'rgba(255, 77, 79, 0.08)' };
const isTrue = (v) => v === true || v === 1;

const warningText = (w) =>
  typeof w === 'string' ? w : w?.message || w?.detail || w?.code || JSON.stringify(w);

function MarginCell({ value, below }) {
  if (toNum(value) === null) return <Text type="secondary">—</Text>;
  return (
    <Text type={below ? 'danger' : undefined} strong={below}>
      {formatPct(value)}
    </Text>
  );
}

/**
 * Margin report: what AI jobs earned vs what they cost us (actuals), and what
 * each route would earn at today's / stressed cost (projection).
 */
export default function AiMarginPage() {
  const perms = usePermissions();
  const [range, setRange] = useState(() => [dayjs().subtract(30, 'day'), dayjs()]);

  const queryArg = useMemo(
    () => ({
      from: range?.[0]?.format('YYYY-MM-DD'),
      to: range?.[1]?.format('YYYY-MM-DD'),
    }),
    [range],
  );
  const { data, isLoading, isFetching, refetch } =
    adminApi.endpoints.aiMarginReport.useQuery(queryArg);

  const warnings = data?.warnings || [];
  const settings = data?.settings || {};
  const actuals = data?.actuals || [];
  const projection = data?.projection || [];

  const rowKey = (r) => `${r.operation_key}|${r.provider_key}|${r.model}`;

  const actualColumns = [
    { title: 'Operation', dataIndex: 'operation_key', key: 'op', render: (v) => <Text code>{v}</Text> },
    { title: 'Provider', dataIndex: 'provider_key', key: 'provider' },
    { title: 'Model', dataIndex: 'model', key: 'model', render: (v) => v || '—' },
    { title: 'Done', dataIndex: 'jobs_done', key: 'done', align: 'right' },
    { title: 'Failed', dataIndex: 'jobs_failed', key: 'failed', align: 'right' },
    {
      title: 'Credits sold',
      dataIndex: 'credits_sold',
      key: 'credits',
      align: 'right',
      render: (v) => formatNumber(v),
    },
    {
      title: 'Revenue',
      dataIndex: 'revenue_inr',
      key: 'revenue',
      align: 'right',
      render: (v) => formatInr(v, { digits: 2 }),
    },
    {
      title: 'Cost',
      dataIndex: 'cost_inr',
      key: 'cost',
      align: 'right',
      render: (v) => formatInr(v, { digits: 2 }),
    },
    {
      title: (
        <Tooltip title="Failed jobs that reached the provider — we may have been billed.">
          At risk <InfoCircleOutlined />
        </Tooltip>
      ),
      dataIndex: 'at_risk_inr',
      key: 'at_risk',
      align: 'right',
      render: (v) => (toNum(v) > 0 ? <Text type="warning">{formatInr(v, { digits: 2 })}</Text> : formatInr(v, { digits: 2 })),
    },
    {
      title: 'Margin',
      dataIndex: 'margin_pct',
      key: 'margin',
      align: 'right',
      render: (v, r) => <MarginCell value={v} below={isTrue(r.below_target)} />,
    },
  ];

  const projectionColumns = [
    { title: 'Operation', dataIndex: 'operation_key', key: 'op', render: (v) => <Text code>{v}</Text> },
    {
      title: 'Provider',
      dataIndex: 'provider_key',
      key: 'provider',
      render: (v, r) => (
        <Space size={4}>
          {v}
          {isTrue(r.postpaid) && <Tag color="purple">postpaid</Tag>}
        </Space>
      ),
    },
    { title: 'Model', dataIndex: 'model', key: 'model', render: (v) => v || '—' },
    {
      title: 'Credits / unit',
      dataIndex: 'credits_per_unit',
      key: 'cpu',
      align: 'right',
      render: (v) => formatNumber(v, 4),
    },
    {
      title: 'Price',
      dataIndex: 'price_inr',
      key: 'price',
      align: 'right',
      render: (v) => formatInr(v),
    },
    {
      title: 'Cost today',
      dataIndex: 'cost_today_inr',
      key: 'cost_today',
      align: 'right',
      render: (v, r) =>
        isTrue(r.cost_unknown) ? (
          <Tag color="orange">{isTrue(r.postpaid) ? 'no rate set' : 'no purchase recorded'}</Tag>
        ) : (
          formatInr(v)
        ),
    },
    {
      title: (
        <Tooltip title="Today's cost plus the FX buffer.">
          Cost stressed <InfoCircleOutlined />
        </Tooltip>
      ),
      dataIndex: 'cost_stressed_inr',
      key: 'cost_stressed',
      align: 'right',
      render: (v, r) => (isTrue(r.cost_unknown) ? '—' : formatInr(v)),
    },
    {
      title: 'Margin (stressed)',
      dataIndex: 'margin_pct_stressed',
      key: 'margin',
      align: 'right',
      render: (v, r) => <MarginCell value={v} below={isTrue(r.below_target)} />,
    },
  ];

  const rowStyle = (r) => ({ style: isTrue(r.below_target) ? BELOW_TARGET_BG : undefined });

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
          AI Margin Report
        </Title>
        <Space wrap>
          <RangePicker
            value={range}
            allowClear={false}
            onChange={(v) => setRange(v)}
            presets={[
              { label: 'Last 7 days', value: [dayjs().subtract(7, 'day'), dayjs()] },
              { label: 'Last 30 days', value: [dayjs().subtract(30, 'day'), dayjs()] },
              { label: 'Last 90 days', value: [dayjs().subtract(90, 'day'), dayjs()] },
              { label: 'This month', value: [dayjs().startOf('month'), dayjs()] },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
            Reload
          </Button>
        </Space>
      </div>

      {warnings.map((w, i) => (
        <Alert key={i} type="warning" showIcon style={{ marginBottom: 12 }} message={warningText(w)} />
      ))}

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap size="large">
          <Text>
            Credit value: <Text strong>{formatInr(settings.credit_value_inr ?? settings.ai_credit_value_inr)}</Text>
          </Text>
          <Text>
            Target margin:{' '}
            <Text strong>{formatPct(settings.target_margin_pct ?? settings.ai_target_margin_pct)}</Text>
          </Text>
          <Text>
            FX buffer: <Text strong>{formatPct(settings.fx_buffer_pct ?? settings.ai_fx_buffer_pct)}</Text>
          </Text>
          {perms.canRead('settings') && (
            <Link to="/r/appSettings?q=ai">Edit in App Settings (group ai) →</Link>
          )}
        </Space>
      </Card>

      <Title level={5}>Actuals</Title>
      <Table
        rowKey={rowKey}
        size="middle"
        columns={actualColumns}
        dataSource={actuals}
        loading={isLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        onRow={rowStyle}
        locale={{ emptyText: 'No jobs in this period.' }}
        style={{ marginBottom: 24 }}
      />

      <Title level={5}>Projection</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
        What each route would earn at today’s cost per unit, and at a stressed cost.
      </Text>
      <Table
        rowKey={rowKey}
        size="middle"
        columns={projectionColumns}
        dataSource={projection}
        loading={isLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        onRow={rowStyle}
        locale={{ emptyText: 'No routes to project.' }}
      />
    </div>
  );
}
