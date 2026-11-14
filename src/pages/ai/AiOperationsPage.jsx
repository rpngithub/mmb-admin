import { useState } from 'react';
import { Alert, App, Button, Space, Table, Tag, Tooltip, Typography } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  HolderOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useAppDispatch } from '../../app/hooks';
import { adminApi } from '../../features/api/adminApi';
import { usePermissions } from '../../features/auth/usePermissions';
import {
  LEDGER_SOURCES,
  PROVIDER_STATUS_COLORS,
  errorText,
  formatInr,
  formatNumber,
  toNum,
} from '../../lib/ai';
import AiOperationDrawer from '../../components/ai/AiOperationDrawer';
import AiRouteDrawer from '../../components/ai/AiRouteDrawer';

const { Title, Text } = Typography;

const isOn = (v) => v === true || v === 1;

function moveItem(arr, from, to) {
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

const sortRoutes = (routes) =>
  [...(routes || [])].sort(
    (a, b) =>
      (toNum(a.priority) ?? 0) - (toNum(b.priority) ?? 0) ||
      (toNum(b.weight) ?? 0) - (toNum(a.weight) ?? 0),
  );

/**
 * Operations (what users buy) with their routes (how each is fulfilled)
 * nested underneath. Drag rows to set the order the app shows them in.
 */
export default function AiOperationsPage() {
  const dispatch = useAppDispatch();
  const perms = usePermissions();
  const { message, modal } = App.useApp();
  const canCreate = perms.can('ai_operations', 'create');
  const canUpdate = perms.can('ai_operations', 'update');
  const canDelete = perms.can('ai_operations', 'delete');

  const { data: rows = [], isLoading, isFetching, refetch } =
    adminApi.endpoints.aiOperationsList.useQuery();
  const [updateOp] = adminApi.endpoints.aiOperationUpdate.useMutation();
  const [removeOp] = adminApi.endpoints.aiOperationRemove.useMutation();
  const [reorder] = adminApi.endpoints.aiOperationsReorder.useMutation();
  const [updateRoute] = adminApi.endpoints.aiRouteUpdate.useMutation();
  const [removeRoute] = adminApi.endpoints.aiRouteRemove.useMutation();

  const [opEditor, setOpEditor] = useState({ open: false, uid: null });
  const [routeEditor, setRouteEditor] = useState({ open: false, opUid: null, route: null });
  const [reordering, setReordering] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const dragEnabled = canUpdate && !reordering && rows.length > 1;

  const resetDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const handleDrop = async (index) => {
    if (dragIndex == null || dragIndex === index) {
      resetDrag();
      return;
    }
    const next = moveItem(rows, dragIndex, index);
    resetDrag();
    const patch = dispatch(
      adminApi.util.updateQueryData('aiOperationsList', undefined, (draft) => {
        draft.splice(0, draft.length, ...next.map((r, i) => ({ ...r, sort_order: i })));
      }),
    );
    setReordering(true);
    try {
      // The FULL list of uids — array position becomes sort_order.
      await reorder(next.map((r) => r.uid)).unwrap();
    } catch (err) {
      patch.undo();
      message.error(errorText(err, 'Failed to save the new order — reverted.'));
      refetch();
    } finally {
      setReordering(false);
    }
  };

  // 409 → offer to deactivate instead (keeps history, stops new use).
  const offerDeactivate = (title, err, deactivate) => {
    modal.confirm({
      title,
      content: `${err?.message ? `${err.message} ` : ''}It has been used, so it can’t be deleted. Deactivate it instead?`,
      okText: 'Deactivate it instead',
      okButtonProps: { disabled: !canUpdate },
      onOk: async () => {
        try {
          await deactivate();
          message.success('Deactivated');
        } catch (e) {
          message.error(errorText(e, 'Could not deactivate.'));
        }
      },
    });
  };

  const deleteOperation = (op) => {
    modal.confirm({
      title: `Delete operation “${op.label || op.key}”?`,
      content: 'Only possible while it has no jobs and no routes.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeOp(op.uid).unwrap();
          message.success('Operation deleted');
        } catch (err) {
          if (err?.status === 409) {
            offerDeactivate('This operation has jobs or routes', err, () =>
              updateOp({ uid: op.uid, body: { is_active: false } }).unwrap(),
            );
            return;
          }
          message.error(errorText(err, 'Could not delete the operation.'));
        }
      },
    });
  };

  const deleteRoute = (route) => {
    modal.confirm({
      title: `Delete route via ${route.provider?.name || 'provider'}${route.model ? ` / ${route.model}` : ''}?`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeRoute(route.uid).unwrap();
          message.success('Route deleted');
        } catch (err) {
          if (err?.status === 409) {
            offerDeactivate('Jobs have used this route', err, () =>
              updateRoute({ uid: route.uid, body: { is_active: false } }).unwrap(),
            );
            return;
          }
          message.error(errorText(err, 'Could not delete the route.'));
        }
      },
    });
  };

  const routeColumns = (op) => {
    const cols = [
      {
        title: (
          <Tooltip title="Lower is tried first; same priority = peers sharing load by weight.">
            Priority
          </Tooltip>
        ),
        dataIndex: 'priority',
        key: 'priority',
        width: 80,
      },
      {
        title: 'Provider',
        key: 'provider',
        render: (_v, r) => (
          <Space size={4}>
            <Text>{r.provider?.name || r.provider?.key || '—'}</Text>
            {r.provider?.status && r.provider.status !== 'active' && (
              <Tag color={PROVIDER_STATUS_COLORS[r.provider.status] || 'default'}>
                {r.provider.status}
              </Tag>
            )}
          </Space>
        ),
      },
      { title: 'Model', dataIndex: 'model', key: 'model', render: (v) => v || '—' },
      {
        title: (
          <Tooltip title="What one call costs us in the provider's unit; for token-billed providers the ESTIMATED US cents per call.">
            Provider units
          </Tooltip>
        ),
        dataIndex: 'provider_units',
        key: 'provider_units',
        render: (v) => formatNumber(v, 4),
      },
      { title: 'Weight', dataIndex: 'weight', key: 'weight' },
      {
        title: 'Fallback',
        dataIndex: 'fallback_allowed',
        key: 'fallback_allowed',
        render: (v) => (isOn(v) ? <Tag color="blue">allowed</Tag> : <Tag>waits</Tag>),
      },
      {
        title: 'Max cost',
        dataIndex: 'max_cost_inr',
        key: 'max_cost_inr',
        render: (v) => (v === null || v === undefined ? '—' : formatInr(v)),
      },
      {
        title: 'Active',
        dataIndex: 'is_active',
        key: 'is_active',
        render: (v) => (isOn(v) ? <Tag color="green">active</Tag> : <Tag>inactive</Tag>),
      },
    ];
    if (canUpdate || canDelete) {
      cols.push({
        title: '',
        key: 'actions',
        render: (_v, r) => (
          <Space size="small">
            {canUpdate && (
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => setRouteEditor({ open: true, opUid: op.uid, route: r })}
              />
            )}
            {canDelete && (
              <Button size="small" danger icon={<DeleteOutlined />} onClick={() => deleteRoute(r)} />
            )}
          </Space>
        ),
      });
    }
    return cols;
  };

  const columns = [
    {
      title: '',
      key: 'drag',
      width: 36,
      render: () => (
        <Tooltip title={dragEnabled ? 'Drag to reorder' : undefined}>
          <HolderOutlined
            style={{
              color: dragEnabled ? '#999' : '#d9d9d9',
              cursor: dragEnabled ? 'grab' : 'default',
            }}
          />
        </Tooltip>
      ),
    },
    {
      title: 'Operation',
      key: 'label',
      render: (_v, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{r.label}</Text>
          <Text code style={{ fontSize: 12 }}>
            {r.key}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Price',
      key: 'credits',
      render: (_v, r) => (
        <Text>
          {formatNumber(r.credits, 0)} credits / {r.unit}
          {r.price_rules?.units_from || r.price_rules?.multipliers ? (
            <Tooltip title="Price rules adjust this per request.">
              <Tag style={{ marginLeft: 6 }}>rules</Tag>
            </Tooltip>
          ) : null}
        </Text>
      ),
    },
    {
      title: 'Ledger source',
      dataIndex: 'ledger_source',
      key: 'ledger_source',
      render: (v) => LEDGER_SOURCES.find((s) => s.value === v)?.label || v || '—',
    },
    {
      title: 'Active',
      key: 'is_active',
      render: (_v, r) => (isOn(r.is_active) ? <Tag color="green">active</Tag> : <Tag>inactive</Tag>),
    },
    {
      title: 'Allowed plans',
      key: 'plans',
      render: (_v, r) => {
        const plans = r.plans || [];
        if (!plans.length) return <Tag color="blue">All plans</Tag>;
        return (
          <Space size={[4, 4]} wrap style={{ maxWidth: 280 }}>
            {plans.map((p) => (
              <Tooltip
                key={p.uid || p.id}
                title={[p.plan_type, p.status && p.status !== 'active' ? 'inactive' : null]
                  .filter(Boolean)
                  .join(' · ')}
              >
                <Tag color={p.status && p.status !== 'active' ? undefined : 'purple'}>
                  {p.name || p.uid}
                </Tag>
              </Tooltip>
            ))}
          </Space>
        );
      },
    },
    {
      title: 'Routes',
      key: 'routes',
      render: (_v, r) => {
        const routes = r.routes || [];
        const active = routes.filter((x) => isOn(x.is_active)).length;
        if (!routes.length) return <Tag color="red">no route</Tag>;
        return (
          <Text>
            {active} active{routes.length > active ? ` / ${routes.length}` : ''}
          </Text>
        );
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      fixed: 'right',
      render: (_v, r) => (
        <Space size="small">
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => setOpEditor({ open: true, uid: r.uid })}
          >
            {canUpdate ? 'Edit' : 'View'}
          </Button>
          {canDelete && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => deleteOperation(r)}
            />
          )}
        </Space>
      ),
    },
  ];

  const editingOp = opEditor.uid ? rows.find((r) => r.uid === opEditor.uid) || null : null;
  const routeOp = rows.find((r) => r.uid === routeEditor.opUid) || null;

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
          AI Operations &amp; Routes
        </Title>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching || reordering}>
            Reload
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setOpEditor({ open: true, uid: null })}
            >
              New operation
            </Button>
          )}
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="An operation is what users buy; its routes are the provider/model options that fulfil it."
        description={
          canUpdate
            ? 'Drag rows to set the order — it saves straight away. Expand a row to see and edit its routes.'
            : 'Expand a row to see its routes.'
        }
      />

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: 'No operations yet.' }}
        expandable={{
          expandedRowRender: (op) => (
            <div style={{ padding: '4px 0' }}>
              <Table
                rowKey="uid"
                size="small"
                columns={routeColumns(op)}
                dataSource={sortRoutes(op.routes)}
                pagination={false}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: 'No routes — users get AI_UNAVAILABLE for this operation.' }}
              />
              {canCreate && (
                <Button
                  size="small"
                  type="dashed"
                  icon={<PlusOutlined />}
                  style={{ marginTop: 8 }}
                  onClick={() => setRouteEditor({ open: true, opUid: op.uid, route: null })}
                >
                  Add route
                </Button>
              )}
            </div>
          ),
        }}
        onRow={(record) => {
          const index = rows.findIndex((r) => r.uid === record.uid);
          return {
            draggable: dragEnabled,
            onDragStart: (e) => {
              setDragIndex(index);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(record.uid));
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
              opacity: dragIndex === index ? 0.5 : 1,
              boxShadow:
                overIndex === index && dragIndex != null && dragIndex !== index
                  ? 'inset 0 2px 0 #1677ff'
                  : undefined,
            },
          };
        }}
      />

      <AiOperationDrawer
        open={opEditor.open}
        record={editingOp}
        onClose={() => setOpEditor({ open: false, uid: null })}
      />
      <AiRouteDrawer
        open={routeEditor.open}
        operation={routeOp}
        record={routeEditor.route}
        onClose={() => setRouteEditor({ open: false, opUid: null, route: null })}
      />
    </div>
  );
}
