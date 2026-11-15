import { useState } from 'react';
import { Select, Space, Table, Tag, Typography } from 'antd';
import { useUserSubscriptionsQuery } from '../../features/api/adminApi';
import { formatDate, formatDateTime } from '../../lib/ai';
import { inr, isTruthyFlag, sectionState } from '../../lib/users';
import { HintTag } from './userShared';

const { Text } = Typography;

const STATUS = {
  active: { color: 'green' },
  pending: { color: 'gold', hint: 'Checkout not completed' },
  overridden: { color: 'blue', hint: 'Replaced by a newer plan' },
  cancelled: { color: 'default' },
  expired: { color: 'default' },
};
const SUB_TYPE_LABEL = { regular: 'Regular', trial: 'Trial', access_pass: 'Access pass' };

export default function UserSubscriptionHistoryTab({ uid }) {
  const [status, setStatus] = useState();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading, isFetching, error } = useUserSubscriptionsQuery({
    uid,
    status,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const state = sectionState({ isLoading: false, error });
  if (state) return state;

  const columns = [
    {
      title: 'Plan',
      key: 'plan',
      render: (_v, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{r.Plan?.name || '—'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {SUB_TYPE_LABEL[r.sub_type] || r.sub_type}
            {r.PlanBillingOption ? ` · ${r.PlanBillingOption.billing_cycle}` : ''}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (v) => (
        <HintTag color={STATUS[v]?.color || 'default'} hint={STATUS[v]?.hint}>
          {v}
        </HintTag>
      ),
    },
    { title: 'Starts', dataIndex: 'starts_at', key: 'starts_at', render: formatDate },
    { title: 'Ends', dataIndex: 'ends_at', key: 'ends_at', render: formatDate },
    {
      title: 'Cancelled',
      dataIndex: 'cancelled_at',
      key: 'cancelled_at',
      render: (v) => (v ? formatDate(v) : '—'),
    },
    {
      title: 'Auto-renew',
      dataIndex: 'auto_renew',
      key: 'auto_renew',
      render: (v) => (isTruthyFlag(v) ? <Tag color="green">On</Tag> : <Tag>Off</Tag>),
    },
    { title: 'Amount paid', dataIndex: 'amount_paid', key: 'amount_paid', align: 'right', render: inr },
    {
      title: 'Coupon',
      key: 'coupon',
      render: (_v, r) => (r.Coupon?.code ? <Tag>{r.Coupon.code}</Tag> : '—'),
    },
    { title: 'Created', dataIndex: 'created_at', key: 'created_at', render: formatDateTime },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Select
          allowClear
          placeholder="Status"
          style={{ width: 160 }}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={Object.keys(STATUS).map((s) => ({ value: s, label: s }))}
        />
      </Space>
      <Table
        rowKey="uid"
        size="small"
        columns={columns}
        dataSource={data?.items || []}
        loading={isLoading || isFetching}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: 'No subscriptions — this user has never subscribed' }}
        expandable={{
          rowExpandable: (r) => Boolean(r.razorpay_subscription_id),
          expandedRowRender: (r) => (
            <Text type="secondary">
              Razorpay subscription: <Text copyable>{r.razorpay_subscription_id}</Text>
            </Text>
          ),
        }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
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
