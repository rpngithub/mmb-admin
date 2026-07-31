import { useEffect, useMemo, useState } from 'react';
import {
  Table,
  Typography,
  Space,
  Input,
  Button,
  Tag,
  Select,
  Switch,
  Form,
  Drawer,
  App,
} from 'antd';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { adminApi } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import ImageThumb from '../components/ImageThumb';
import AssetFileUpload from '../components/AssetFileUpload';
import TagSelect from '../components/TagSelect';

const { Title, Text } = Typography;

const ASSET_TYPES = ['icon', 'emoji', 'shape', 'font', 'audio', 'video', 'animated', 'bg'];
const IMAGE_TYPES = new Set(['icon', 'emoji', 'shape', 'bg']);
const STATUSES = ['active', 'inactive'];

const isTrue = (v) => v === true || v === 1 || v === '1';
const typeOptions = ASSET_TYPES.map((t) => ({ label: t, value: t }));

/**
 * Assets table driven by the server filters (category_id / asset_type / status),
 * with a size-aware upload widget and M2M tag editing (loaded via …/tags, saved
 * via PUT …/tags). The themes/categories permission model applies: one `assets`
 * domain gates everything.
 */
export default function AssetsPage() {
  const perms = usePermissions();
  const { message, modal } = App.useApp();

  const canCreate = perms.can('assets', 'create');
  const canUpdate = perms.can('assets', 'update');
  const canDelete = perms.can('assets', 'delete');

  const [filters, setFilters] = useState({ category_id: null, asset_type: null, status: null });
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState({ open: false, asset: null });

  const queryParams = useMemo(
    () => ({
      category_id: filters.category_id ?? undefined,
      asset_type: filters.asset_type ?? undefined,
      status: filters.status ?? undefined,
    }),
    [filters],
  );

  const assetsQuery = adminApi.endpoints.assetsFiltered.useQuery(queryParams);
  const categoriesQuery = adminApi.endpoints.assetCategoriesList.useQuery();
  const [removeAsset] = adminApi.endpoints.assetsRemove.useMutation();

  const assets = useMemo(() => assetsQuery.data || [], [assetsQuery.data]);
  const categories = useMemo(() => categoriesQuery.data || [], [categoriesQuery.data]);

  const categoryName = useMemo(() => {
    const map = new Map();
    categories.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [categories]);

  const rows = useMemo(() => {
    if (!search.trim()) return assets;
    const q = search.toLowerCase();
    return assets.filter((a) => a.name?.toLowerCase().includes(q));
  }, [assets, search]);

  const onDelete = (asset) => {
    modal.confirm({
      title: `Delete asset "${asset.name}"?`,
      content: 'Its tag links are removed (the tags themselves are kept). This cannot be undone.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeAsset(asset.uid).unwrap();
          message.success('Asset deleted');
        } catch {
          // error notification handled by baseQuery
        }
      },
    });
  };

  const columns = [
    {
      title: 'Preview',
      key: 'preview',
      width: 70,
      render: (_v, a) =>
        IMAGE_TYPES.has(a.asset_type) ? (
          <ImageThumb k={a.s3_key} size={40} />
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    { title: 'Name', dataIndex: 'name', key: 'name', render: (v) => <Text strong>{v}</Text> },
    {
      title: 'Type',
      dataIndex: 'asset_type',
      key: 'asset_type',
      width: 100,
      render: (v) => <Tag>{v}</Tag>,
    },
    {
      title: 'Category',
      dataIndex: 'category_id',
      key: 'category',
      render: (id) =>
        id == null ? <Text type="secondary">—</Text> : categoryName.get(id) || `#${id}`,
    },
    {
      title: 'Premium',
      dataIndex: 'is_premium',
      key: 'is_premium',
      width: 90,
      render: (v) => (isTrue(v) ? <Tag color="gold">Premium</Tag> : <Text type="secondary">—</Text>),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v) => <Tag color={v === 'active' ? 'green' : 'default'}>{v || '—'}</Tag>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 110,
      fixed: 'right',
      render: (_v, asset) => (
        <Space size="small">
          {canUpdate && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditor({ open: true, asset })}
              title="Edit"
            />
          )}
          {canDelete && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onDelete(asset)}
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
          Assets
        </Title>
        <Space wrap>
          <Select
            allowClear
            placeholder="All categories"
            style={{ width: 180 }}
            value={filters.category_id ?? undefined}
            onChange={(v) => setFilters((f) => ({ ...f, category_id: v ?? null }))}
            showSearch
            optionFilterProp="label"
            options={categories.map((c) => ({ label: c.name, value: c.id }))}
          />
          <Select
            allowClear
            placeholder="All types"
            style={{ width: 140 }}
            value={filters.asset_type ?? undefined}
            onChange={(v) => setFilters((f) => ({ ...f, asset_type: v ?? null }))}
            options={typeOptions}
          />
          <Select
            allowClear
            placeholder="Any status"
            style={{ width: 130 }}
            value={filters.status ?? undefined}
            onChange={(v) => setFilters((f) => ({ ...f, status: v ?? null }))}
            options={STATUSES.map((s) => ({ label: s, value: s }))}
          />
          <Input.Search
            allowClear
            placeholder="Search by name"
            style={{ width: 200 }}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={setSearch}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={assetsQuery.refetch}
            loading={assetsQuery.isFetching}
          >
            Reload
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setEditor({ open: true, asset: null })}
            >
              New Asset
            </Button>
          )}
        </Space>
      </div>

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={rows}
        loading={assetsQuery.isLoading}
        scroll={{ x: 'max-content' }}
        size="middle"
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} total` }}
      />

      <AssetEditor
        open={editor.open}
        asset={editor.asset}
        categories={categories}
        onClose={() => setEditor({ open: false, asset: null })}
        onSaved={assetsQuery.refetch}
      />
    </div>
  );
}

function AssetEditor({ open, asset, categories, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const isEdit = Boolean(asset);

  const [createTrigger] = adminApi.endpoints.assetsCreate.useMutation();
  const [updateTrigger] = adminApi.endpoints.assetsUpdate.useMutation();
  const [setTags] = adminApi.endpoints.assetSetTags.useMutation();

  // Tags are not in the list payload — fetch them for the asset being edited.
  const { data: tagData } = adminApi.endpoints.assetTags.useQuery(asset?.uid, {
    skip: !open || !asset?.uid,
  });

  const assetType = Form.useWatch('asset_type', form);

  useEffect(() => {
    if (!open) return;
    if (asset) {
      form.setFieldsValue({
        name: asset.name,
        asset_type: asset.asset_type,
        category_id: asset.category_id ?? undefined,
        s3_key: asset.s3_key ?? undefined,
        is_premium: isTrue(asset.is_premium),
        status: asset.status || 'active',
        tag_ids: [],
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ is_premium: false, status: 'active', tag_ids: [] });
    }
  }, [open, asset, form]);

  // Populate tags once they arrive from …/tags.
  useEffect(() => {
    if (open && asset && Array.isArray(tagData?.Tags)) {
      form.setFieldsValue({ tag_ids: tagData.Tags.map((t) => t.id) });
    }
  }, [open, asset, tagData, form]);

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const body = {
      name: values.name.trim(),
      asset_type: values.asset_type,
      category_id: values.category_id ?? null,
      s3_key: values.s3_key,
      is_premium: values.is_premium ? 1 : 0,
      status: values.status,
    };

    setSubmitting(true);
    try {
      let uid;
      if (isEdit) {
        await updateTrigger({ id: asset.uid, body }).unwrap();
        uid = asset.uid;
      } else {
        const created = await createTrigger(body).unwrap();
        uid = created.uid;
      }
      // tag_ids are never part of the asset body — set via PUT …/tags.
      if (uid) {
        try {
          await setTags({ uid, tag_ids: values.tag_ids || [] }).unwrap();
        } catch {
          message.error('Asset saved, but updating its tags failed.');
        }
      }
      message.success(`Asset ${isEdit ? 'updated' : 'created'}`);
      onSaved?.();
      onClose();
    } catch {
      // create/update error already surfaced by baseQuery
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      title={isEdit ? `Edit "${asset?.name}"` : 'New Asset'}
      open={open}
      onClose={onClose}
      width={620}
      destroyOnClose
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="primary" loading={submitting} onClick={handleSubmit}>
              Save
            </Button>
          </Space>
        </div>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Name is required' }]}>
          <Input placeholder="Asset name" />
        </Form.Item>

        <Form.Item
          name="asset_type"
          label="Asset type"
          rules={[{ required: true, message: 'Asset type is required' }]}
          extra="Determines the upload slot and how the file is previewed."
        >
          <Select options={typeOptions} placeholder="Select a type" />
        </Form.Item>

        <Form.Item
          name="s3_key"
          label="File"
          rules={[{ required: true, message: 'A file is required' }]}
        >
          <AssetFileUpload assetType={assetType} />
        </Form.Item>

        <Form.Item name="category_id" label="Category">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Uncategorized"
            options={categories.map((c) => ({ label: c.name, value: c.id }))}
          />
        </Form.Item>

        <Space size="large" wrap>
          <Form.Item name="is_premium" label="Premium" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="status" label="Status" rules={[{ required: true }]}>
            <Select style={{ width: 160 }} options={STATUSES.map((s) => ({ label: s, value: s }))} />
          </Form.Item>
        </Space>

        <Form.Item name="tag_ids" label="Tags">
          <TagSelect />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
