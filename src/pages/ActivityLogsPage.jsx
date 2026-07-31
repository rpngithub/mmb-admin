import { useState } from 'react';
import { Table, Typography, Space, Input, Button, Select, Tag, Tooltip } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useActivityLogsListQuery } from '../features/api/adminApi';

const { Title } = Typography;

export default function ActivityLogsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState({ entity_type: '', action: '', actor_type: undefined });

  const { data, isLoading, isFetching, refetch } = useActivityLogsListQuery({
    entity_type: filters.entity_type || undefined,
    action: filters.action || undefined,
    actor_type: filters.actor_type,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  const rows = data?.items || [];
  const total = data?.total || 0;

  const setFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const columns = [
    {
      title: 'When',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
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
      title: 'Actor',
      key: 'actor',
      render: (_v, r) => (
        <Space size={4}>
          <Tag color={r.actor_type === 'admin' ? 'purple' : 'blue'}>{r.actor_type || '—'}</Tag>
          <span>{r.actor_id ?? r.actor_uid ?? ''}</span>
        </Space>
      ),
    },
    {
      title: 'Action',
      dataIndex: 'action',
      key: 'action',
      render: (v) => (v ? <Tag>{v}</Tag> : '—'),
    },
    { title: 'Entity', dataIndex: 'entity_type', key: 'entity_type', render: (v) => v || '—' },
    {
      title: 'Entity ID',
      dataIndex: 'entity_id',
      key: 'entity_id',
      render: (v) => v ?? '—',
    },
    {
      title: 'Details',
      key: 'details',
      ellipsis: true,
      render: (_v, r) => {
        const payload = r.metadata ?? r.details ?? r.changes;
        if (!payload) return '—';
        const str = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
        return (
          <Tooltip title={str}>
            <code style={{ fontSize: 12 }}>{str.slice(0, 60)}</code>
          </Tooltip>
        );
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
          Activity Logs
        </Title>
        <Space wrap>
          <Input
            allowClear
            placeholder="Entity type"
            style={{ width: 150 }}
            onChange={(e) => setFilter('entity_type', e.target.value)}
          />
          <Input
            allowClear
            placeholder="Action"
            style={{ width: 130 }}
            onChange={(e) => setFilter('action', e.target.value)}
          />
          <Select
            allowClear
            placeholder="Actor type"
            style={{ width: 130 }}
            value={filters.actor_type}
            onChange={(v) => setFilter('actor_type', v)}
            options={[
              { label: 'User', value: 'user' },
              { label: 'Admin', value: 'admin' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
            Reload
          </Button>
        </Space>
      </div>

      <Table
        rowKey={(r) => r.uid ?? r.id ?? `${r.created_at}-${r.action}-${r.entity_id}`}
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
    </div>
  );
}
