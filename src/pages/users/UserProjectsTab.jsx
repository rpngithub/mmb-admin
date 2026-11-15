import { useState } from 'react';
import { Image, Space, Table, Tag, Typography } from 'antd';
import { PictureOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { useUserProjectsQuery } from '../../features/api/adminApi';
import { formatDateTime } from '../../lib/ai';
import { imageUrl, useCdnBaseUrl } from '../../lib/cdn';
import { sectionState } from '../../lib/users';

const { Text } = Typography;

const STATUS_COLOR = { draft: 'default', published: 'green', archived: 'orange' };
const THUMB = 48;

export default function UserProjectsTab({ uid }) {
  const cdnBase = useCdnBaseUrl();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { data, isLoading, isFetching, error } = useUserProjectsQuery({
    uid,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const state = sectionState({ isLoading: false, error });
  if (state) return state;

  const columns = [
    {
      title: '',
      key: 'thumb',
      width: THUMB + 16,
      render: (_v, r) => {
        const src = imageUrl(cdnBase, r.thumbnail_s3_key);
        return src ? (
          <Image src={src} width={THUMB} height={THUMB} style={{ objectFit: 'cover', borderRadius: 4 }} />
        ) : (
          <div
            style={{
              width: THUMB,
              height: THUMB,
              borderRadius: 4,
              background: 'rgba(0,0,0,0.04)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {r.project_type === 'video' ? <VideoCameraOutlined /> : <PictureOutlined />}
          </div>
        );
      },
    },
    {
      title: 'Design',
      key: 'name',
      render: (_v, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{r.name}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {r.Template?.name ? `From “${r.Template.name}”` : 'Blank design'}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'project_type',
      key: 'project_type',
      render: (v) => <Tag color={v === 'video' ? 'magenta' : 'blue'}>{v}</Tag>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (v) => <Tag color={STATUS_COLOR[v] || 'default'}>{v}</Tag>,
    },
    { title: 'Business', key: 'business', render: (_v, r) => r.Business?.name || '—' },
    {
      title: 'Exports',
      dataIndex: 'export_count',
      key: 'export_count',
      align: 'right',
      render: (v) => v ?? 0,
    },
    { title: 'Last edited', dataIndex: 'updated_at', key: 'updated_at', render: formatDateTime },
    { title: 'Created', dataIndex: 'created_at', key: 'created_at', render: formatDateTime },
  ];

  return (
    <Table
      rowKey="uid"
      size="small"
      columns={columns}
      dataSource={data?.items || []}
      loading={isLoading || isFetching}
      scroll={{ x: 'max-content' }}
      locale={{ emptyText: 'No designs yet' }}
      pagination={{
        current: page,
        pageSize,
        total: data?.total || 0,
        showSizeChanger: true,
        showTotal: (t) => `${t} designs`,
        onChange: (p, ps) => {
          setPage(p);
          setPageSize(ps);
        },
      }}
    />
  );
}
