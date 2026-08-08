import { useState } from 'react';
import { Table, Typography, Space, Button, Select, Tag, Tooltip, Alert, App } from 'antd';
import { ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useFeedbackListQuery, useFeedbackDeleteMutation } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';

const { Title, Text } = Typography;

// The form shows five faces, not a number — so the admin view shows the face the
// user actually tapped, with the number as backup.
const RATINGS = [
  { value: 1, emoji: '😞', label: 'Very unhappy', color: '#ff4d4f' },
  { value: 2, emoji: '🙁', label: 'Unhappy', color: '#ff7a45' },
  { value: 3, emoji: '😐', label: 'Neutral', color: '#faad14' },
  { value: 4, emoji: '🙂', label: 'Happy', color: '#52c41a' },
  { value: 5, emoji: '😄', label: 'Very happy', color: '#389e0d' },
];
const RATING_BY_VALUE = new Map(RATINGS.map((r) => [r.value, r]));

const PLATFORM_COLORS = { android: 'green', ios: 'blue', web: 'purple' };

/**
 * Feedback — in-app 1–5 emoji rating plus an optional note, from signed-in users
 * only, so every entry is attributable.
 *
 * Read and delete only, by design. There is no create and no edit: POST
 * /admin/feedback is a 404, because a record of what a user actually said stops
 * being one the moment it can be edited. Delete exists for spam.
 *
 * There is no reply mechanism either — support contacts people out-of-band using
 * the phone/email shown here, which is also why the whole domain is super-admin
 * only.
 */
export default function FeedbackPage() {
  const perms = usePermissions();
  const { message, modal } = App.useApp();
  const canDelete = perms.can('feedback', 'delete');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rating, setRating] = useState(undefined);

  const { data, isLoading, isFetching, refetch } = useFeedbackListQuery({
    rating,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const [deleteFeedback] = useFeedbackDeleteMutation();

  const rows = data?.items || [];
  const total = data?.total || 0;

  const onDelete = (record) => {
    modal.confirm({
      title: 'Delete this feedback?',
      content:
        'Only do this for spam. It is a record of what a user said and there is no way to get it back.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteFeedback(record.uid).unwrap();
          message.success('Feedback deleted');
        } catch {
          // error notification handled by baseQuery
        }
      },
    });
  };

  const columns = [
    {
      title: 'Rating',
      dataIndex: 'rating',
      key: 'rating',
      width: 100,
      render: (v) => {
        const r = RATING_BY_VALUE.get(v);
        if (!r) return <Text type="secondary">—</Text>;
        return (
          <Tooltip title={r.label}>
            <Space size={6}>
              <span style={{ fontSize: 20, lineHeight: 1 }}>{r.emoji}</span>
              <Text style={{ color: r.color }}>{v}</Text>
            </Space>
          </Tooltip>
        );
      },
    },
    {
      title: 'Message',
      dataIndex: 'message',
      key: 'message',
      // Rating-only submissions are normal and expected — the faces are the point
      // of the form — so an empty cell would read as a rendering bug.
      render: (v) => (v ? <Text>{v}</Text> : <Text type="secondary">no comment</Text>),
    },
    {
      title: 'User',
      key: 'user',
      width: 210,
      render: (_v, r) =>
        r.User ? (
          <div>
            <div>{r.User.name || <Text type="secondary">Unnamed</Text>}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {r.User.phone || r.User.email || '—'}
            </Text>
          </div>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      // The two most useful triage fields — keep them visible.
      title: 'App',
      key: 'app',
      width: 160,
      render: (_v, r) => (
        <Space size={4} wrap>
          {r.platform ? (
            <Tag color={PLATFORM_COLORS[String(r.platform).toLowerCase()] || 'default'}>
              {r.platform}
            </Tag>
          ) : (
            <Text type="secondary">—</Text>
          )}
          {r.app_version && <Text code style={{ fontSize: 12 }}>{r.app_version}</Text>}
        </Space>
      ),
    },
    {
      title: 'When',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 150,
      render: (v) =>
        v && dayjs(v).isValid() ? (
          <Tooltip title={dayjs(v).format('YYYY-MM-DD HH:mm:ss')}>
            {dayjs(v).format('YYYY-MM-DD HH:mm')}
          </Tooltip>
        ) : (
          '—'
        ),
    },
  ];

  if (canDelete) {
    columns.push({
      title: '',
      key: 'actions',
      width: 60,
      fixed: 'right',
      render: (_v, record) => (
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => onDelete(record)}
          title="Delete (spam only)"
        />
      ),
    });
  }

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
          Feedback
        </Title>
        <Space wrap>
          <Select
            allowClear
            placeholder="Rating"
            style={{ width: 170 }}
            value={rating}
            onChange={(v) => {
              setRating(v);
              setPage(1);
            }}
            options={RATINGS.map((r) => ({
              label: `${r.emoji} ${r.value} — ${r.label}`,
              value: r.value,
            }))}
          />
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
            Reload
          </Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Read-only: feedback can be deleted for spam, but never added or edited."
        description="There is no reply mechanism in the app — reach people out-of-band on the phone or email shown here."
      />

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        scroll={{ x: 'max-content' }}
        size="middle"
        locale={{ emptyText: rating ? 'No feedback at this rating.' : 'No feedback yet.' }}
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
