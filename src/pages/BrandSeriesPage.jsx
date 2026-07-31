import { useMemo, useState } from 'react';
import { Table, Typography, Space, Input, Button, Tag, App } from 'antd';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ExclamationCircleFilled,
} from '@ant-design/icons';
import { adminApi } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import ImageThumb from '../components/ImageThumb';
import BrandSeriesEditorDrawer from '../components/BrandSeriesEditorDrawer';
import VariantEditorDrawer from '../components/VariantEditorDrawer';

const { Title, Text } = Typography;

const isTrue = (v) => v === true || v === 1 || v === '1';
const activeTag = (v) => <Tag color={isTrue(v) ? 'green' : 'default'}>{isTrue(v) ? 'Yes' : 'No'}</Tag>;

/**
 * Two-level brand management: a Brand Series table whose rows expand to the
 * variants in that series (filtered client-side by series_id, since the variants
 * list is flat/unfiltered). Series delete CASCADES to its variants — the confirm
 * warns hard and names the count.
 *
 * The series itself gates nothing: plan entitlement and business adoption attach
 * to a VARIANT. Creating a variant needs `variants` permission, editing the
 * series needs `brand_series` — so the two are checked separately.
 */
export default function BrandSeriesPage() {
  const perms = usePermissions();
  const { message, modal } = App.useApp();

  const canCreateSeries = perms.can('brand_series', 'create');
  const canUpdateSeries = perms.can('brand_series', 'update');
  const canDeleteSeries = perms.can('brand_series', 'delete');
  const canCreateVariant = perms.can('variants', 'create');
  const canUpdateVariant = perms.can('variants', 'update');
  const canDeleteVariant = perms.can('variants', 'delete');

  const [search, setSearch] = useState('');
  const [seriesEditor, setSeriesEditor] = useState({ open: false, record: null });
  const [variantEditor, setVariantEditor] = useState({ open: false, variant: null, seriesId: null });

  const seriesQuery = adminApi.endpoints.brandSeriesList.useQuery();
  const variantsQuery = adminApi.endpoints.variantsList.useQuery();
  const [removeSeries] = adminApi.endpoints.brandSeriesRemove.useMutation();
  const [removeVariant] = adminApi.endpoints.variantsRemove.useMutation();

  const seriesList = useMemo(() => seriesQuery.data || [], [seriesQuery.data]);
  const variants = useMemo(() => variantsQuery.data || [], [variantsQuery.data]);

  const variantsBySeries = useMemo(() => {
    const map = new Map();
    for (const v of variants) {
      if (!map.has(v.series_id)) map.set(v.series_id, []);
      map.get(v.series_id).push(v);
    }
    return map;
  }, [variants]);

  const rows = useMemo(() => {
    if (!search.trim()) return seriesList;
    const q = search.toLowerCase();
    return seriesList.filter(
      (s) => s.name?.toLowerCase().includes(q) || s.caption?.toLowerCase().includes(q),
    );
  }, [seriesList, search]);

  const reloadAll = () => {
    seriesQuery.refetch();
    variantsQuery.refetch();
  };

  const deleteSeries = async (series) => {
    try {
      await removeSeries(series.uid).unwrap();
      message.success('Brand series deleted');
    } catch {
      // error notification handled by baseQuery
    }
  };

  const onDeleteSeries = (series) => {
    const count = (variantsBySeries.get(series.id) || []).length;
    if (count > 0) {
      modal.confirm({
        title: `Delete brand series "${series.name}"?`,
        icon: <ExclamationCircleFilled style={{ color: '#ff4d4f' }} />,
        width: 460,
        content: (
          <div>
            <p style={{ marginTop: 0 }}>
              This series contains <strong>{count}</strong> variant{count > 1 ? 's' : ''}. Deleting
              the series will <strong>permanently delete all of them</strong> (cascade). This cannot
              be undone.
            </p>
          </div>
        ),
        okText: `Delete series + ${count} variant${count > 1 ? 's' : ''}`,
        okButtonProps: { danger: true },
        onOk: () => deleteSeries(series),
      });
    } else {
      modal.confirm({
        title: `Delete brand series "${series.name}"?`,
        content: 'This series has no variants.',
        okText: 'Delete',
        okButtonProps: { danger: true },
        onOk: () => deleteSeries(series),
      });
    }
  };

  const onDeleteVariant = (variant) => {
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

  const seriesColumns = [
    {
      title: 'Icon',
      dataIndex: 'icon_s3_key',
      key: 'icon',
      width: 70,
      render: (k) => <ImageThumb k={k} />,
    },
    {
      title: 'Series',
      dataIndex: 'name',
      key: 'name',
      render: (v, s) => (
        <div>
          <Text strong>{v}</Text>
          {s.caption && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {s.caption}
              </Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Slug',
      dataIndex: 'slug',
      key: 'slug',
      width: 160,
      render: (v) => (v ? <Text code>{v}</Text> : <Text type="secondary">—</Text>),
    },
    {
      title: 'Variants',
      key: 'variantCount',
      width: 90,
      render: (_v, s) => (variantsBySeries.get(s.id) || []).length,
    },
    {
      title: 'Order',
      dataIndex: 'display_order',
      key: 'display_order',
      width: 80,
      render: (v) => v ?? 0,
    },
    { title: 'Active', dataIndex: 'is_active', key: 'is_active', width: 80, render: activeTag },
    {
      title: 'Actions',
      key: 'actions',
      width: 110,
      fixed: 'right',
      render: (_v, series) => (
        <Space size="small">
          {canUpdateSeries && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setSeriesEditor({ open: true, record: series })}
              title="Edit series"
            />
          )}
          {canDeleteSeries && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onDeleteSeries(series)}
              title="Delete series"
            />
          )}
        </Space>
      ),
    },
  ];

  const renderVariantsPanel = (series) => {
    const seriesVariants = variantsBySeries.get(series.id) || [];
    return (
      <div style={{ padding: '4px 8px 8px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <Text type="secondary">Variants in {series.name}</Text>
          {canCreateVariant && (
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setVariantEditor({ open: true, variant: null, seriesId: series.id })}
            >
              New Variant
            </Button>
          )}
        </div>
        <Table
          rowKey="uid"
          size="small"
          pagination={false}
          dataSource={seriesVariants}
          locale={{ emptyText: 'No variants in this series' }}
          columns={[
            {
              title: 'Thumbnail',
              dataIndex: 'thumbnail_s3_key',
              key: 'thumb',
              width: 90,
              render: (k) => <ImageThumb k={k} />,
            },
            { title: 'Name', dataIndex: 'name', key: 'name' },
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
              title: 'Order',
              dataIndex: 'display_order',
              key: 'order',
              width: 80,
              render: (v) => v ?? 0,
            },
            { title: 'Active', dataIndex: 'is_active', key: 'active', width: 80, render: activeTag },
            {
              title: 'Actions',
              key: 'actions',
              width: 110,
              render: (_v, variant) => (
                <Space size="small">
                  {canUpdateVariant && (
                    <Button
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => setVariantEditor({ open: true, variant, seriesId: series.id })}
                      title="Edit variant"
                    />
                  )}
                  {canDeleteVariant && (
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => onDeleteVariant(variant)}
                      title="Delete variant"
                    />
                  )}
                </Space>
              ),
            },
          ]}
        />
      </div>
    );
  };

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
          Brand Series
        </Title>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="Search series"
            style={{ width: 240 }}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={setSearch}
          />
          <Button icon={<ReloadOutlined />} onClick={reloadAll} loading={variantsQuery.isFetching}>
            Reload
          </Button>
          {canCreateSeries && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setSeriesEditor({ open: true, record: null })}
            >
              New Brand Series
            </Button>
          )}
        </Space>
      </div>

      <Table
        rowKey="uid"
        columns={seriesColumns}
        dataSource={rows}
        loading={seriesQuery.isLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        size="middle"
        expandable={{ expandedRowRender: renderVariantsPanel }}
      />

      <BrandSeriesEditorDrawer
        open={seriesEditor.open}
        series={seriesEditor.record}
        onClose={() => setSeriesEditor({ open: false, record: null })}
        onSaved={reloadAll}
      />

      <VariantEditorDrawer
        open={variantEditor.open}
        variant={variantEditor.variant}
        defaultSeriesId={variantEditor.seriesId}
        onClose={() => setVariantEditor({ open: false, variant: null, seriesId: null })}
        onSaved={reloadAll}
      />
    </div>
  );
}
