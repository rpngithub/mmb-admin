import { useEffect, useMemo, useState } from 'react';
import {
  Table,
  Typography,
  Space,
  Input,
  Button,
  Tag,
  Switch,
  InputNumber,
  TreeSelect,
  Form,
  Drawer,
  Modal,
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
import ImageUploadField from './ImageUploadField';
import ImageThumb from './ImageThumb';
import TagSelect from './TagSelect';
import RelatedIndustriesField from './RelatedIndustriesField';

const { Title, Text } = Typography;

const isTrue = (v) => v === true || v === 1 || v === '1';

// Order-sensitive id comparison — a drag-reorder alone is a real change.
const sameOrder = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ---- flat list → tree (children keyed by parent_id === id) ------------------
function toTree(rows) {
  const byId = new Map();
  rows.forEach((r) => byId.set(r.id, { ...r, children: [] }));
  const roots = [];
  byId.forEach((node) => {
    const pid = node.parent_id;
    if (pid != null && byId.has(pid)) byId.get(pid).children.push(node);
    else roots.push(node);
  });
  const strip = (n) => {
    if (n.children && n.children.length) n.children.forEach(strip);
    else delete n.children;
  };
  roots.forEach(strip);
  return roots;
}

// TreeSelect data for the parent picker. `excludeId` (and its descendants) are
// disabled so a category can't become its own ancestor.
function toParentTree(rows, excludeId) {
  const excluded = new Set();
  if (excludeId != null) {
    const childrenOf = new Map();
    rows.forEach((r) => {
      if (!childrenOf.has(r.parent_id)) childrenOf.set(r.parent_id, []);
      childrenOf.get(r.parent_id).push(r);
    });
    const stack = [excludeId];
    while (stack.length) {
      const id = stack.pop();
      excluded.add(id);
      (childrenOf.get(id) || []).forEach((c) => stack.push(c.id));
    }
  }
  const byId = new Map();
  rows.forEach((r) =>
    byId.set(r.id, { value: r.id, title: r.name, disabled: excluded.has(r.id), children: [] }),
  );
  const roots = [];
  rows.forEach((r) => {
    const node = byId.get(r.id);
    if (r.parent_id != null && byId.has(r.parent_id)) byId.get(r.parent_id).children.push(node);
    else roots.push(node);
  });
  return roots;
}

/**
 * Shared CRUD surface for the two hierarchical category resources (template &
 * business). Renders a tree table, an editor drawer with image-upload fields and
 * a parent picker, and a reparent-aware delete flow. Business categories add a
 * tag multi-select (persisted via the dedicated PUT …/tags route) and the
 * ordered "Related industries" block (PUT …/related).
 */
export default function CategoriesManager({
  resourceKey,
  singular,
  plural,
  permission,
  iconSlot,
  thumbnailSlot,
  hasImages = true,
  hasHomepage = false,
  hasTags = false,
  hasRelated = false,
  deleteNote,
}) {
  const perms = usePermissions();
  const { message, modal } = App.useApp();

  const canCreate = perms.can(permission, 'create');
  const canUpdate = perms.can(permission, 'update');
  const canDelete = perms.can(permission, 'delete');
  // Related industries live under the same permission domain as the rest of the
  // form: read to see the block, update to save it.
  const relatedRead = hasRelated && perms.canRead(permission);
  const relatedWrite = hasRelated && canUpdate;

  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState({ open: false, record: null });
  const [reparent, setReparent] = useState(null); // { record, children }

  const { data, isLoading, isFetching, refetch } =
    adminApi.endpoints[`${resourceKey}List`].useQuery();
  const [updateTrigger] = adminApi.endpoints[`${resourceKey}Update`].useMutation();
  const [removeTrigger] = adminApi.endpoints[`${resourceKey}Remove`].useMutation();

  const rows = useMemo(() => data || [], [data]);

  const searching = search.trim().length > 0;
  const dataSource = useMemo(() => {
    if (searching) {
      const q = search.toLowerCase();
      return rows.filter((r) => r.name?.toLowerCase().includes(q));
    }
    return toTree(rows);
  }, [rows, search, searching]);

  const doDelete = async (record) => {
    try {
      await removeTrigger(record.uid).unwrap();
      message.success(`${singular} deleted`);
    } catch {
      // error notification handled by baseQuery
    }
  };

  const onDeleteClick = (record) => {
    const children = rows.filter((r) => r.parent_id === record.id);
    if (children.length === 0) {
      modal.confirm({
        title: `Delete "${record.name}"?`,
        content: deleteNote,
        okText: 'Delete',
        okButtonProps: { danger: true },
        onOk: () => doDelete(record),
      });
    } else {
      setReparent({ record, children });
    }
  };

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name', render: (v) => <Text strong>{v}</Text> },
    // Read-only public URL key, server-generated from the name on create.
    {
      title: 'Slug',
      dataIndex: 'slug',
      key: 'slug',
      width: 180,
      render: (v) => (v ? <Text code>{v}</Text> : <Text type="secondary">—</Text>),
    },
  ];

  if (hasImages) {
    columns.push(
      {
        title: 'Icon',
        dataIndex: 'icon_s3_key',
        key: 'icon',
        width: 70,
        render: (k) => <ImageThumb k={k} />,
      },
      {
        title: 'Thumbnail',
        dataIndex: 'thumbnail_s3_key',
        key: 'thumbnail',
        width: 90,
        render: (k) => <ImageThumb k={k} />,
      },
    );
  }

  columns.push(
    {
      title: 'Order',
      dataIndex: 'display_order',
      key: 'display_order',
      width: 80,
      render: (v) => v ?? 0,
    },
    {
      title: 'Active',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      render: (v) => <Tag color={isTrue(v) ? 'green' : 'default'}>{isTrue(v) ? 'Yes' : 'No'}</Tag>,
    },
  );

  if (hasHomepage) {
    columns.push({
      title: 'Homepage',
      dataIndex: 'show_in_homepage',
      key: 'show_in_homepage',
      width: 100,
      render: (v) => (isTrue(v) ? <Tag color="blue">Shown</Tag> : <Text type="secondary">—</Text>),
    });
  }

  if (hasTags) {
    columns.push({
      title: 'Tags',
      dataIndex: 'Tags',
      key: 'tags',
      render: (tags) =>
        Array.isArray(tags) && tags.length ? (
          <span>
            {tags.slice(0, 5).map((t) => (
              <Tag key={t.id}>{t.name}</Tag>
            ))}
            {tags.length > 5 && <Tag>+{tags.length - 5}</Tag>}
          </span>
        ) : (
          <Text type="secondary">—</Text>
        ),
    });
  }

  if (canUpdate || canDelete) {
    columns.push({
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
              onClick={() => setEditor({ open: true, record })}
              title="Edit"
            />
          )}
          {canDelete && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onDeleteClick(record)}
              title="Delete"
            />
          )}
        </Space>
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
          {plural}
        </Title>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder={`Search ${plural.toLowerCase()}`}
            style={{ width: 240 }}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={setSearch}
          />
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
            Reload
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setEditor({ open: true, record: null })}
            >
              New {singular}
            </Button>
          )}
        </Space>
      </div>

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={dataSource}
        loading={isLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        size="middle"
        expandable={searching ? undefined : { defaultExpandAllRows: true }}
      />

      <CategoryEditor
        open={editor.open}
        record={editor.record}
        rows={rows}
        resourceKey={resourceKey}
        singular={singular}
        iconSlot={iconSlot}
        thumbnailSlot={thumbnailSlot}
        hasImages={hasImages}
        hasHomepage={hasHomepage}
        hasTags={hasTags}
        relatedRead={relatedRead}
        relatedWrite={relatedWrite}
        onClose={() => setEditor({ open: false, record: null })}
        onSaved={refetch}
      />

      <ReparentDeleteModal
        state={reparent}
        rows={rows}
        singular={singular}
        deleteNote={deleteNote}
        onClose={() => setReparent(null)}
        onReparentDelete={async (targetParentId) => {
          const { record, children } = reparent;
          try {
            await Promise.all(
              children.map((c) =>
                updateTrigger({ id: c.uid, body: { parent_id: targetParentId ?? null } }).unwrap(),
              ),
            );
            await removeTrigger(record.uid).unwrap();
            message.success(
              `${singular} deleted; ${children.length} child ${
                children.length > 1 ? 'categories' : 'category'
              } reparented`,
            );
            setReparent(null);
          } catch {
            // error notification handled by baseQuery
          }
        }}
        onDeleteAnyway={async () => {
          await doDelete(reparent.record);
          setReparent(null);
        }}
      />
    </div>
  );
}

// ---- editor drawer ---------------------------------------------------------

function CategoryEditor({
  open,
  record,
  rows,
  resourceKey,
  singular,
  iconSlot,
  thumbnailSlot,
  hasImages,
  hasHomepage,
  hasTags,
  relatedRead,
  relatedWrite,
  onClose,
  onSaved,
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const isEdit = Boolean(record);

  const [createTrigger] = adminApi.endpoints[`${resourceKey}Create`].useMutation();
  const [updateTrigger] = adminApi.endpoints[`${resourceKey}Update`].useMutation();
  const [setTags] = adminApi.endpoints.businessCategorySetTags.useMutation();
  const [setRelated] = adminApi.endpoints.businessCategorySetRelated.useMutation();
  const [refetchRows] = adminApi.endpoints[`${resourceKey}List`].useLazyQuery();

  // Related industries are a separate endpoint, so they live outside the Form:
  // `relatedIds` is the ordered payload, `relatedBaseline` is what the server
  // last confirmed (so a no-op PUT — which still writes an activity log — is
  // skipped). A new industry has no uid yet, so its GET is skipped and the
  // baseline is [].
  const [relatedIds, setRelatedIds] = useState([]);
  const [relatedBaseline, setRelatedBaseline] = useState([]);
  const [relatedError, setRelatedError] = useState(null);

  const { data: related, isFetching: relatedLoading } =
    adminApi.endpoints.businessCategoryRelated.useQuery(record?.uid, {
      skip: !open || !relatedRead || !record?.uid,
    });

  const parentTree = useMemo(() => toParentTree(rows, record?.id), [rows, record]);

  useEffect(() => {
    if (!open) return;
    if (record) {
      form.setFieldsValue({
        name: record.name,
        parent_id: record.parent_id ?? undefined,
        icon_s3_key: record.icon_s3_key ?? undefined,
        thumbnail_s3_key: record.thumbnail_s3_key ?? undefined,
        display_order: record.display_order ?? 0,
        is_active: isTrue(record.is_active),
        show_in_homepage: isTrue(record.show_in_homepage),
        tag_ids: Array.isArray(record.Tags) ? record.Tags.map((t) => t.id) : [],
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ is_active: true, display_order: 0, show_in_homepage: false, tag_ids: [] });
    }
  }, [open, record, form]);

  useEffect(() => {
    if (!open) return;
    setRelatedError(null);
    if (!record) {
      setRelatedIds([]);
      setRelatedBaseline([]);
    }
  }, [open, record]);

  useEffect(() => {
    if (!open || !record) return;
    // RelatedIndustries arrives already sorted in the curated order — take it as
    // given, never re-sort by name or id.
    const ids = (related?.RelatedIndustries || []).map((r) => r.id);
    setRelatedIds(ids);
    setRelatedBaseline(ids);
  }, [open, record, related]);

  /**
   * A 404 means one or more ids no longer exist — another admin deleted an
   * industry since these options were cached. It rejects the WHOLE batch, so
   * nothing was written and the saved block is still intact. Refetch the list,
   * drop the ids that went away, and name them.
   */
  const recoverStaleIds = async () => {
    let fresh;
    try {
      fresh = await refetchRows(undefined, false).unwrap();
    } catch {
      return null;
    }
    if (!Array.isArray(fresh)) return null;
    const alive = new Set(fresh.map((r) => r.id));
    const gone = relatedIds.filter((id) => !alive.has(id));
    if (gone.length === 0) return null;
    // `rows` is the pre-refetch copy, so it still carries the deleted names.
    const names = gone.map((id) => rows.find((r) => r.id === id)?.name || `#${id}`);
    setRelatedIds((ids) => ids.filter((id) => alive.has(id)));
    return names;
  };

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const body = {
      name: values.name.trim(),
      parent_id: values.parent_id ?? null,
      display_order: values.display_order ?? 0,
      is_active: values.is_active ? 1 : 0,
    };
    // Strict Joi rejects unknown keys, so only send image keys when this resource
    // actually has them (asset categories are imageless).
    if (hasImages) {
      body.icon_s3_key = values.icon_s3_key ?? null;
      body.thumbnail_s3_key = values.thumbnail_s3_key ?? null;
    }
    if (hasHomepage) body.show_in_homepage = values.show_in_homepage ? 1 : 0;

    setSubmitting(true);
    try {
      let uid;
      if (isEdit) {
        await updateTrigger({ id: record.uid, body }).unwrap();
        uid = record.uid;
      } else {
        const created = await createTrigger(body).unwrap();
        uid = created.uid;
      }
      // tag_ids are never part of the category body — set via the dedicated route.
      if (hasTags && uid) {
        try {
          await setTags({ uid, tag_ids: values.tag_ids || [] }).unwrap();
        } catch {
          message.error('Category saved, but updating its tags failed.');
        }
      }

      // Same deal for related industries, and likewise NOT in one transaction
      // with the scalar write — so a failure here says so specifically.
      let relatedFailed = false;
      if (relatedWrite && uid && !sameOrder(relatedIds, relatedBaseline)) {
        const verb = isEdit ? 'saved' : 'created';
        try {
          const result = await setRelated({ uid, related_industry_ids: relatedIds }).unwrap();
          setRelatedBaseline((result?.RelatedIndustries || []).map((r) => r.id));
        } catch (err) {
          relatedFailed = true;
          const gone = err?.status === 404 ? await recoverStaleIds() : null;
          if (gone) {
            const list = gone.join(', ');
            setRelatedError({
              message: `${list} ${gone.length > 1 ? 'no longer exist' : 'no longer exists'} — removed from the list. Save again to apply.`,
              details: [],
            });
            message.error(
              `${singular} ${verb}, but the related industries could not be updated: ${list} ${
                gone.length > 1 ? 'were' : 'was'
              } deleted by someone else.`,
            );
          } else {
            setRelatedError({
              message: err?.message || 'Could not update the related industries.',
              details: err?.details || [],
            });
            message.error(
              `${singular} ${verb}, but the related industries could not be updated${
                err?.message ? `: ${err.message}` : '.'
              }`,
            );
          }
        }
      }

      // Editing: the scalars are already saved, so keep the drawer open for the
      // editor to fix the block (esp. after a 404 prune) and hit Save again —
      // that re-PATCHes the unchanged scalars, which only costs an extra
      // activity-log entry. Creating: the industry now exists, so closing is the
      // only safe move — reopening it would POST a duplicate.
      if (relatedFailed && isEdit) {
        onSaved?.();
        return;
      }
      if (!relatedFailed) message.success(`${singular} ${isEdit ? 'updated' : 'created'}`);
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
      title={isEdit ? `Edit "${record?.name}"` : `New ${singular}`}
      open={open}
      onClose={onClose}
      width={600}
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
          <Input placeholder="Category name" />
        </Form.Item>

        {isEdit && record?.slug && (
          <Form.Item label="Slug" extra="Public URL key — auto-generated from the name; not editable.">
            <Text code>{record.slug}</Text>
          </Form.Item>
        )}

        <Form.Item name="parent_id" label="Parent" extra="Leave empty for a top-level category.">
          <TreeSelect
            allowClear
            treeData={parentTree}
            treeDefaultExpandAll
            showSearch
            treeNodeFilterProp="title"
            placeholder="Top-level"
          />
        </Form.Item>

        {hasImages && (
          <Space size="large" align="start" wrap>
            <Form.Item name="icon_s3_key" label="Icon">
              <ImageUploadField slot={iconSlot} />
            </Form.Item>
            <Form.Item name="thumbnail_s3_key" label="Thumbnail">
              <ImageUploadField slot={thumbnailSlot} />
            </Form.Item>
          </Space>
        )}

        <Form.Item name="display_order" label="Display order">
          <InputNumber style={{ width: '100%' }} min={0} />
        </Form.Item>

        <Form.Item name="is_active" label="Active" valuePropName="checked">
          <Switch />
        </Form.Item>

        {hasHomepage && (
          <Form.Item name="show_in_homepage" label="Show in homepage" valuePropName="checked">
            <Switch />
          </Form.Item>
        )}

        {hasTags && (
          <Form.Item name="tag_ids" label="Tags">
            <TagSelect />
          </Form.Item>
        )}

        {relatedRead && (
          <Form.Item
            label="Related industries"
            extra="The block of internal links at the bottom of this industry's public page. Links are one-way — adding one here does not add this industry to its block — and drag order is the order they render in."
          >
            <RelatedIndustriesField
              value={relatedIds}
              onChange={(next) => {
                setRelatedIds(next);
                setRelatedError(null);
              }}
              rows={rows}
              selfId={record?.id}
              fallbackRows={related?.RelatedIndustries}
              disabled={!relatedWrite}
              loading={relatedLoading}
              error={relatedError}
            />
          </Form.Item>
        )}
      </Form>
    </Drawer>
  );
}

// ---- reparent-aware delete --------------------------------------------------

function ReparentDeleteModal({
  state,
  rows,
  singular,
  deleteNote,
  onClose,
  onReparentDelete,
  onDeleteAnyway,
}) {
  const [target, setTarget] = useState(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTarget(undefined);
  }, [state]);

  const open = Boolean(state);
  const record = state?.record;
  const children = state?.children || [];
  const parentTree = useMemo(
    () => (record ? toParentTree(rows, record.id) : []),
    [rows, record],
  );

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Delete "${record?.name}"?`}
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose} disabled={busy}>
          Cancel
        </Button>,
        <Button key="orphan" danger disabled={busy} onClick={() => run(onDeleteAnyway)}>
          Delete anyway (orphan children)
        </Button>,
        <Button
          key="reparent"
          type="primary"
          loading={busy}
          onClick={() => run(() => onReparentDelete(target))}
        >
          Reparent &amp; delete
        </Button>,
      ]}
    >
      <p>
        This {singular.toLowerCase()} has <strong>{children.length}</strong> child{' '}
        {children.length > 1 ? 'categories' : 'category'}. There is no foreign key, so deleting it
        will <strong>orphan</strong> them unless you move them first.
      </p>
      <p style={{ marginBottom: 8 }}>Move the children to:</p>
      <TreeSelect
        allowClear
        style={{ width: '100%' }}
        treeData={parentTree}
        treeDefaultExpandAll
        value={target}
        onChange={setTarget}
        placeholder="Top-level (no parent)"
      />
      {deleteNote && (
        <p style={{ marginTop: 12, color: '#999' }}>{deleteNote}</p>
      )}
    </Modal>
  );
}
