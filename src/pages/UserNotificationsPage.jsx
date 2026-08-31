import { useEffect, useMemo, useState } from 'react';
import { Table, Typography, Space, Input, Button, Select, Tag, Tooltip, Alert } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  useUserNotificationsListQuery,
  useNotificationTemplatesListQuery,
  useNotificationCampaignsListQuery,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';

const { Title, Text } = Typography;

const EMPTY_FILTERS = {
  user_id: '',
  template_id: undefined,
  campaign_id: undefined,
  dedupe_key: '',
};

const asNumber = (v) => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Delivery log — the read-only record of what was actually sent to whom.
 *
 * Read-only BY DESIGN: a row records something that already happened, and an
 * editable audit trail is worthless. There is deliberately no create, edit or
 * delete here.
 *
 * This is the screen that answers "the customer says they never got it", so it
 * is reached with a filter already applied — from a user, from a campaign, or
 * from a notification — via query params. The `dedupe_key` column is the one
 * that explains why something did or did not go out a second time; it is
 * human-readable on purpose (`inactive_7d:la:2026-08-22`, `campaign:317`).
 *
 * The one paginated list in this section.
 */
export default function UserNotificationsPage() {
  const perms = usePermissions();
  // Campaigns sit behind their own permission domain, so the campaign filter is
  // only offered to whoever can actually read one — a content_admin 403s there.
  const canReadCampaigns = perms.canRead('notification_campaigns');

  const [searchParams, setSearchParams] = useSearchParams();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  // Applied on submit rather than per keystroke — this list is not cheap.
  const [applied, setApplied] = useState(EMPTY_FILTERS);

  // Arriving from a user, a campaign or a notification: seed both the inputs and
  // the query from the URL so the link lands on an already-filtered view.
  useEffect(() => {
    const seeded = {
      user_id: searchParams.get('user_id') || '',
      template_id: asNumber(searchParams.get('template_id')),
      campaign_id: asNumber(searchParams.get('campaign_id')),
      dedupe_key: searchParams.get('dedupe_key') || '',
    };
    setFilters(seeded);
    setApplied(seeded);
    setPage(1);
  }, [searchParams]);

  const { data: templates } = useNotificationTemplatesListQuery();
  const { data: campaigns } = useNotificationCampaignsListQuery(undefined, {
    skip: !canReadCampaigns,
  });

  const queryArg = useMemo(
    () => ({
      user_id: applied.user_id || undefined,
      template_id: applied.template_id,
      campaign_id: applied.campaign_id,
      dedupe_key: applied.dedupe_key || undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    [applied, page, pageSize],
  );

  const { data, isLoading, isFetching, refetch } = useUserNotificationsListQuery(queryArg);

  const rows = data?.items || [];
  const total = data?.total || 0;

  const templateById = useMemo(
    () => new Map((Array.isArray(templates) ? templates : []).map((t) => [t.id, t])),
    [templates],
  );

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  // The URL is the source of truth, so applying writes to it and the effect
  // above feeds it back in — one path, and the filtered view stays linkable.
  const apply = () => {
    const next = {};
    if (filters.user_id) next.user_id = filters.user_id;
    if (filters.template_id !== undefined) next.template_id = String(filters.template_id);
    if (filters.campaign_id !== undefined) next.campaign_id = String(filters.campaign_id);
    if (filters.dedupe_key) next.dedupe_key = filters.dedupe_key;
    setSearchParams(next, { replace: true });
  };

  const clear = () => setSearchParams({}, { replace: true });

  const filtersActive = Object.values(applied).some((v) => v !== undefined && v !== '');

  const columns = [
    {
      title: 'When',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 160,
      render: (v) =>
        v && dayjs(v).isValid() ? (
          <Tooltip title={dayjs(v).format('YYYY-MM-DD HH:mm:ss')}>
            {dayjs(v).format('YYYY-MM-DD HH:mm')}
          </Tooltip>
        ) : (
          '—'
        ),
    },
    {
      title: 'Recipient',
      key: 'recipient',
      width: 220,
      render: (_v, r) => {
        const name = r.User?.name ?? r.user_name ?? r.name;
        const phone = r.User?.phone ?? r.user_phone ?? r.phone;
        return (
          <Space direction="vertical" size={0}>
            <Text>{name || <Text type="secondary">—</Text>}</Text>
            {phone ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {phone}
              </Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: 'Notification',
      key: 'template',
      width: 220,
      render: (_v, r) => {
        const code =
          r.NotificationTemplate?.code ?? r.template_code ?? templateById.get(r.template_id)?.code;
        return code ? <Text code>{code}</Text> : <Text type="secondary">—</Text>;
      },
    },
    {
      title: 'Message',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (v, r) => (
        <Tooltip title={r.body || undefined}>
          <span>{v || <Text type="secondary">—</Text>}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Campaign',
      key: 'campaign',
      width: 120,
      render: (_v, r) =>
        r.campaign_id ? <Tag color="blue">#{r.campaign_id}</Tag> : <Text type="secondary">—</Text>,
    },
    {
      title: (
        <Tooltip title="The key that decides whether the same notification may go out again. Human-readable on purpose — it is what explains a repeat, or the absence of one.">
          <span>Dedupe key</span>
        </Tooltip>
      ),
      dataIndex: 'dedupe_key',
      key: 'dedupe_key',
      width: 260,
      render: (v) =>
        v ? (
          <Text code style={{ fontSize: 12 }}>
            {v}
          </Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: 'Read',
      key: 'read',
      width: 90,
      render: (_v, r) => {
        const at = r.read_at ?? r.seen_at;
        if (at && dayjs(at).isValid()) {
          return (
            <Tooltip title={dayjs(at).format('YYYY-MM-DD HH:mm')}>
              <Tag color="green">Read</Tag>
            </Tooltip>
          );
        }
        return <Tag color="default">Unread</Tag>;
      },
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
          Delivery Log
        </Title>
        <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
          Reload
        </Button>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Read-only — this is the record of what was actually sent."
        description="A row records something that already happened, so nothing here can be edited or removed; an editable audit trail would be worthless. Use it to answer “the customer says they never got it”: filter by the person, then read the dedupe key to see why a notification did or did not go out a second time."
      />

      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          allowClear
          placeholder="User ID"
          style={{ width: 150 }}
          value={filters.user_id}
          onChange={(e) => setFilter('user_id', e.target.value)}
          onPressEnter={apply}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Notification"
          style={{ width: 260 }}
          value={filters.template_id}
          onChange={(v) => setFilter('template_id', v)}
          options={(Array.isArray(templates) ? templates : []).map((t) => ({
            value: t.id,
            label: t.title ? `${t.title} (${t.code})` : t.code,
          }))}
        />
        {canReadCampaigns && (
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Campaign"
            style={{ width: 240 }}
            value={filters.campaign_id}
            onChange={(v) => setFilter('campaign_id', v)}
            options={(Array.isArray(campaigns) ? campaigns : []).map((c) => ({
              value: c.id,
              label: c.name || c.title || `Campaign ${c.id}`,
            }))}
          />
        )}
        <Input
          allowClear
          placeholder="Dedupe key"
          style={{ width: 240 }}
          value={filters.dedupe_key}
          onChange={(e) => setFilter('dedupe_key', e.target.value)}
          onPressEnter={apply}
        />
        <Button type="primary" onClick={apply}>
          Apply
        </Button>
        {filtersActive && <Button onClick={clear}>Clear</Button>}
      </Space>

      <Table
        rowKey={(r) => r.uid ?? r.id ?? `${r.created_at}-${r.dedupe_key}`}
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        scroll={{ x: 'max-content' }}
        size="middle"
        locale={{
          emptyText: filtersActive
            ? 'Nothing matches — which is itself an answer: no notification of that kind was written for that person.'
            : 'No notifications sent yet.',
        }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          // 100 is the API's maximum `limit`; 50 is its default.
          pageSizeOptions: [20, 50, 100],
          showTotal: (t) => `${t} total`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />
    </div>
  );
}
