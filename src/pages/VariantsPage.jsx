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
import ImageThumb from '../components/ImageThumb';
import VariantEditorDrawer from '../components/VariantEditorDrawer';

const { Title, Text } = Typography;

const isTrue = (v) => v === true || v === 1 || v === '1';

/**
 * Flat variants table with a Brand Series column and a series filter. The
 * variants list is unfiltered (returns all variants), so the series filter is
 * applied client-side. Series names come from the nested BrandSeries, falling
 * back to the brand-series list (series_id → name).
 */
export default function VariantsPage() {
  const perms = usePermissions();
  const { message, modal } = App.useApp();

  const canCreate = perms.can('variants', 'create');
  const canUpdate = perms.can('variants', 'update');
  const canDelete = perms.can('variants', 'delete');

  const [search, setSearch] = useState('');
  const [seriesFilter, setSeriesFilter] = useState(null);
  const [editor, setEditor] = useState({ open: false, variant: null });

  const variantsQuery = adminApi.endpoints.variantsList.useQuery();
  const seriesQuery = adminApi.endpoints.brandSeriesList.useQuery();
  const [removeVariant] = adminApi.endpoints.variantsRemove.useMutation();

  const variants = useMemo(() => variantsQuery.data || [], [variantsQuery.data]);
  const seriesList = useMemo(() => seriesQuery.data || [], [seriesQuery.data]);

  const seriesName = useMemo(() => {
    const map = new Map();
    seriesList.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [seriesList]);

  const rows = useMemo(() => {
    let list = variants;
    if (seriesFilter != null) list = list.filter((v) => v.series_id === seriesFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((v) => v.name?.toLowerCase().includes(q));
    }
    return list;
  }, [variants, seriesFilter, search]);

  const onDelete = (variant) => {
    modal.confirm({
      title: `Delete variant "${variant.name}"?`,
      content: 'Its template associations are removed; the templates themselves are untouched.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeVariant(variant.uid).unwrap();
          message.success('Variant deleted');
        } catch {
          // error notification handled by baseQuery
        }
      },
    });
  };

  const columns = [
    {
      title: 'Thumbnail',
      dataIndex: 'thumbnail_s3_key',
      key: 'thumb',
      width: 90,
      render: (k) => <ImageThumb k={k} />,
    },
    { title: 'Name', dataIndex: 'name', key: 'name', render: (v) => <Text strong>{v}</Text> },
    {
      title: 'Brand series',
      key: 'series',
      render: (_v, variant) =>
        variant.BrandSeries?.name ||
        seriesName.get(variant.series_id) || <Text type="secondary">#{variant.series_id}</Text>,
    },
    {
      title: 'Badge',
      key: 'badge',
      width: 120,
      render: (_v, variant) =>
        variant.VariantBadge?.name ? (
          <Tag>{variant.VariantBadge.name}</Tag>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: 'Likes',
      dataIndex: 'likes_count',
      key: 'likes',
      width: 90,
      render: (v) => <Text type="secondary">❤️ {v ?? 0}</Text>,
    },
    {
      title: 'Order',
      dataIndex: 'display_order',
      key: 'order',
      width: 80,
      render: (v) => v ?? 0,
    },
    {
      title: 'Active',
      dataIndex: 'is_active',
      key: 'active',
      width: 80,
      render: (v) => <Tag color={isTrue(v) ? 'green' : 'default'}>{isTrue(v) ? 'Yes' : 'No'}</Tag>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 110,
      fixed: 'right',
      render: (_v, variant) => (
        <Space size="small">
          {canUpdate && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditor({ open: true, variant })}
              title="Edit"
            />
          )}
          {canDelete && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onDelete(variant)}
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
          Variants
        </Title>
        <Space wrap>
          <Select
            allowClear
            placeholder="All brand series"
            style={{ width: 200 }}
            value={seriesFilter ?? undefined}
            onChange={(v) => setSeriesFilter(v ?? null)}
            showSearch
            optionFilterProp="label"
            options={seriesList.map((s) => ({ label: s.name, value: s.id }))}
          />
          <Input.Search
            allowClear
            placeholder="Search variants"
            style={{ width: 220 }}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={setSearch}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              variantsQuery.refetch();
              seriesQuery.refetch();
            }}
            loading={variantsQuery.isFetching}
          >
            Reload
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setEditor({ open: true, variant: null })}
            >
              New Variant
            </Button>
          )}
        </Space>
      </div>

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={rows}
        loading={variantsQuery.isLoading}
        scroll={{ x: 'max-content' }}
        size="middle"
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} total` }}
      />

      <VariantEditorDrawer
        open={editor.open}
        variant={editor.variant}
        defaultSeriesId={seriesFilter}
        onClose={() => setEditor({ open: false, variant: null })}
        onSaved={() => {
          variantsQuery.refetch();
        }}
      />
    </div>
  );
}
