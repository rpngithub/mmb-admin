import { useState } from 'react';
import { App, Button, Descriptions, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { FileTextOutlined, FileDoneOutlined } from '@ant-design/icons';
import { useLazyPaymentDocumentQuery, useUserPaymentsQuery } from '../../features/api/adminApi';
import { formatDateTime } from '../../lib/ai';
import { inr, sectionState } from '../../lib/users';
import { HintTag } from './userShared';

const { Text } = Typography;

// What the user sees. The `status` FILTER works on the stored value instead.
const DISPLAY_STATUS = {
  success: { color: 'green' },
  pending: { color: 'gold' },
  failed: { color: 'red' },
  abandoned: { color: 'default', hint: 'Unpaid order that went stale — the user never completed checkout' },
  refunded: { color: 'purple' },
};
const STORED_STATUSES = ['pending', 'success', 'failed', 'refunded'];
const PURCHASE_TYPES = [
  { value: 'subscription', label: 'Subscription' },
  { value: 'frame', label: 'Frame' },
  { value: 'quota_pack', label: 'Top-up pack' },
  { value: 'variant', label: 'Variant' },
];
const PURCHASE_LABEL = Object.fromEntries(PURCHASE_TYPES.map((p) => [p.value, p.label]));
const METHOD_LABEL = {
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Net banking',
  wallet: 'Wallet',
  emi: 'EMI',
  other: 'Other',
};

const DOC_ERRORS = {
  409: 'Documents exist only for successful payments.',
  404: 'Payment not found.',
};

export default function UserPaymentsTab({ uid }) {
  const { message } = App.useApp();
  const [status, setStatus] = useState();
  const [purchaseType, setPurchaseType] = useState();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [opening, setOpening] = useState(null); // `${paymentUid}:${type}`

  const { data, isLoading, isFetching, error, refetch } = useUserPaymentsQuery({
    uid,
    status,
    purchase_type: purchaseType,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const [fetchDocument] = useLazyPaymentDocumentQuery();

  const state = sectionState({ isLoading: false, error });
  if (state) return state;

  /**
   * The document needs the admin's bearer token, so it can't be a plain link.
   * The tab is opened BEFORE the await (popup blockers only allow a window.open
   * inside the click), then pointed at a Blob URL of the fetched HTML.
   */
  const openDocument = async (payment, type) => {
    const win = window.open('', '_blank');
    setOpening(`${payment.uid}:${type}`);
    try {
      const html = await fetchDocument({ uid: payment.uid, type }).unwrap();
      if (typeof html !== 'string') throw new Error('Unexpected response');
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      if (win) win.location.href = url;
      else window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      // The first open of an older payment assigns its invoice number.
      if (!payment.invoice_number) refetch();
    } catch (err) {
      if (win) win.close();
      message.error(DOC_ERRORS[err?.status] || err?.message || 'Could not open the document.');
    } finally {
      setOpening(null);
    }
  };

  const columns = [
    {
      title: 'Purchase',
      key: 'description',
      render: (_v, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{r.description || '—'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {PURCHASE_LABEL[r.purchase_type] || r.purchase_type || r.order_type}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      render: (v, r) => (
        <Tooltip
          title={`${inr(r.amount_before_tax)} + GST ${inr(r.gst_amount)} (${r.gst_rate ?? '—'}%)`}
        >
          <span>{inr(v)}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'display_status',
      key: 'display_status',
      render: (v, r) => {
        const s = v || r.status;
        const hint = s === 'failed' && r.failure_reason ? r.failure_reason : DISPLAY_STATUS[s]?.hint;
        return (
          <HintTag color={DISPLAY_STATUS[s]?.color || 'default'} hint={hint}>
            {s}
          </HintTag>
        );
      },
    },
    {
      title: 'Method',
      key: 'method',
      render: (_v, r) =>
        r.payment_method ? (
          <Space direction="vertical" size={0}>
            <span>{METHOD_LABEL[r.payment_method] || r.payment_method}</span>
            {r.payment_method_detail && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {r.payment_method_detail}
              </Text>
            )}
          </Space>
        ) : (
          '—'
        ),
    },
    {
      title: 'Invoice #',
      dataIndex: 'invoice_number',
      key: 'invoice_number',
      render: (v) => v || '—',
    },
    {
      title: 'Paid / created',
      key: 'when',
      render: (_v, r) => formatDateTime(r.paid_at || r.created_at),
    },
    {
      title: '',
      key: 'docs',
      fixed: 'right',
      render: (_v, r) =>
        r.has_invoice ? (
          <Space size="small">
            <Button
              size="small"
              icon={<FileTextOutlined />}
              loading={opening === `${r.uid}:invoice`}
              onClick={() => openDocument(r, 'invoice')}
            >
              Invoice
            </Button>
            <Button
              size="small"
              icon={<FileDoneOutlined />}
              loading={opening === `${r.uid}:receipt`}
              onClick={() => openDocument(r, 'receipt')}
            >
              Receipt
            </Button>
          </Space>
        ) : null,
    },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          allowClear
          placeholder="Status"
          style={{ width: 150 }}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={STORED_STATUSES.map((s) => ({ value: s, label: s }))}
        />
        <Select
          allowClear
          placeholder="Purchase type"
          style={{ width: 170 }}
          value={purchaseType}
          onChange={(v) => {
            setPurchaseType(v);
            setPage(1);
          }}
          options={PURCHASE_TYPES}
        />
      </Space>
      <Table
        rowKey="uid"
        size="small"
        columns={columns}
        dataSource={data?.items || []}
        loading={isLoading || isFetching}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: 'No payments' }}
        expandable={{
          expandedRowRender: (r) => (
            <Descriptions size="small" column={{ xs: 1, md: 2 }}>
              <Descriptions.Item label="Razorpay order">
                {r.razorpay_order_id ? <Text copyable>{r.razorpay_order_id}</Text> : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Razorpay payment">
                {r.razorpay_payment_id ? <Text copyable>{r.razorpay_payment_id}</Text> : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Payment uid">
                <Text copyable>{r.uid}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Stored status">
                <Tag>{r.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Created">{formatDateTime(r.created_at)}</Descriptions.Item>
              <Descriptions.Item label="Paid">{formatDateTime(r.paid_at)}</Descriptions.Item>
              {r.failure_reason && (
                <Descriptions.Item label="Failure reason" span={2}>
                  {r.failure_reason}
                </Descriptions.Item>
              )}
            </Descriptions>
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
