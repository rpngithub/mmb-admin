import { useState } from 'react';
import { Segmented, Table, Tag, Typography } from 'antd';
import { useUserActivityQuery } from '../../features/api/adminApi';
import { formatDateTime } from '../../lib/ai';
import { sectionState } from '../../lib/users';

const { Text } = Typography;

const SCOPES = [
  { value: 'both', label: 'All' },
  { value: 'actor', label: 'By user' },
  { value: 'subject', label: 'On user' },
];

const mono = {
  fontFamily: 'monospace',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  margin: 0,
  maxHeight: 280,
  overflow: 'auto',
};

function metadataText(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') {
    try {
      return JSON.stringify(JSON.parse(v), null, 2);
    } catch {
      return v;
    }
  }
  return JSON.stringify(v, null, 2);
}

export default function UserActivityTab({ uid }) {
  const [scope, setScope] = useState('both');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { data, isLoading, isFetching, error } = useUserActivityQuery({
    user_uid: uid,
    user_scope: scope,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const state = sectionState({ isLoading: false, error });
  if (state) return state;

  const columns = [
    { title: 'When', dataIndex: 'created_at', key: 'created_at', render: formatDateTime },
    { title: 'Action', dataIndex: 'action', key: 'action', render: (v) => <Text code>{v}</Text> },
    {
      title: 'By',
      dataIndex: 'actor_type',
      key: 'actor_type',
      render: (v, r) =>
        v ? (
          <Tag color={v === 'admin' ? 'volcano' : 'blue'}>
            {v}
            {r.actor_id != null ? ` #${r.actor_id}` : ''}
          </Tag>
        ) : (
          '—'
        ),
    },
    {
      title: 'Entity',
      key: 'entity',
      render: (_v, r) =>
        r.entity_type ? `${r.entity_type}${r.entity_id != null ? ` #${r.entity_id}` : ''}` : '—',
    },
    { title: 'IP', dataIndex: 'ip_address', key: 'ip_address', render: (v) => v || '—' },
  ];

  return (
    <div>
      <Segmented
        style={{ marginBottom: 12 }}
        options={SCOPES}
        value={scope}
        onChange={(v) => {
          setScope(v);
          setPage(1);
        }}
      />
      <Table
        rowKey={(r) => r.id ?? r.uid ?? `${r.created_at}-${r.action}`}
        size="small"
        columns={columns}
        dataSource={data?.items || []}
        loading={isLoading || isFetching}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: 'No activity recorded' }}
        expandable={{
          rowExpandable: (r) => Boolean(metadataText(r.metadata)),
          expandedRowRender: (r) => <pre style={mono}>{metadataText(r.metadata)}</pre>,
        }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100, 200],
          showTotal: (t) => `${t} entries`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />
    </div>
  );
}
