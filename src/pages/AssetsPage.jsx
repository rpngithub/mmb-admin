import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Table,
  Tooltip,
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
  ImportOutlined,
  CopyOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { adminApi } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import ImageThumb from '../components/ImageThumb';
import AssetFileUpload from '../components/AssetFileUpload';
import ImageUploadField from '../components/ImageUploadField';
import ImportDrawer from '../components/ImportDrawer';
import TagSelect from '../components/TagSelect';

const { Title, Text, Paragraph } = Typography;

const ASSET_TYPES = ['icon', 'emoji', 'shape', 'font', 'audio', 'video', 'animated', 'bg'];
const IMAGE_TYPES = new Set(['icon', 'emoji', 'shape', 'bg']);
const STATUSES = ['active', 'inactive'];

const isTrue = (v) => v === true || v === 1 || v === '1';
const typeOptions = ASSET_TYPES.map((t) => ({ label: t, value: t }));

/**
 * A premium asset is served to non-paying viewers WITHOUT its `s3_key` — only
 * `thumbnail_s3_key` survives the lock. No preview therefore means an empty
 * card in the app, for exactly the people being sold to.
 */
const needsPreview = (a) => isTrue(a.is_premium) && !a.thumbnail_s3_key;

const NO_PREVIEW_HINT =
  'Users who have not paid see an empty card for this asset. Upload a small, watermarked preview.';

/**
 * Assets table driven by the server filters (category_id / asset_type / status),
 * with a size-aware upload widget and M2M tag editing (loaded via …/tags, saved
 * via PUT …/tags). The variants/categories permission model applies: one `assets`
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
  // Client-side: there is no is_premium filter server-side, and the list is
  // unpaginated, so the whole "no preview" work queue is derived from what we
  // already hold.
  const [onlyNoPreview, setOnlyNoPreview] = useState(false);
  const [editor, setEditor] = useState({ open: false, asset: null });
  const [importOpen, setImportOpen] = useState(false);

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

  const noPreviewCount = useMemo(() => assets.filter(needsPreview).length, [assets]);

  const rows = useMemo(() => {
    let out = assets;
    if (onlyNoPreview) out = out.filter(needsPreview);
    const q = search.trim().toLowerCase();
    if (q) out = out.filter((a) => a.name?.toLowerCase().includes(q));
    return out;
  }, [assets, search, onlyNoPreview]);

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

  /**
   * Build an import sheet from what's already here without retyping keys —
   * `s3_key` is the column the assets importer matches on.
   */
  const copyKey = async (key) => {
    try {
      await navigator.clipboard.writeText(key);
      message.success('S3 key copied');
    } catch {
      message.error('Could not copy — select the key in the editor instead.');
    }
  };

  const columns = [
    {
      // Same rule the app uses — `thumbnail_s3_key || s3_key`. The difference:
      // an admin response is never locked, so a premium row falling back to its
      // real file shows something no unpaid user will ever see. Dimmed + hinted
      // rather than passed off as the truth.
      title: 'Preview',
      key: 'preview',
      width: 70,
      render: (_v, a) => {
        const key = a.thumbnail_s3_key || (IMAGE_TYPES.has(a.asset_type) ? a.s3_key : null);
        if (!key) return <Text type="secondary">—</Text>;
        const thumb = <ImageThumb k={key} size={40} />;
        if (!needsPreview(a)) return thumb;
        return (
          <Tooltip title={`This is the real file, shown to admins only. ${NO_PREVIEW_HINT}`}>
            <span style={{ opacity: 0.4, display: 'inline-flex' }}>{thumb}</span>
          </Tooltip>
        );
      },
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
      width: 170,
      render: (v, a) =>
        isTrue(v) ? (
          <Space size={4} wrap>
            <Tag color="gold">Premium</Tag>
            {!a.thumbnail_s3_key && (
              <Tooltip title={NO_PREVIEW_HINT}>
                <Tag color="orange" icon={<WarningOutlined />} style={{ marginInlineEnd: 0 }}>
                  No preview
                </Tag>
              </Tooltip>
            )}
          </Space>
        ) : (
          <Text type="secondary">—</Text>
        ),
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
      width: 150,
      fixed: 'right',
      render: (_v, asset) => (
        <Space size="small">
          {asset.s3_key && (
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() => copyKey(asset.s3_key)}
              title="Copy S3 key"
            />
          )}
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
          <Tooltip title="Premium assets with no preview image — the ones showing an empty card in the app.">
            <Button
              icon={<WarningOutlined />}
              danger={onlyNoPreview}
              type={onlyNoPreview ? 'primary' : 'default'}
              onClick={() => setOnlyNoPreview((v) => !v)}
            >
              No preview ({noPreviewCount})
            </Button>
          </Tooltip>
          <Button
            icon={<ReloadOutlined />}
            onClick={assetsQuery.refetch}
            loading={assetsQuery.isFetching}
          >
            Reload
          </Button>
          {/* Registering files already uploaded to S3 is a create — same gate. */}
          {canCreate && (
            <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
              Import CSV
            </Button>
          )}
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

      {/* The work queue. Premium assets are withheld from non-paying users —
          without a preview there is literally nothing for the app to draw, so
          this backlog is the feature, not a per-row curiosity. Counted over the
          current server filters, so it can be cleared category by category. */}
      {noPreviewCount > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            onlyNoPreview
              ? `Showing ${noPreviewCount} premium ${noPreviewCount === 1 ? 'asset' : 'assets'} with no preview`
              : `${noPreviewCount} premium ${noPreviewCount === 1 ? 'asset has' : 'assets have'} no preview`
          }
          description="They render as an empty card for everyone who has not paid. Upload a small, watermarked preview on each — or fill the thumbnail_s3_key column and re-import the sheet."
          action={
            <Button size="small" onClick={() => setOnlyNoPreview((v) => !v)}>
              {onlyNoPreview ? 'Show all' : 'Show them'}
            </Button>
          }
        />
      )}

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

      {/* A committed import already invalidates the assets list tag; the
          refetch covers this screen's server-filtered query explicitly. A dry
          run writes nothing, so the drawer never fires this for one. */}
      <ImportDrawer
        open={importOpen}
        entity="assets"
        onClose={() => setImportOpen(false)}
        onImported={assetsQuery.refetch}
      />
    </div>
  );
}

function AssetEditor({ open, asset, categories, onClose, onSaved }) {
  const { message, modal } = App.useApp();
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
  const isPremium = Boolean(Form.useWatch('is_premium', form));
  const thumbnailKey = Form.useWatch('thumbnail_s3_key', form);

  useEffect(() => {
    if (!open) return;
    if (asset) {
      form.setFieldsValue({
        name: asset.name,
        asset_type: asset.asset_type,
        category_id: asset.category_id ?? undefined,
        s3_key: asset.s3_key ?? undefined,
        thumbnail_s3_key: asset.thumbnail_s3_key ?? undefined,
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
    // The server accepts a premium asset with no preview, and there is nothing
    // it could infer one from — so this is the only place the gap gets caught.
    if (values.is_premium && !values.thumbnail_s3_key) {
      const proceed = await new Promise((resolve) => {
        modal.confirm({
          title: 'Save this premium asset with no preview?',
          content:
            'Its file is withheld from anyone who has not paid, and there is no preview to show instead — the app will render an empty card. It stays in the "No preview" queue until one is uploaded.',
          okText: 'Save anyway',
          cancelText: 'Add a preview',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!proceed) return;
    }

    const thumbnail = values.thumbnail_s3_key?.trim();
    const body = {
      name: values.name.trim(),
      asset_type: values.asset_type,
      category_id: values.category_id ?? null,
      s3_key: values.s3_key,
      is_premium: values.is_premium ? 1 : 0,
      status: values.status,
    };
    // Optional + nullable: send the key when there is one, send null only to
    // clear a stored key, and otherwise leave the field out of the payload.
    if (thumbnail) body.thumbnail_s3_key = thumbnail;
    else if (isEdit && asset.thumbnail_s3_key) body.thumbnail_s3_key = null;

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
      width={720}
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

        {/* Two image slots, always labelled. An unlabelled pair is how the
            original artwork ends up uploaded as its own "preview". */}
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Form.Item
            name="s3_key"
            label="Asset file"
            style={{ flex: '1 1 260px' }}
            extra="The real deliverable. Withheld from non-paying users on a premium asset."
            rules={[{ required: true, message: 'A file is required' }]}
          >
            <AssetFileUpload assetType={assetType} />
          </Form.Item>

          <Form.Item
            name="thumbnail_s3_key"
            label="Preview shown to non-paying users"
            style={{ flex: '1 1 260px' }}
            tooltip="Returned to everyone — guests, free plans, paid plans — whatever the asset is. An mp3 or a Lottie file still needs an image here."
            extra="Upload a small, watermarked, flattened copy. Never the original artwork."
            rules={[
              // The server stores whatever key it is given: it cannot tell a
              // 150px watermarked preview from a second copy of the artwork.
              ({ getFieldValue }) => ({
                validator: (_r, v) =>
                  v && v === getFieldValue('s3_key')
                    ? Promise.reject(
                        new Error(
                          'That is the asset file itself — using it as the preview hands the artwork to people who have not paid.',
                        ),
                      )
                    : Promise.resolve(),
              }),
            ]}
          >
            <ImageUploadField slot="asset_thumbnail" accept="image/*" />
          </Form.Item>
        </div>

        {isPremium && !thumbnailKey && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 24 }}
            message="This premium asset has no preview"
            description={
              <Paragraph style={{ marginBottom: 0 }}>
                Its file is not sent to anyone who has not paid, so the app has nothing to draw and
                shows an empty card. A preview is what sells it.
              </Paragraph>
            }
          />
        )}

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
