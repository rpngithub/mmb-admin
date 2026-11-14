import { useState } from 'react';
import { App, Button, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { adminApi } from '../../features/api/adminApi';
import { usePermissions } from '../../features/auth/usePermissions';
import { PROVIDER_STATUS_COLORS, errorText, formatInr, isPostpaid } from '../../lib/ai';
import AiProviderDrawer from '../../components/ai/AiProviderDrawer';

const { Title, Text } = Typography;

export default function AiProvidersPage() {
  const perms = usePermissions();
  const { message, modal } = App.useApp();
  const canCreate = perms.can('ai_providers', 'create');
  const canUpdate = perms.can('ai_providers', 'update');
  const canDelete = perms.can('ai_providers', 'delete');

  const { data: rows = [], isLoading, isFetching, refetch } =
    adminApi.endpoints.aiProvidersList.useQuery();
  const [updateProvider] = adminApi.endpoints.aiProviderUpdate.useMutation();
  const [removeProvider] = adminApi.endpoints.aiProviderRemove.useMutation();
  const [editor, setEditor] = useState({ open: false, uid: null });

  const disable = async (record) => {
    try {
      await updateProvider({ uid: record.uid, body: { status: 'disabled' } }).unwrap();
      message.success(`${record.name || record.key} disabled`);
    } catch (err) {
      message.error(errorText(err, 'Could not disable the provider.'));
    }
  };

  const onDelete = (record) => {
    modal.confirm({
      title: `Delete provider “${record.name || record.key}”?`,
      content: 'Only possible while it has no jobs, routes or keys.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeProvider(record.uid).unwrap();
          message.success('Provider deleted');
        } catch (err) {
          if (err?.status === 409) {
            modal.confirm({
              title: 'This provider is in use',
              content: `${err.message ? `${err.message} ` : ''}It has jobs, routes or keys, so it can’t be deleted. Disable it instead — it stops taking new jobs and keeps its history.`,
              okText: 'Disable it instead',
              okButtonProps: { disabled: !canUpdate || record.status === 'disabled' },
              onOk: () => disable(record),
            });
            return;
          }
          message.error(errorText(err, 'Could not delete the provider.'));
        }
      },
    });
  };

  const columns = [
    {
      title: 'Provider',
      key: 'name',
      render: (_v, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{r.name}</Text>
          <Text code style={{ fontSize: 12 }}>
            {r.key}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (v) => <Tag color={PROVIDER_STATUS_COLORS[v] || 'default'}>{v}</Tag>,
    },
    { title: 'Base URL', dataIndex: 'base_url', key: 'base_url', render: (v) => v || '—' },
    {
      title: 'Credentials',
      dataIndex: 'credential_source',
      key: 'credential_source',
      render: (v) => <Tag>{v || '—'}</Tag>,
    },
    {
      title: 'Limits',
      key: 'limits',
      render: (_v, r) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {r.rate_limit_rpm ?? '—'} rpm · {r.max_concurrency ?? '—'} concurrent ·{' '}
          {r.timeout_ms ?? '—'} ms
        </Text>
      ),
    },
    {
      title: (
        <Tooltip title="Derived from Credit purchases (invoices for postpaid) — read-only.">
          Cost / unit
        </Tooltip>
      ),
      key: 'cost',
      render: (_v, r) =>
        r.cost_per_unit_inr === null || r.cost_per_unit_inr === undefined ? (
          <Text type="secondary">{isPostpaid(r) ? 'no rate' : 'no purchase'}</Text>
        ) : (
          <span>
            {formatInr(r.cost_per_unit_inr, { digits: 4 })}
            {r.cost_unit && <Text type="secondary"> / {r.cost_unit}</Text>}
          </span>
        ),
    },
    {
      title: 'Billing',
      key: 'billing',
      render: (_v, r) =>
        isPostpaid(r) ? <Tag color="purple">postpaid</Tag> : <Tag>prepaid</Tag>,
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
            onClick={() => setEditor({ open: true, uid: r.uid })}
          >
            {canUpdate ? 'Edit' : 'View'}
          </Button>
          {canDelete && (
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(r)} />
          )}
        </Space>
      ),
    },
  ];

  const editing = editor.uid ? rows.find((r) => r.uid === editor.uid) || null : null;

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
          AI Providers
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
              New provider
            </Button>
          )}
        </Space>
      </div>

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: 'No providers yet.' }}
      />

      <AiProviderDrawer
        open={editor.open}
        record={editing}
        onClose={() => setEditor({ open: false, uid: null })}
        onOpenProvider={(uid) => setEditor({ open: true, uid })}
      />
    </div>
  );
}
