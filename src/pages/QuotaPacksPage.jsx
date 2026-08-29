import { useMemo, useState } from 'react';
import { Table, Typography, Space, Button, Select, Tag, Tooltip, Popover, Alert, App } from 'antd';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  HolderOutlined,
  CloudUploadOutlined,
  EyeInvisibleOutlined,
} from '@ant-design/icons';
import { useAppDispatch } from '../app/hooks';
import {
  adminApi,
  useQuotaPacksListQuery,
  useQuotaPackUpdateMutation,
  useQuotaPackRemoveMutation,
  useQuotaPacksReorderMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import {
  STATUS_COLORS,
  STATUS_OPTIONS,
  errorText,
  formatMoney,
  formatQuantity,
  isTopupable,
  packReadiness,
  statusLabel,
  toAmount,
  withGst,
} from '../lib/quotaPacks';
import QuotaPackEditorDrawer from '../components/QuotaPackEditorDrawer';

const { Title, Text } = Typography;

const EMPTY_FILTERS = { status: undefined, feature_type_id: undefined };

function moveItem(arr, from, to) {
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Top-up packs — extra headroom on one feature, bought outright on top of
 * whatever the user's plan allows.
 *
 * Two things drive the whole screen:
 *
 *  - A purchase NEVER expires. Retiring or deleting a pack takes nothing back
 *    from anyone who already bought it, and every confirm here says so — an
 *    admin who fears a clawback leaves dead packs in the store.
 *  - `price` is PRE-TAX. GST is added at checkout, so the list shows the gross
 *    figure under the price rather than letting anyone read the field as the
 *    final one.
 *
 * Publishability is never re-derived: rows carry `is_publishable` and
 * `missing_for_publish` from the same server function as the gate.
 *
 * Drag-reorder is gated hard (see `dragEnabled`): PATCH /reorder rewrites
 * display_order to array position FOR THE SUBMITTED UIDS ONLY, so sending one
 * page — or a filtered view — hands those rows positions that collide with the
 * rows it left out.
 */
export default function QuotaPacksPage() {
  const dispatch = useAppDispatch();
  const perms = usePermissions();
  const { message, modal } = App.useApp();

  const canCreate = perms.can('quota_packs', 'create');
  const canUpdate = perms.can('quota_packs', 'update');
  const canDelete = perms.can('quota_packs', 'delete');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [editor, setEditor] = useState({ open: false, uid: null });
  const [statusUid, setStatusUid] = useState(null);
  const [reordering, setReordering] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  // Unpaginated by contract — every feature, flagged or not.
  const { data: features } = adminApi.endpoints.featureTypesList.useQuery();

  const queryArg = useMemo(
    () => ({
      status: filters.status,
      feature_type_id: filters.feature_type_id,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    [filters, page, pageSize],
  );

  const { data, isLoading, isFetching, refetch } = useQuotaPacksListQuery(queryArg);
  const [updatePack] = useQuotaPackUpdateMutation();
  const [removePack] = useQuotaPackRemoveMutation();
  const [reorder] = useQuotaPacksReorderMutation();

  const rows = data?.items || [];
  const total = data?.total || 0;

  const featureById = useMemo(
    () => new Map((features || []).map((f) => [f.id, f])),
    [features],
  );
  const noTopupableFeature = Boolean(features) && !(features || []).some(isTopupable);

  const filtersActive = Object.values(filters).some((v) => v !== undefined);
  const showsEveryPack = rows.length === total;
  const dragEnabled = canUpdate && !reordering && !filtersActive && showsEveryPack;

  const dragBlockedReason = !canUpdate
    ? 'You need the top-up packs “update” permission to reorder.'
    : filtersActive
      ? 'Clear the filters first — reordering rewrites the order of the whole list, so it needs every pack on screen.'
      : !showsEveryPack
        ? `Showing ${rows.length} of ${total}. Reordering needs every pack on one page — raise the page size (100 is the API maximum).`
        : null;

  const setFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const resetDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const handleDrop = async (index) => {
    if (dragIndex == null || dragIndex === index) {
      resetDrag();
      return;
    }
    const nextRows = moveItem(rows, dragIndex, index);
    resetDrag();

    // Optimistic patch: the server assigns display_order by array position, so
    // mirror both the order and the numbers.
    const patch = dispatch(
      adminApi.util.updateQueryData('quotaPacksList', queryArg, (draft) => {
        draft.items = nextRows.map((r, i) => ({
          ...(draft.items.find((d) => d.uid === r.uid) || r),
          display_order: i,
        }));
      }),
    );
    setReordering(true);
    try {
      // uids, not numeric ids.
      await reorder(nextRows.map((r) => r.uid)).unwrap();
    } catch (err) {
      patch.undo();
      // All-or-nothing: a 404 means one uid is gone and NOTHING was written, so
      // refetch rather than resending the same array.
      message.error(errorText(err, 'Failed to save the new order — reverted.'));
      refetch();
    } finally {
      setReordering(false);
    }
  };

  const changeStatus = (record, next) => {
    const publishing = next === 'active';
    modal.confirm({
      title: publishing ? `Publish “${record.name}”?` : `Retire “${record.name}”?`,
      content: publishing
        ? 'It goes on sale straight away.'
        : 'This removes the pack from the store. Anyone who already bought it keeps their quota — a top-up never expires, so retiring takes nothing away.',
      okText: publishing ? 'Publish' : 'Retire',
      onOk: async () => {
        setStatusUid(record.uid);
        try {
          await updatePack({ uid: record.uid, body: { status: next } }).unwrap();
          message.success(publishing ? 'Published to the store' : 'Retired from the store');
        } catch (err) {
          // Only the transition INTO active is gated, and its 400 lists
          // everything unmet at once — show those, not a bare "request failed".
          message.error(errorText(err, 'Could not change the status.'));
        } finally {
          setStatusUid(null);
        }
      },
    });
  };

  const onDelete = (record) => {
    modal.confirm({
      title: `Delete “${record.name}” permanently?`,
      content:
        'Hard delete, and it cannot be undone. Anyone who bought this pack keeps their quota — their grants survive, but lose the link back to the pack, so it drops out of per-pack revenue reporting. For a pack that has sold, retire it instead.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removePack(record.uid).unwrap();
          message.success('Pack deleted');
        } catch (err) {
          if (err?.status === 404) {
            message.error('That pack no longer exists — refreshing the list.');
            refetch();
            return;
          }
          message.error(errorText(err, 'Could not delete the pack.'));
        }
      },
    });
  };

  const columns = [
    {
      title: '',
      key: 'drag',
      width: 40,
      render: () => (
        <Tooltip title={dragEnabled ? 'Drag to reorder' : dragBlockedReason}>
          <HolderOutlined
            style={{
              color: dragEnabled ? '#999' : '#d9d9d9',
              cursor: dragEnabled ? 'grab' : 'not-allowed',
            }}
          />
        </Tooltip>
      ),
    },
    {
      title: 'Name',
      key: 'name',
      render: (_v, r) => (
        <Space size={6}>
          <Text strong>{r.name}</Text>
          {r.badge && <Tag color="magenta">{r.badge}</Tag>}
        </Space>
      ),
    },
    {
      title: 'Feature',
      key: 'feature',
      width: 200,
      render: (_v, r) => {
        const feature = r.FeatureType || featureById.get(r.feature_type_id);
        const label = feature?.label || feature?.key;
        if (!label) return <Text type="secondary">—</Text>;
        // A feature can be un-flagged after packs were built on it. The pack
        // then can't be published, so say so here rather than in a 400 later.
        const live = featureById.get(r.feature_type_id);
        const disabled = live && !isTopupable(live);
        return (
          <Space size={6}>
            <Tag>{label}</Tag>
            {disabled && (
              <Tooltip title="Top-ups are switched off for this feature on the Feature Types screen, so this pack can’t be published.">
                <Tag color="warning">top-ups disabled</Tag>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Quantity',
      key: 'quantity',
      width: 130,
      render: (_v, r) => {
        const feature = r.FeatureType || featureById.get(r.feature_type_id);
        return <Text>{formatQuantity(r.quantity, feature?.key)}</Text>;
      },
    },
    {
      title: 'Price (excl. GST)',
      key: 'price',
      width: 190,
      render: (_v, r) => {
        const strike = toAmount(r.strike_price);
        return (
          <Space direction="vertical" size={0}>
            <Space size={6}>
              <Text strong>{formatMoney(r.price)}</Text>
              {strike !== null && strike > 0 && (
                <Tooltip title="Display only — nothing is charged against this figure.">
                  <Text type="secondary" delete>
                    {formatMoney(strike)}
                  </Text>
                </Tooltip>
              )}
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              customer pays {formatMoney(withGst(r.price))}
            </Text>
          </Space>
        );
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (v) => <Tag color={STATUS_COLORS[v] || 'default'}>{statusLabel(v)}</Tag>,
    },
    {
      title: 'Publishable',
      key: 'publishable',
      width: 150,
      render: (_v, record) => {
        const { known, ready, missing } = packReadiness(record);
        if (!known) return <Text type="secondary">—</Text>;
        if (ready) return <Tag color="green">Ready</Tag>;
        return (
          <Popover
            title="Still needed before publishing"
            content={
              <ul style={{ margin: 0, paddingLeft: 18, maxWidth: 320 }}>
                {missing.map((m) => (
                  <li key={m.field}>{m.message}</li>
                ))}
              </ul>
            }
          >
            <Tag color="warning">Incomplete ({missing.length})</Tag>
          </Popover>
        );
      },
    },
  ];

  if (canUpdate || canDelete) {
    columns.push({
      title: 'Actions',
      key: 'actions',
      width: 140,
      fixed: 'right',
      render: (_v, record) => {
        const { ready, missing } = packReadiness(record);
        return (
          <Space size="small">
            {canUpdate && (
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => setEditor({ open: true, uid: record.uid })}
                title="Edit"
              />
            )}
            {canUpdate &&
              (record.status === 'active' ? (
                <Tooltip title="Retire — pull it from the store (buyers keep their quota)">
                  <Button
                    size="small"
                    icon={<EyeInvisibleOutlined />}
                    loading={statusUid === record.uid}
                    onClick={() => changeStatus(record, 'inactive')}
                  />
                </Tooltip>
              ) : (
                <Tooltip
                  title={
                    ready
                      ? 'Publish to the store'
                      : `Incomplete: ${missing.map((m) => m.message).join(' ')}`
                  }
                >
                  {/* Disabled straight off the server's own gate — never a
                      client-side copy of the rules. */}
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    icon={<CloudUploadOutlined />}
                    disabled={!ready}
                    loading={statusUid === record.uid}
                    onClick={() => changeStatus(record, 'active')}
                  />
                </Tooltip>
              ))}
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
        );
      },
    });
  }

  const editingRow = rows.find((r) => r.uid === editor.uid) || null;

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
          Top-up Packs
        </Title>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching || reordering}>
            Reload
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setEditor({ open: true, uid: null })}
            >
              New Pack
            </Button>
          )}
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="A top-up pack is bought outright and never expires — it adds headroom on top of the user’s plan allowance, and survives the monthly reset and a lapsed subscription."
        description={
          dragEnabled
            ? 'Drag the rows to set the order the buy screen shows them in — each change saves automatically.'
            : dragBlockedReason
        }
      />

      {/* Packs are inert until a paid plan declares a FINITE allowance for the
          feature: on a plan with -1 (unlimited) the purchase endpoint refuses
          the sale with a 409. That lives on Plan features, not here — and the
          check would cost one request per plan behind a different permission
          domain, so it is a standing note rather than a live banner. */}
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="A pack only sells if the buyer’s plan sets a finite allowance for its feature."
        description="Where a plan grants -1 (unlimited) — as the seeded Pro plan does for AI Credits — the store refuses the purchase, because nobody on it can hit a limit. That is a plan configuration change on Plans → Features, not something this screen can fix."
      />

      {noTopupableFeature && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="No feature is enabled for top-ups yet."
          description="A pack can only be sold for a feature flagged “Can be topped up” on the Feature Types screen. Until one is, every pack here will fail its publish check."
        />
      )}

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="Status"
          style={{ width: 160 }}
          value={filters.status}
          onChange={(v) => setFilter('status', v)}
          options={STATUS_OPTIONS}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Feature"
          style={{ width: 220 }}
          value={filters.feature_type_id}
          onChange={(v) => setFilter('feature_type_id', v)}
          // Every feature, not just the top-uppable ones: a pack built before
          // its feature was un-flagged still has to be findable.
          options={(features || []).map((f) => ({ label: f.label || f.key, value: f.id }))}
        />
      </Space>

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        scroll={{ x: 'max-content' }}
        size="middle"
        locale={{
          emptyText: filtersActive
            ? 'No packs match.'
            : 'No top-up packs yet — create one, set its quantity and price, then publish it.',
        }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          // 100 is the API's maximum `limit`.
          pageSizeOptions: [20, 30, 50, 100],
          showTotal: (t) => `${t} total`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
        onRow={(_record, index) => ({
          draggable: dragEnabled,
          onDragStart: (e) => {
            setDragIndex(index);
            e.dataTransfer.effectAllowed = 'move';
            // Firefox requires data to be set for a drag to start.
            e.dataTransfer.setData('text/plain', String(index));
          },
          onDragOver: (e) => {
            if (!dragEnabled || dragIndex == null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (overIndex !== index) setOverIndex(index);
          },
          onDrop: (e) => {
            e.preventDefault();
            handleDrop(index);
          },
          onDragEnd: resetDrag,
          style: {
            cursor: dragEnabled ? 'grab' : 'default',
            opacity: dragIndex === index ? 0.5 : 1,
            boxShadow:
              overIndex === index && dragIndex != null && dragIndex !== index
                ? 'inset 0 2px 0 #1677ff'
                : undefined,
          },
        })}
      />

      <QuotaPackEditorDrawer
        open={editor.open}
        uid={editor.uid}
        // `missing_for_publish` only exists on the list row — GET /:uid omits it.
        row={editingRow}
        onClose={() => setEditor({ open: false, uid: null })}
        onSaved={refetch}
      />
    </div>
  );
}
