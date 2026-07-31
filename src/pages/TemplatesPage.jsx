import { useMemo, useState } from 'react';
import { Table, Typography, Space, Input, Button, Select, Tag, Tooltip, App } from 'antd';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTemplatesListQuery, useTemplateRemoveMutation, adminApi } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import { checkRowCompleteness } from '../lib/templateCompleteness';
import ImageThumb from '../components/ImageThumb';
import TemplateEditorDrawer from '../components/TemplateEditorDrawer';

const { Title, Text } = Typography;

const STATUS_COLORS = { active: 'green', inactive: 'default', draft: 'gold' };
const TEMPLATE_TYPES = ['image', 'video', 'animated'];
const STATUSES = ['active', 'inactive', 'draft'];
const isTrue = (v) => v === true || v === 1 || v === '1';

const EMPTY_FILTERS = {
  search: '',
  status: undefined,
  template_type: undefined,
  category_id: undefined,
  business_category_id: undefined,
  theme_id: undefined,
  size_id: undefined,
  tag_ids: [],
  is_premium: undefined,
};

/**
 * A template with no `thumbnail_s3_key` reads as an empty cell, which is easy to
 * miss — show it as a gap that needs filling instead. The key is only set when a
 * bundle is confirmed with a thumbnail chosen on the Bundle tab.
 */
function MissingThumb() {
  return (
    <Tooltip title="No thumbnail — pick one on the template's Bundle tab">
      <div
        style={{
          width: 40,
          height: 40,
          border: '1px dashed #d9d9d9',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#faad14',
        }}
      >
        <PictureOutlined />
      </div>
    </Tooltip>
  );
}

export default function TemplatesPage() {
  const perms = usePermissions();
  const { message, modal } = App.useApp();

  const canCreate = perms.can('templates', 'create');
  const canUpdate = perms.can('templates', 'update');
  const canDelete = perms.can('templates', 'delete');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [editor, setEditor] = useState({ open: false, uid: null });

  const { data: categories } = adminApi.endpoints.templateCategoriesList.useQuery();
  const { data: businessCategories } = adminApi.endpoints.businessCategoriesList.useQuery();
  const { data: themes } = adminApi.endpoints.themesList.useQuery();
  const { data: sizes } = adminApi.endpoints.templateSizesList.useQuery();
  const { data: tags } = adminApi.endpoints.tagsList.useQuery();

  const queryArg = useMemo(
    () => ({
      search: filters.search || undefined,
      status: filters.status,
      template_type: filters.template_type,
      category_id: filters.category_id,
      // Sent as industry_id (renamed from the deprecated business_category_id).
      industry_id: filters.business_category_id,
      theme_id: filters.theme_id,
      size_id: filters.size_id,
      tags: filters.tag_ids.length ? filters.tag_ids.join(',') : undefined,
      is_premium: filters.is_premium,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    [filters, page, pageSize],
  );

  const { data, isLoading, isFetching, refetch } = useTemplatesListQuery(queryArg);
  const [removeTemplate] = useTemplateRemoveMutation();

  const rows = data?.items || [];
  const total = data?.total || 0;

  const setFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const onDelete = (record) => {
    modal.confirm({
      title: `Delete "${record.name}"?`,
      content:
        'Hard delete. User projects keep working (template_id is nulled); all M2M links are removed.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeTemplate(record.uid).unwrap();
          message.success('Template deleted');
        } catch {
          // error notification handled by baseQuery
        }
      },
    });
  };

  const columns = [
    {
      title: 'Thumb',
      dataIndex: 'thumbnail_s3_key',
      key: 'thumb',
      width: 70,
      render: (k) => <ImageThumb k={k} size={40} placeholder={<MissingThumb />} />,
    },
    { title: 'Name', dataIndex: 'name', key: 'name', render: (v) => <Text strong>{v}</Text> },
    {
      title: 'Type',
      dataIndex: 'template_type',
      key: 'template_type',
      width: 100,
      render: (v) => (v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text>),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v) => <Tag color={STATUS_COLORS[v] || 'default'}>{v || '—'}</Tag>,
    },
    {
      title: 'Premium',
      dataIndex: 'is_premium',
      key: 'is_premium',
      width: 90,
      render: (v) => (isTrue(v) ? <Tag color="gold">Premium</Tag> : <Text type="secondary">—</Text>),
    },
    {
      title: 'Ready',
      key: 'ready',
      width: 110,
      render: (_v, record) => {
        const { complete, missing } = checkRowCompleteness(record);
        if (complete) return <Tag color="green">Ready</Tag>;
        return (
          <Tooltip title={`Missing: ${missing.join(', ')}`}>
            <Tag color="warning">Incomplete ({missing.length})</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: 'Updated',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 120,
      render: (v) => (v && dayjs(v).isValid() ? dayjs(v).format('YYYY-MM-DD') : '—'),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 110,
      fixed: 'right',
      render: (_v, record) => (
        <Space size="small">
          {canUpdate && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditor({ open: true, uid: record.uid })}
              title="Edit"
            />
          )}
          {canDelete && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onDelete(record)}
              title="Delete"
            />
          )}
        </Space>
      ),
    },
  ];

  const byId = (list, label = 'name') =>
    (list || []).map((x) => ({ label: x[label], value: x.id }));

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
          Templates
        </Title>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
            Reload
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setEditor({ open: true, uid: null })}
            >
              New Template
            </Button>
          )}
        </Space>
      </div>

      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          placeholder="Search name"
          style={{ width: 200 }}
          onSearch={(v) => setFilter('search', v)}
          onChange={(e) => {
            if (!e.target.value) setFilter('search', '');
          }}
        />
        <Select
          allowClear
          placeholder="Status"
          style={{ width: 120 }}
          value={filters.status}
          onChange={(v) => setFilter('status', v)}
          options={STATUSES.map((s) => ({ label: s, value: s }))}
        />
        <Select
          allowClear
          placeholder="Type"
          style={{ width: 120 }}
          value={filters.template_type}
          onChange={(v) => setFilter('template_type', v)}
          options={TEMPLATE_TYPES.map((t) => ({ label: t, value: t }))}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Category"
          style={{ width: 160 }}
          value={filters.category_id}
          onChange={(v) => setFilter('category_id', v)}
          options={byId(categories)}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Industry"
          style={{ width: 170 }}
          value={filters.business_category_id}
          onChange={(v) => setFilter('business_category_id', v)}
          options={byId(businessCategories)}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Theme"
          style={{ width: 150 }}
          value={filters.theme_id}
          onChange={(v) => setFilter('theme_id', v)}
          options={byId(themes)}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Size"
          style={{ width: 150 }}
          value={filters.size_id}
          onChange={(v) => setFilter('size_id', v)}
          options={byId(sizes)}
        />
        <Select
          allowClear
          mode="multiple"
          maxTagCount="responsive"
          optionFilterProp="label"
          placeholder="Tags (any)"
          style={{ minWidth: 180 }}
          value={filters.tag_ids}
          onChange={(v) => setFilter('tag_ids', v)}
          options={byId(tags)}
        />
        <Select
          allowClear
          placeholder="Premium"
          style={{ width: 120 }}
          value={filters.is_premium}
          onChange={(v) => setFilter('is_premium', v)}
          options={[
            { label: 'Premium', value: 1 },
            { label: 'Free', value: 0 },
          ]}
        />
      </Space>

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        scroll={{ x: 'max-content' }}
        size="middle"
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

      <TemplateEditorDrawer
        open={editor.open}
        uid={editor.uid}
        onClose={() => setEditor({ open: false, uid: null })}
        onSaved={refetch}
      />
    </div>
  );
}
