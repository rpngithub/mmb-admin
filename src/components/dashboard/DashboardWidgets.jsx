import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Alert,
  Badge,
  Col,
  Descriptions,
  Divider,
  Empty,
  List,
  Progress,
  Rate,
  Row,
  Segmented,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { usePermissions } from '../../features/auth/usePermissions';
import { FAMILY_REQUIREMENTS } from '../../lib/templateFamilies';
import {
  PLATFORM_COLORS,
  PURCHASE_TYPE_COLORS,
  SERIES_COLORS,
  fmtDate,
  fmtDateTime,
  fmtINR,
  fmtINRCompact,
  fmtNum,
  fmtPct,
  humanize,
  pick,
  toNum,
  windowKey,
} from '../../lib/dashboard';
import { Donut, HBars, Legend, TrendChart } from './DashboardCharts';

/**
 * One renderer per widget key, each receiving `{ data, params, setParam }` from
 * WidgetCard. Payload shapes follow the dashboard spec; where the spec leaves a
 * nesting open (bare number vs `{ count }`, `plan` vs `plan_name`) the renderer
 * tolerates both rather than guessing one.
 */

const { Text, Title } = Typography;

const RED = '#cf1322';
const GREEN = '#389e0d';

// ---- Shared bits --------------------------------------------------------

/** change_pct vs the previous equal-length period. null → "—". */
export function ChangeBadge({ pct, style }) {
  const n = toNum(pct);
  if (n === null) return <Text type="secondary" style={{ fontSize: 12, ...style }}>—</Text>;
  const up = n > 0;
  const down = n < 0;
  return (
    <Text
      style={{ fontSize: 12, color: up ? GREEN : down ? RED : 'rgba(0,0,0,0.45)', ...style }}
      title="vs the previous period of equal length"
    >
      {up && <ArrowUpOutlined />}
      {down && <ArrowDownOutlined />} {fmtPct(Math.abs(n))}
    </Text>
  );
}

function Tile({ title, value, sub, change, valueStyle }) {
  return (
    <div
      style={{
        border: '1px solid rgba(5,5,5,0.06)',
        borderRadius: 8,
        padding: '10px 12px',
        height: '100%',
      }}
    >
      <Statistic
        title={title}
        value={value}
        valueStyle={{ fontSize: 22, ...valueStyle }}
        formatter={(v) => v}
      />
      {(sub || change !== undefined) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          {sub && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {sub}
            </Text>
          )}
          {change !== undefined && <ChangeBadge pct={change} style={{ marginLeft: 'auto' }} />}
        </div>
      )}
    </div>
  );
}

const asArray = (v) => (Array.isArray(v) ? v : []);
const nameOf = (v) => (v && typeof v === 'object' ? v.name ?? v.title ?? null : v ?? null);

/** Link to a user's detail drawer when this admin can read users. */
function UserLink({ user, fallback }) {
  const perms = usePermissions();
  const name = user?.name || fallback || 'Unnamed';
  if (!user?.uid || !perms.canRead('users')) return <span>{name}</span>;
  return <Link to={`/users?uid=${encodeURIComponent(user.uid)}`}>{name}</Link>;
}

/** Flat `{ key: number }` map rendered as small labelled numbers. */
function NumberMap({ value, format = fmtNum }) {
  if (!value || typeof value !== 'object') return null;
  const entries = Object.entries(value).filter(([, v]) => typeof v !== 'object' || v === null);
  if (!entries.length) return null;
  return (
    <Row gutter={[12, 12]}>
      {entries.map(([k, v]) => (
        <Col key={k} xs={12} sm={8} md={6}>
          <Statistic title={humanize(k)} value={format(v)} formatter={(x) => x} valueStyle={{ fontSize: 18 }} />
        </Col>
      ))}
    </Row>
  );
}

const SMALL_TABLE = { size: 'small', pagination: false, scroll: { x: 'max-content' } };

// ---- Money --------------------------------------------------------------

const REVENUE_WINDOWS = ['today', 'last_7d', 'last_30d', 'mtd'];

function RevenueSummary({ data }) {
  const windows = asArray(data.windows);
  const ordered = [
    ...REVENUE_WINDOWS.map((k) => windows.find((w) => windowKey(w) === k)).filter(Boolean),
    ...windows.filter((w) => !REVENUE_WINDOWS.includes(windowKey(w))),
  ];
  if (!ordered.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <Row gutter={[12, 12]}>
      {ordered.map((w) => (
        <Col key={windowKey(w)} xs={12} lg={6}>
          <Tile
            title={humanize(windowKey(w))}
            value={fmtINR(w.gross)}
            sub={`Net ${fmtINR(w.net)} · ${fmtNum(w.count)} payments`}
            change={w.change_pct}
          />
        </Col>
      ))}
    </Row>
  );
}

const PURCHASE_TYPES = [
  { key: 'subscription', label: 'Subscription' },
  { key: 'frame', label: 'Frame' },
  { key: 'quota_pack', label: 'Top-up pack' },
  { key: 'variant', label: 'Brand Series variants' },
];
const purchaseTypeLabel = (v) =>
  v ? PURCHASE_TYPES.find((t) => t.key === v)?.label || humanize(v) : '—';

function RevenueTrend({ data, params }) {
  const [mode, setMode] = useState('column');
  const [byType, setByType] = useState(false);
  const points = asArray(data.points);
  const totals = data.totals || {};

  const series = useMemo(
    () =>
      byType
        ? PURCHASE_TYPES.map((t) => ({
            key: t.key,
            label: t.label,
            color: PURCHASE_TYPE_COLORS[t.key],
            value: (p) => pick(p.by_type?.[t.key], 'gross'),
          }))
        : [{ key: 'gross', label: 'Gross', color: SERIES_COLORS[0], value: (p) => p.gross }],
    [byType],
  );

  return (
    <div>
      <Space wrap size={[24, 8]} style={{ marginBottom: 12 }}>
        <Statistic title="Gross (incl. GST)" value={fmtINR(totals.gross)} formatter={(v) => v} valueStyle={{ fontSize: 20 }} />
        <Statistic title="Net (before GST)" value={fmtINR(totals.net)} formatter={(v) => v} valueStyle={{ fontSize: 20 }} />
        {totals.count !== undefined && (
          <Statistic title="Payments" value={fmtNum(totals.count)} formatter={(v) => v} valueStyle={{ fontSize: 20 }} />
        )}
        {totals.change_pct !== undefined && (
          <div>
            <Text type="secondary" style={{ fontSize: 14 }}>Change</Text>
            <div><ChangeBadge pct={totals.change_pct} style={{ fontSize: 16 }} /></div>
          </div>
        )}
      </Space>
      <Space wrap size={12} style={{ marginBottom: 8, width: '100%', justifyContent: 'space-between' }}>
        <Segmented
          size="small"
          value={mode}
          onChange={setMode}
          options={[
            { label: 'Columns', value: 'column' },
            { label: 'Line', value: 'line' },
          ]}
        />
        <Space size={6}>
          <Switch size="small" checked={byType} onChange={setByType} />
          <Text style={{ fontSize: 12 }}>By purchase type</Text>
        </Space>
      </Space>
      <Legend items={series} />
      <TrendChart
        points={points}
        series={series}
        mode={mode}
        granularity={params.granularity}
        formatValue={fmtINR}
        formatAxis={fmtINRCompact}
      />
    </div>
  );
}

const PAYMENT_STATUS_COLORS = { success: 'green', failed: 'red', pending: 'gold', refunded: 'blue' };

function PaymentHealth({ data }) {
  const counts = data.counts || {};
  const rate = toNum(data.success_rate_pct);
  const reasons = asArray(data.top_failure_reasons);
  const failures = asArray(data.recent_failures);
  return (
    <div>
      <Row gutter={[16, 16]} align="middle">
        <Col flex="none">
          <Progress
            type="circle"
            size={96}
            percent={rate ?? 0}
            format={() => fmtPct(rate)}
            strokeColor={rate === null ? undefined : rate >= 90 ? GREEN : rate >= 75 ? '#d48806' : RED}
          />
          <div style={{ textAlign: 'center', marginTop: 4 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Success rate</Text>
          </div>
        </Col>
        <Col flex="auto">
          <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
            {['success', 'failed', 'pending', 'refunded'].map((k) => (
              <Tag key={k} color={PAYMENT_STATUS_COLORS[k]}>
                {humanize(k)}: {fmtNum(counts[k])}
              </Tag>
            ))}
          </Space>
          <div>
            <Statistic
              title="Abandoned checkouts (stale pending)"
              value={fmtNum(pick(data.stale_pending))}
              formatter={(v) => v}
              valueStyle={{ fontSize: 18 }}
            />
          </div>
        </Col>
        <Col xs={24} md={10}>
          <Text strong style={{ fontSize: 13 }}>Top failure reasons</Text>
          {reasons.length ? (
            <div style={{ marginTop: 8 }}>
              <HBars
                labelWidth={140}
                color={SERIES_COLORS[1]}
                rows={reasons.map((r, i) => ({
                  key: `${r.reason ?? i}`,
                  label: r.reason || 'Unknown',
                  value: r.count,
                }))}
              />
            </div>
          ) : (
            <div><Text type="secondary">No failures in this range</Text></div>
          )}
        </Col>
      </Row>
      <Divider style={{ margin: '12px 0' }} />
      <Text strong style={{ fontSize: 13 }}>Recent failures</Text>
      <Table
        {...SMALL_TABLE}
        style={{ marginTop: 8 }}
        rowKey={(r, i) => r.uid ?? r.id ?? i}
        dataSource={failures}
        locale={{ emptyText: 'No recent failures' }}
        columns={[
          { title: 'Amount', dataIndex: 'amount', render: fmtINR, align: 'right' },
          { title: 'Type', dataIndex: 'purchase_type', render: purchaseTypeLabel },
          { title: 'Reason', dataIndex: 'reason', ellipsis: true, render: (v) => v || '—' },
          { title: 'User', dataIndex: 'user', render: (u) => <UserLink user={u} /> },
          { title: 'When', dataIndex: 'created_at', render: fmtDateTime },
        ]}
      />
    </div>
  );
}

function SubscribersByPlan({ data }) {
  const plans = asArray(data.plans);
  const multi = toNum(data.integrity?.users_with_multiple_active_subscriptions) ?? 0;
  return (
    <div>
      {multi > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`${fmtNum(multi)} user${multi === 1 ? '' : 's'} hold${multi === 1 ? 's' : ''} more than one active subscription — report to engineering`}
        />
      )}
      <Donut
        centerLabel="Subscriptions"
        items={plans.map((p, i) => ({ key: p.uid ?? p.id ?? `${p.name}-${i}`, label: p.name || 'Unnamed plan', value: p.total }))}
      />
      <Divider style={{ margin: '12px 0' }} />
      <Row gutter={12}>
        <Col span={12}>
          <Statistic title="Users subscribed" value={fmtNum(data.users_subscribed)} formatter={(v) => v} valueStyle={{ fontSize: 18 }} />
        </Col>
        <Col span={12}>
          <Statistic
            title="Users without a subscription"
            value={fmtNum(data.users_without_subscription)}
            formatter={(v) => v}
            valueStyle={{ fontSize: 18 }}
          />
        </Col>
      </Row>
    </div>
  );
}

const OUTCOME_COLORS = { renews: 'green', cancelling: 'orange', expires: 'default' };

function RenewalsDue({ data }) {
  const counts = data.counts || data;
  const subs = asArray(data.subscriptions);
  return (
    <div>
      <Space wrap size={[24, 8]} style={{ marginBottom: 12 }}>
        <Statistic title="Renewing" value={fmtNum(counts.renews)} formatter={(v) => v} valueStyle={{ fontSize: 20, color: GREEN }} />
        <Statistic title="Cancelling" value={fmtNum(counts.cancelling)} formatter={(v) => v} valueStyle={{ fontSize: 20, color: '#d46b08' }} />
        <Statistic title="Expiring" value={fmtNum(counts.expires)} formatter={(v) => v} valueStyle={{ fontSize: 20 }} />
      </Space>
      <Table
        {...SMALL_TABLE}
        rowKey={(r, i) => r.uid ?? r.id ?? i}
        dataSource={subs}
        pagination={subs.length > 10 ? { pageSize: 10, size: 'small' } : false}
        locale={{ emptyText: 'Nothing due in this window' }}
        columns={[
          {
            title: 'User',
            dataIndex: 'user',
            render: (u) => (
              <div>
                <UserLink user={u} />
                {u?.phone && (
                  <div><Text type="secondary" style={{ fontSize: 12 }}>{u.phone}</Text></div>
                )}
              </div>
            ),
          },
          { title: 'Plan', key: 'plan', render: (_v, r) => nameOf(r.plan) || r.plan_name || '—' },
          { title: 'Ends', dataIndex: 'ends_at', render: fmtDate },
          {
            title: 'Outcome',
            dataIndex: 'outcome',
            render: (v) => (v ? <Tag color={OUTCOME_COLORS[v] || 'default'}>{humanize(v)}</Tag> : '—'),
          },
        ]}
      />
    </div>
  );
}

// ---- Growth -------------------------------------------------------------

function UserSummary({ data }) {
  const users = data.users || {};
  const active = data.active_users || {};
  const signups = asArray(data.signups);
  return (
    <div>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><Tile title="Total users" value={fmtNum(users.total)} /></Col>
        <Col xs={12} md={6}><Tile title="Active accounts" value={fmtNum(users.active)} /></Col>
        <Col xs={12} md={6}>
          <Tile
            title="Active users"
            value={fmtNum(active.last_24h)}
            sub={`24h · ${fmtNum(active.last_7d)} 7d · ${fmtNum(active.last_30d)} 30d`}
          />
        </Col>
        <Col xs={12} md={6}>
          <Tile
            title="Pending deletion"
            value={fmtNum(users.pending_deletion)}
            valueStyle={toNum(users.pending_deletion) > 0 ? { color: '#d46b08' } : undefined}
          />
        </Col>
      </Row>
      {signups.length > 0 && (
        <>
          <Divider orientation="left" plain style={{ margin: '12px 0' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Signups</Text>
          </Divider>
          <Row gutter={[12, 12]}>
            {signups.map((w) => (
              <Col key={windowKey(w)} xs={24} sm={8}>
                <Tile title={humanize(windowKey(w))} value={fmtNum(w.count)} change={w.change_pct} />
              </Col>
            ))}
          </Row>
        </>
      )}
    </div>
  );
}

const PLATFORM_ORDER = ['android', 'ios', 'web', 'playground', 'unknown'];
const PLATFORM_LABELS = { android: 'Android', ios: 'iOS', web: 'Web', playground: 'Playground', unknown: 'Unknown' };

function SignupsByPlatform({ data }) {
  const rows = asArray(data.platforms)
    .map((p) => ({ key: p.platform ?? p.key ?? p.name ?? 'unknown', value: p.count ?? p.total }))
    .sort((a, b) => PLATFORM_ORDER.indexOf(a.key) - PLATFORM_ORDER.indexOf(b.key));
  return (
    <Donut
      centerLabel="Signups"
      items={rows.map((r) => ({
        key: r.key,
        label: PLATFORM_LABELS[r.key] || humanize(r.key),
        value: r.value,
        color: PLATFORM_COLORS[r.key],
      }))}
    />
  );
}

function SignupFunnel({ data }) {
  const stages = asArray(data.stages);
  if (!stages.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stages.map((s, i) => {
        const pct = toNum(s.pct_of_signups);
        return (
          <div key={s.key ?? i}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13 }}>
              <Text>{s.label || humanize(s.key)}</Text>
              <Text strong style={{ marginLeft: 'auto' }}>{fmtNum(s.count)}</Text>
              <Text type="secondary" style={{ width: 52, textAlign: 'right' }}>{fmtPct(pct)}</Text>
            </div>
            <div style={{ height: 14, background: 'rgba(0,0,0,0.04)', borderRadius: 4, marginTop: 4 }}>
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, pct ?? 0))}%`,
                  minWidth: toNum(s.count) > 0 ? 2 : 0,
                  height: '100%',
                  background: SERIES_COLORS[0],
                  borderRadius: 4,
                }}
              />
            </div>
            {i > 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {fmtPct(s.pct_of_previous)} of the previous step
              </Text>
            )}
          </div>
        );
      })}
    </div>
  );
}

const SERIES_FIELD_PREFERENCE = ['total', 'count', 'exports'];

function ExportSummary({ data, params }) {
  const points = asArray(data.points);
  const byType = data.by_type || {};
  const field = useMemo(() => {
    const first = points[0] || {};
    return (
      SERIES_FIELD_PREFERENCE.find((f) => typeof first[f] === 'number') ||
      Object.keys(first).find((k) => k !== 'date' && typeof first[k] === 'number') ||
      'count'
    );
  }, [points]);
  const shares = data.shares_by_platform;
  const shareRows = Array.isArray(shares)
    ? shares.map((s, i) => ({ key: s.platform ?? s.key ?? i, label: humanize(s.platform ?? s.key ?? s.name), value: s.count ?? s.total }))
    : Object.entries(shares || {}).map(([k, v]) => ({ key: k, label: humanize(k), value: pick(v) }));

  return (
    <div>
      <NumberMap value={data.totals} />
      <Row gutter={[16, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} md={10}>
          <Text strong style={{ fontSize: 13 }}>By type</Text>
          <div style={{ marginTop: 8 }}>
            <HBars
              rows={Object.entries(byType).map(([k, v]) => ({ key: k, label: humanize(k), value: pick(v) }))}
            />
          </div>
          {shareRows.length > 0 && (
            <>
              <Text strong style={{ fontSize: 13, display: 'block', marginTop: 12 }}>Shares by platform</Text>
              <div style={{ marginTop: 8 }}>
                <HBars rows={shareRows} color={SERIES_COLORS[2]} />
              </div>
            </>
          )}
        </Col>
        <Col xs={24} md={14}>
          <TrendChart
            height={180}
            points={points}
            granularity={params.granularity}
            series={[{ key: field, label: humanize(field), color: SERIES_COLORS[0], value: (p) => p[field] }]}
          />
        </Col>
      </Row>
      <Text type="secondary" style={{ fontSize: 11 }}>
        Exports are reported by the app after they succeed, so failures are not counted yet.
      </Text>
    </div>
  );
}

// ---- Content ------------------------------------------------------------

function CoverageTable({ title, block }) {
  const items = asArray(block?.items);
  return (
    <div>
      <Space wrap size={[12, 4]} style={{ marginBottom: 8 }}>
        <Text strong>{title}</Text>
        <Tag>Total {fmtNum(block?.total)}</Tag>
        <Tag color={toNum(block?.below_min) > 0 ? 'orange' : 'default'}>
          Below min {fmtNum(block?.below_min)}
        </Tag>
        <Tag color={toNum(block?.with_none) > 0 ? 'red' : 'default'}>
          With none {fmtNum(block?.with_none)}
        </Tag>
      </Space>
      <Table
        {...SMALL_TABLE}
        rowKey={(r, i) => r.uid ?? r.id ?? i}
        dataSource={items}
        pagination={items.length > 8 ? { pageSize: 8, size: 'small' } : false}
        locale={{ emptyText: 'Everything meets the minimum' }}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Parent', dataIndex: 'parent_name', render: (v) => v || '—' },
          {
            title: 'Active templates',
            dataIndex: 'active_templates',
            align: 'right',
            render: (v) => (
              <Text style={toNum(v) === 0 ? { color: RED, fontWeight: 600 } : undefined}>{fmtNum(v)}</Text>
            ),
          },
        ]}
      />
    </div>
  );
}

function CatalogCoverage({ data }) {
  return (
    <Row gutter={[24, 16]}>
      <Col xs={24} lg={12}>
        <CoverageTable title="Industries" block={data.industries} />
      </Col>
      <Col xs={24} lg={12}>
        <CoverageTable title="Template categories" block={data.template_categories} />
      </Col>
    </Row>
  );
}

function EventsWithoutTemplates({ data }) {
  const navigate = useNavigate();
  const perms = usePermissions();
  const canOpen = perms.canRead('events');
  const events = asArray(data.events);
  return (
    <Table
      {...SMALL_TABLE}
      rowKey={(r, i) => r.uid ?? i}
      dataSource={events}
      pagination={events.length > 10 ? { pageSize: 10, size: 'small' } : false}
      locale={{ emptyText: 'Every upcoming event has templates' }}
      onRow={(r) =>
        canOpen && r.uid
          ? {
              onClick: () => navigate(`/r/specialEvents?uid=${encodeURIComponent(r.uid)}&tab=templates`),
              style: { cursor: 'pointer' },
            }
          : {}
      }
      columns={[
        { title: 'Event', dataIndex: 'name' },
        { title: 'Type', dataIndex: 'type', render: (v) => (v ? humanize(v) : '—') },
        { title: 'On', dataIndex: 'occurs_on', render: fmtDate },
        {
          title: 'In',
          dataIndex: 'days_until',
          render: (v) => {
            const n = toNum(v);
            if (n === null) return '—';
            const label = n === 0 ? 'Today' : `${n} day${n === 1 ? '' : 's'}`;
            return <Tag color={n <= 7 ? 'red' : n <= 14 ? 'orange' : 'default'}>{label}</Tag>;
          },
        },
        { title: 'Active templates', dataIndex: 'active_templates', align: 'right', render: fmtNum },
      ]}
    />
  );
}

function PendingIndustries({ data }) {
  const perms = usePermissions();
  const canOpen = perms.canRead('categories');
  const items = asArray(data.items);
  const to = '/r/businessCategories?tab=suggestions';
  return (
    <div>
      <Space style={{ marginBottom: 8 }}>
        <Badge count={toNum(data.count) ?? items.length} showZero overflowCount={999} color={toNum(data.count) > 0 ? '#d46b08' : '#bfbfbf'} />
        <Text type="secondary">awaiting moderation</Text>
        {canOpen && <Link to={to}>Open queue</Link>}
      </Space>
      <List
        size="small"
        dataSource={items}
        locale={{ emptyText: 'No suggestions waiting' }}
        renderItem={(it) => (
          <List.Item
            style={{ cursor: canOpen ? 'pointer' : undefined, paddingInline: 0 }}
            extra={<Text type="secondary" style={{ fontSize: 12 }}>{dayjs(it.created_at).isValid() ? dayjs(it.created_at).format('D MMM') : ''}</Text>}
          >
            <List.Item.Meta
              title={canOpen ? <Link to={to}>{it.name}</Link> : it.name}
              description={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {[
                    (it.parent_name ?? nameOf(it.parent)) && `under ${it.parent_name ?? nameOf(it.parent)}`,
                    nameOf(it.suggested_by) && `by ${nameOf(it.suggested_by)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </Text>
              }
            />
          </List.Item>
        )}
      />
    </div>
  );
}

/** rating_distribution may be `[{ rating, count }]` or `{ "1": n, ... }`. */
function distributionRows(dist) {
  const map = new Map();
  if (Array.isArray(dist)) {
    for (const d of dist) map.set(Number(d.rating ?? d.stars ?? d.key), toNum(d.count) ?? 0);
  } else if (dist && typeof dist === 'object') {
    for (const [k, v] of Object.entries(dist)) map.set(Number(k), toNum(pick(v)) ?? 0);
  }
  return [5, 4, 3, 2, 1].map((r) => ({ key: String(r), label: `${r} ★`, value: map.get(r) ?? 0 }));
}

function RecentFeedback({ data }) {
  const perms = usePermissions();
  const avg = toNum(data.average_rating);
  return (
    <div>
      <Row gutter={[16, 12]} align="middle">
        <Col flex="none">
          <Title level={2} style={{ margin: 0 }}>{avg === null ? '—' : avg.toFixed(1)}</Title>
          <Rate disabled allowHalf value={avg ?? 0} style={{ fontSize: 14 }} />
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {fmtNum(data.count)} response{toNum(data.count) === 1 ? '' : 's'}
            </Text>
          </div>
        </Col>
        <Col flex="auto">
          <HBars labelWidth={36} rows={distributionRows(data.rating_distribution)} />
        </Col>
      </Row>
      <Divider style={{ margin: '12px 0' }} />
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Text>
          Low ratings: <Text strong style={toNum(pick(data.low_ratings)) > 0 ? { color: RED } : undefined}>{fmtNum(pick(data.low_ratings))}</Text>
        </Text>
        {perms.can('feedback', 'read') && <Link to="/feedback">Open feedback</Link>}
      </Space>
    </div>
  );
}

const REQUIREMENT_LABELS = Object.fromEntries(FAMILY_REQUIREMENTS.map((r) => [r.field, r.label]));
const requirementLabel = (field) => REQUIREMENT_LABELS[field] || humanize(field);

function DraftTemplates({ data }) {
  const navigate = useNavigate();
  const perms = usePermissions();
  const canOpen = perms.canRead('templates');
  const items = asArray(data.items);
  const missingCounts = Object.entries(data.missing_counts || {});
  return (
    <div>
      <Space wrap size={[24, 8]} style={{ marginBottom: 12 }} align="start">
        <Statistic title="Drafts" value={fmtNum(data.count)} formatter={(v) => v} valueStyle={{ fontSize: 20 }} />
        <Statistic
          title="Ready to publish"
          value={fmtNum(data.ready_to_publish)}
          formatter={(v) => v}
          valueStyle={{ fontSize: 20, color: toNum(data.ready_to_publish) > 0 ? GREEN : undefined }}
        />
        {missingCounts.length > 0 && (
          <div>
            <Text type="secondary" style={{ fontSize: 14 }}>Missing</Text>
            <div style={{ marginTop: 4 }}>
              {missingCounts.map(([field, n]) => (
                <Tag key={field} style={{ marginBottom: 4 }}>
                  {requirementLabel(field)}: {fmtNum(n)}
                </Tag>
              ))}
            </div>
          </div>
        )}
      </Space>
      <Table
        {...SMALL_TABLE}
        rowKey={(r, i) => r.uid ?? i}
        dataSource={items}
        pagination={items.length > 10 ? { pageSize: 10, size: 'small' } : false}
        locale={{ emptyText: 'No drafts' }}
        onRow={(r) =>
          canOpen && r.uid
            ? { onClick: () => navigate(`/templates/${r.uid}`), style: { cursor: 'pointer' } }
            : {}
        }
        columns={[
          { title: 'Design', dataIndex: 'name', render: (v) => v || <Text type="secondary">Untitled</Text> },
          {
            title: 'Missing',
            dataIndex: 'missing',
            render: (m) =>
              asArray(m).length ? (
                asArray(m).map((f) => (
                  <Tag key={f} color="orange" style={{ marginBottom: 2 }}>
                    {requirementLabel(f)}
                  </Tag>
                ))
              ) : (
                <Tag color="green">Ready to publish</Tag>
              ),
          },
          { title: 'Updated', dataIndex: 'updated_at', render: fmtDate },
        ]}
      />
    </div>
  );
}

// ---- System -------------------------------------------------------------

const fileName = (f) => (f && typeof f === 'object' ? f.name ?? f.file ?? JSON.stringify(f) : String(f));

function MigrationStatus({ data }) {
  const pending = asArray(data.pending);
  const unknown = asArray(data.applied_unknown);
  const last = data.last_applied;
  return (
    <div>
      {pending.length === 0 ? (
        <Alert type="success" showIcon icon={<CheckCircleFilled />} message="Up to date" style={{ marginBottom: 12 }} />
      ) : (
        <Alert
          type="error"
          showIcon
          icon={<CloseCircleFilled />}
          style={{ marginBottom: 12 }}
          message={`${pending.length} pending migration${pending.length === 1 ? '' : 's'}`}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {pending.map((f) => (
                <li key={fileName(f)}><code>{fileName(f)}</code></li>
              ))}
            </ul>
          }
        />
      )}
      {unknown.length > 0 && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          style={{ marginBottom: 12 }}
          message="The database is ahead of this build"
          description={
            <>
              Applied migrations this build does not know about:
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {unknown.map((f) => (
                  <li key={fileName(f)}><code>{fileName(f)}</code></li>
                ))}
              </ul>
            </>
          }
        />
      )}
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="Last applied">
          {last && typeof last === 'object' ? (
            <>
              <code>{fileName(last)}</code>
              {last.applied_at && <Text type="secondary"> · {fmtDateTime(last.applied_at)}</Text>}
            </>
          ) : last ? (
            <code>{String(last)}</code>
          ) : (
            '—'
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Database version">{data.database_version ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Run on boot">
          {data.run_on_boot === undefined || data.run_on_boot === null ? '—' : data.run_on_boot ? 'Yes' : 'No'}
        </Descriptions.Item>
      </Descriptions>
    </div>
  );
}

// ---- Fallback for a widget the server added after this build ------------

function UnknownWidget({ data }) {
  const scalars = Object.entries(data || {}).filter(([, v]) => v === null || typeof v !== 'object');
  if (!scalars.length) {
    return <Text type="secondary">This widget isn&apos;t supported by this version of the admin yet.</Text>;
  }
  return (
    <Descriptions column={1} size="small">
      {scalars.map(([k, v]) => (
        <Descriptions.Item key={k} label={humanize(k)}>
          {v === null ? '—' : String(v)}
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
}

/** Renders a widget's payload with its key's renderer (or the fallback). */
export function WidgetBody({ widgetKey, ...props }) {
  const Renderer = WIDGET_RENDERERS[widgetKey] || UnknownWidget;
  return <Renderer {...props} />;
}

const WIDGET_RENDERERS = {
  revenue_summary: RevenueSummary,
  revenue_trend: RevenueTrend,
  payment_health: PaymentHealth,
  subscribers_by_plan: SubscribersByPlan,
  renewals_due: RenewalsDue,
  user_summary: UserSummary,
  signups_by_platform: SignupsByPlatform,
  signup_funnel: SignupFunnel,
  export_summary: ExportSummary,
  catalog_coverage: CatalogCoverage,
  events_without_templates: EventsWithoutTemplates,
  pending_industries: PendingIndustries,
  recent_feedback: RecentFeedback,
  draft_templates: DraftTemplates,
  migration_status: MigrationStatus,
};
