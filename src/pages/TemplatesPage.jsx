import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Table, Typography, Space, Input, Button, Select, Switch, Tag, Tooltip, Checkbox, App } from 'antd';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PictureOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAppDispatch } from '../app/hooks';
import { adminApi } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import {
  STATUS_COLORS,
  STATUSES,
  TEMPLATE_TYPES,
  TEXT_FREE_LABEL,
  isTrue,
  num,
  languageLabel,
  sizeLabel,
} from '../lib/templateFamilies';
import ImageThumb from '../components/ImageThumb';
import { useConfirmFamilyDelete } from '../components/templateFamilyDelete';

const { Title, Text } = Typography;

const DEFAULT_PAGE_SIZE = 30;

// Filters live in the URL (e.g. ?missing_default_size=1), so Back from a design
// returns to the same view.
// Every key is omitted when its filter is "All".
const NUMERIC_KEYS = ['category_id', 'industry_id', 'variant_id', 'is_premium', 'is_popular'];
const TEXT_KEYS = ['search', 'status', 'template_type'];
const TOGGLE_KEYS = ['single_version', 'missing_default_size'];

function readFilters(sp) {
  const f = {};
  TEXT_KEYS.forEach((k) => {
    f[k] = sp.get(k) || undefined;
  });
  NUMERIC_KEYS.forEach((k) => {
    const v = sp.get(k);
    f[k] = v === null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v);
  });
  TOGGLE_KEYS.forEach((k) => {
    f[k] = sp.get(k) === '1';
  });
  f.tags = (sp.get('tags') || '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  return f;
}

function MissingThumb() {
  return (
    <Tooltip title="No thumbnail — upload a bundle for an English (or text-free) version">
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

/** "3 languages · 4 sizes" (or "Text-free · 4 sizes"), names in the tooltip. */
function CoverageCell({ row }) {
  const languages = Array.isArray(row.languages) ? row.languages : [];
  const sizes = Array.isArray(row.sizes) ? row.sizes : [];
  const versions = num(row.version_count);
  const live = num(row.active_version_count);
  const langText = isTrue(row.text_free)
    ? TEXT_FREE_LABEL
    : `${languages.length} language${languages.length === 1 ? '' : 's'}`;
  const sizeText = `${sizes.length} size${sizes.length === 1 ? '' : 's'}`;
  const tip = (
    <div>
      {languages.length > 0 && <div>Languages: {languages.map(languageLabel).join(', ')}</div>}
      {sizes.length > 0 && <div>Sizes: {sizes.map(sizeLabel).join(', ')}</div>}
      <div>
        {live} of {versions} version{versions === 1 ? '' : 's'} active
      </div>
    </div>
  );
  return (
    <Tooltip title={tip}>
      <Space direction="vertical" size={0}>
        <Text>
          {versions === 0 ? 'No versions' : `${langText} · ${sizeText}`}
        </Text>
        {versions > 0 && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {live}/{versions} active
          </Text>
        )}
      </Space>
    </Tooltip>
  );
}

function ReadinessCell({ readiness }) {
  const list = Array.isArray(readiness) ? readiness : [];
  if (!list.length) return <Tag color="green">Ready</Tag>;
  return (
    <Tooltip
      title={
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {list.map((r, i) => (
            <li key={`${r.field}-${i}`}>{r.message}</li>
          ))}
        </ul>
      }
    >
      <Tag color="warning">{list.length} missing</Tag>
    </Tooltip>
  );
}

export default function TemplatesPage() {
  const perms = usePermissions();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const confirmDelete = useConfirmFamilyDelete();
  const [searchParams, setSearchParams] = useSearchParams();

  const canCreate = perms.can('templates', 'create');
  const canUpdate = perms.can('templates', 'update');
  const canDelete = perms.can('templates', 'delete');

  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.max(1, Number(searchParams.get('limit')) || DEFAULT_PAGE_SIZE);

  // `${uid}:${field}` keys with a flag PATCH in flight.
  const [flagBusy, setFlagBusy] = useState(() => new Set());

  const { data: categories } = adminApi.endpoints.templateCategoriesList.useQuery();
  const { data: industries } = adminApi.endpoints.businessCategoriesList.useQuery();
  const { data: variants } = adminApi.endpoints.variantsList.useQuery();
  const { data: tags } = adminApi.endpoints.tagsList.useQuery();

  const queryArg = useMemo(
    () => ({
      search: filters.search,
      status: filters.status,
      template_type: filters.template_type,
      category_id: filters.category_id,
      industry_id: filters.industry_id,
      variant_id: filters.variant_id,
      tags: filters.tags.length ? filters.tags.join(',') : undefined,
      is_premium: filters.is_premium,
      is_popular: filters.is_popular,
      single_version: filters.single_version ? 1 : undefined,
      missing_default_size: filters.missing_default_size ? 1 : undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    [filters, page, pageSize],
  );

  const { data, isLoading, isFetching, refetch } =
    adminApi.endpoints.templateFamiliesList.useQuery(queryArg);
  const [setFlag] = adminApi.endpoints.templateFamilySetFlag.useMutation();

  const rows = data?.items || [];
  const total = data?.total || 0;

  const updateParams = (mutate) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace: true });
  };

  const setFilter = (key, value) =>
    updateParams((sp) => {
      const empty =
        value === undefined ||
        value === null ||
        value === '' ||
        value === false ||
        (Array.isArray(value) && value.length === 0);
      if (empty) sp.delete(key);
      else if (Array.isArray(value)) sp.set(key, value.join(','));
      else if (value === true) sp.set(key, '1');
      else sp.set(key, String(value));
      sp.delete('page');
    });

  /**
   * Premium / Popular quick-toggle: flip the row in the cached page right away,
   * PATCH, then merge the returned family in. Nothing refetches on success; on
   * failure the flip is undone.
   */
  const onToggleFlag = async (record, field, checked) => {
    const key = `${record.uid}:${field}`;
    if (flagBusy.has(key)) return;
    setFlagBusy((s) => new Set(s).add(key));
    const patch = dispatch(
      adminApi.util.updateQueryData('templateFamiliesList', queryArg, (draft) => {
        const row = draft.items.find((d) => d.uid === record.uid);
        if (row) row[field] = checked ? 1 : 0;
      }),
    );
    try {
      const updated = await setFlag({ uid: record.uid, field, value: checked }).unwrap();
      if (updated && typeof updated === 'object') {
        dispatch(
          adminApi.util.updateQueryData('templateFamiliesList', queryArg, (draft) => {
            const i = draft.items.findIndex((d) => d.uid === record.uid);
            // Only the flag itself: a PATCH response may not carry the list's
            // computed columns (languages, sizes, readiness…).
            if (i !== -1 && field in updated) draft.items[i][field] = updated[field];
          }),
        );
      }
    } catch (err) {
      patch.undo();
      if (err?.status === 404) {
        message.warning(err?.message || 'That design no longer exists.');
        dispatch(adminApi.util.invalidateTags([{ type: 'TemplateFamily', id: 'LIST' }]));
      } else {
        message.error(err?.message || 'Could not update the flag.');
      }
    } finally {
      setFlagBusy((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  };

  const flagSwitch = (field, label) => (v, record) => (
    <Switch
      size="small"
      checked={isTrue(v)}
      disabled={!canUpdate}
      loading={flagBusy.has(`${record.uid}:${field}`)}
      onChange={(checked) => onToggleFlag(record, field, checked)}
      aria-label={`${label}: ${record.name}`}
    />
  );

  const open = (uid) => navigate(`/templates/${uid}`);

  const columns = [
    {
      title: 'Thumb',
      dataIndex: 'thumbnail_s3_key',
      key: 'thumb',
      width: 70,
      render: (k) => <ImageThumb k={k} size={40} placeholder={<MissingThumb />} />,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (v, r) => (
        <Space direction="vertical" size={0}>
          <Button type="link" style={{ padding: 0, height: 'auto' }} onClick={() => open(r.uid)}>
            <Text strong>{v}</Text>
          </Button>
          {r.template_type && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {r.template_type}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Versions',
      key: 'coverage',
      width: 190,
      render: (_v, r) => <CoverageCell row={r} />,
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
      render: flagSwitch('is_premium', 'Premium'),
    },
    {
      // Editorial flag for the app's Popular shelf — hand-curated, independent
      // of the trending/views/downloads counters.
      title: (
        <Tooltip title="Shown on the Popular shelf in the app. Curated by you — not calculated from views or downloads.">
          Popular
        </Tooltip>
      ),
      dataIndex: 'is_popular',
      key: 'is_popular',
      width: 90,
      render: flagSwitch('is_popular', 'Popular'),
    },
    {
      title: (
        <Tooltip title="What still blocks publishing this design. A live design stays live when this changes — it just can't be republished until it's fixed.">
          Ready
        </Tooltip>
      ),
      dataIndex: 'readiness',
      key: 'readiness',
      width: 110,
      render: (v) => <ReadinessCell readiness={v} />,
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
          <Button size="small" icon={<EditOutlined />} onClick={() => open(record.uid)} title="Open" />
          {canDelete && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => confirmDelete(record)}
              title="Delete"
            />
          )}
        </Space>
      ),
    },
  ];

  const byId = (list) => (list || []).map((x) => ({ label: x.name, value: x.id }));
  const flagOptions = (on, off) => [
    { label: on, value: 1 },
    { label: off, value: 0 },
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
        <Space direction="vertical" size={0}>
          <Title level={4} style={{ margin: 0 }}>
            Designs
          </Title>
          <Text type="secondary">
            Each design groups its versions — one per language (or text-free) and size.
          </Text>
        </Space>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
            Reload
          </Button>
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/templates/new')}>
              New design
            </Button>
          )}
        </Space>
      </div>

      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search
          key={filters.search || ''}
          allowClear
          defaultValue={filters.search}
          placeholder="Search name"
          style={{ width: 200 }}
          onSearch={(v) => setFilter('search', v.trim())}
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
          value={filters.industry_id}
          onChange={(v) => setFilter('industry_id', v)}
          options={byId(industries)}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Variant"
          style={{ width: 150 }}
          value={filters.variant_id}
          onChange={(v) => setFilter('variant_id', v)}
          options={byId(variants)}
        />
        <Select
          allowClear
          mode="multiple"
          maxTagCount="responsive"
          optionFilterProp="label"
          placeholder="Tags (any)"
          style={{ minWidth: 180 }}
          value={filters.tags}
          onChange={(v) => setFilter('tags', v)}
          options={byId(tags)}
        />
        <Select
          allowClear
          placeholder="Premium"
          style={{ width: 120 }}
          value={filters.is_premium}
          onChange={(v) => setFilter('is_premium', v)}
          options={flagOptions('Premium', 'Free')}
        />
        <Select
          allowClear
          placeholder="Popular"
          style={{ width: 130 }}
          value={filters.is_popular}
          onChange={(v) => setFilter('is_popular', v)}
          options={flagOptions('Popular', 'Not popular')}
        />
      </Space>
      <Space wrap style={{ marginBottom: 16 }}>
        <Tooltip title="Designs with exactly one version — after the migration, most duplicates to merge are here.">
          <Checkbox
            checked={filters.single_version}
            onChange={(e) => setFilter('single_version', e.target.checked)}
          >
            Single-version only
          </Checkbox>
        </Tooltip>
        {/* Informational only: the default size is not a publish requirement. */}
        <Tooltip title="Designs with no English (or text-free) version in the default size (App Settings). These designs are still live; cards show their other sizes.">
          <Checkbox
            checked={filters.missing_default_size}
            onChange={(e) => setFilter('missing_default_size', e.target.checked)}
          >
            No default-size version <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
          </Checkbox>
        </Tooltip>
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
          pageSizeOptions: [10, 20, 30, 50, 100],
          showTotal: (t) => `${t} designs`,
          onChange: (p, ps) =>
            updateParams((sp) => {
              if (p > 1) sp.set('page', String(p));
              else sp.delete('page');
              if (ps !== DEFAULT_PAGE_SIZE) sp.set('limit', String(ps));
              else sp.delete('limit');
            }),
        }}
      />
    </div>
  );
}
