import { useMemo, useState } from 'react';
import { Table, Typography, Space, Input, Button, Tag, Select, App } from 'antd';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { adminApi } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import CouponEditorDrawer from '../components/CouponEditorDrawer';
import {
  STATUS_OPTIONS,
  AUDIENCE_OPTIONS,
  APPLICABLE_OPTIONS,
  applicableLabel,
  audienceLabel,
  couponSignals,
  formatDiscount,
  formatUsage,
  formatValidity,
  statusColor,
} from '../lib/coupons';

const { Title, Text } = Typography;

/**
 * Coupons list. The API returns every row (no pagination), so only the
 * exact-match filters (status / applicable_to / target_audience) are sent as
 * query params — search and paging are client-side, since no search param
 * exists. Row actions are gated on coupons.*.
 */
export default function CouponsPage() {
  const perms = usePermissions();
  const { message, modal } = App.useApp();

  const canCreate = perms.can('coupons', 'create');
  const canUpdate = perms.can('coupons', 'update');
  const canDelete = perms.can('coupons', 'delete');

  const [filters, setFilters] = useState({
    status: null,
    applicable_to: null,
    target_audience: null,
  });
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState({ open: false, coupon: null });

  const queryParams = useMemo(
    () => ({
      status: filters.status ?? undefined,
      applicable_to: filters.applicable_to ?? undefined,
      target_audience: filters.target_audience ?? undefined,
    }),
    [filters],
  );

  const couponsQuery = adminApi.endpoints.couponsFiltered.useQuery(queryParams);
  const [removeCoupon] = adminApi.endpoints.couponsRemove.useMutation();

  const coupons = useMemo(() => couponsQuery.data || [], [couponsQuery.data]);

  const rows = useMemo(() => {
    if (!search.trim()) return coupons;
    const q = search.toLowerCase();
    return coupons.filter(
      (c) => c.code?.toLowerCase().includes(q) || c.title?.toLowerCase().includes(q),
    );
  }, [coupons, search]);

  const onDelete = (coupon) => {
    modal.confirm({
      title: `Delete coupon "${coupon.code}"?`,
      content:
        'Its plan scoping is removed too. Subscriptions that already used the code are untouched.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeCoupon(coupon.uid).unwrap();
          message.success('Coupon deleted');
        } catch {
          // error notification handled by baseQuery
        }
      },
    });
  };

  const columns = [
    {
      title: 'Code',
      dataIndex: 'code',
      key: 'code',
      width: 170,
      render: (v) => <Text code copyable={{ text: v }}>{v}</Text>,
    },
    { title: 'Title', dataIndex: 'title', key: 'title', render: (v) => <Text strong>{v}</Text> },
    {
      title: 'Discount',
      key: 'discount',
      width: 110,
      render: (_v, c) => formatDiscount(c.discount_type, c.discount_value),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 190,
      render: (v, c) => {
        // A coupon can be dead while its status still says active — surface why.
        const { expired, exhausted } = couponSignals(c);
        return (
          <Space size={4} wrap>
            <Tag color={statusColor(v)}>{v || '—'}</Tag>
            {expired && v !== 'expired' && <Tag color="orange">Expired</Tag>}
            {exhausted && <Tag color="orange">Exhausted</Tag>}
          </Space>
        );
      },
    },
    {
      title: 'Applies to',
      dataIndex: 'applicable_to',
      key: 'applicable_to',
      width: 130,
      render: (v) => (
        <Tag color={v === 'specific_plans' ? 'blue' : 'default'}>{applicableLabel(v)}</Tag>
      ),
    },
    {
      title: 'Audience',
      dataIndex: 'target_audience',
      key: 'target_audience',
      width: 130,
      render: (v) => audienceLabel(v),
    },
    {
      title: 'Usage',
      key: 'usage',
      width: 170,
      render: (_v, c) => formatUsage(c),
    },
    {
      title: 'Validity',
      key: 'validity',
      width: 300,
      render: (_v, c) => <Text type="secondary">{formatValidity(c)}</Text>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 110,
      fixed: 'right',
      render: (_v, coupon) => (
        <Space size="small">
          {canUpdate && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditor({ open: true, coupon })}
              title="Edit"
            />
          )}
          {canDelete && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onDelete(coupon)}
              title="Delete"
            />
          )}
        </Space>
      ),
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
          Coupons
        </Title>
        <Space wrap>
          <Select
            allowClear
            placeholder="Status"
            style={{ width: 140 }}
            options={STATUS_OPTIONS}
            value={filters.status}
            onChange={(v) => setFilters((f) => ({ ...f, status: v ?? null }))}
          />
          <Select
            allowClear
            placeholder="Applies to"
            style={{ width: 160 }}
            options={APPLICABLE_OPTIONS}
            value={filters.applicable_to}
            onChange={(v) => setFilters((f) => ({ ...f, applicable_to: v ?? null }))}
          />
          <Select
            allowClear
            placeholder="Audience"
            style={{ width: 160 }}
            options={AUDIENCE_OPTIONS}
            value={filters.target_audience}
            onChange={(v) => setFilters((f) => ({ ...f, target_audience: v ?? null }))}
          />
          <Input.Search
            allowClear
            placeholder="Search code or title"
            style={{ width: 220 }}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={setSearch}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => couponsQuery.refetch()}
            loading={couponsQuery.isFetching}
          >
            Reload
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setEditor({ open: true, coupon: null })}
            >
              New Coupon
            </Button>
          )}
        </Space>
      </div>

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={rows}
        loading={couponsQuery.isLoading}
        scroll={{ x: 'max-content' }}
        size="middle"
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} total` }}
      />

      <CouponEditorDrawer
        open={editor.open}
        coupon={editor.coupon}
        onClose={() => setEditor({ open: false, coupon: null })}
        onSaved={() => couponsQuery.refetch()}
      />
    </div>
  );
}
