import { useMemo, useState } from 'react';
import { Table, Typography, Space, Input, Button, Tag, Tooltip, Popconfirm, Alert, App } from 'antd';
import { ReloadOutlined, PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { adminApi, useFeatureTypeMetersQuery } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import FeatureTypeEditorModal from '../components/FeatureTypeEditorModal';
import { isUnenforced, NOT_ENFORCED_TOOLTIP, RESET_HINT } from '../lib/meteredFeatures';

const { Title, Text } = Typography;

const isTrue = (v) => v === 1 || v === true;

/**
 * Feature types — the catalogue plan features, top-up packs and quota grants
 * pick from. Integer rows are enforced limits keyed by a metered key; a legacy
 * integer row whose key nothing counts is flagged "Not enforced" and cannot be
 * saved until it is fixed (the API refuses it).
 */
export default function FeatureTypesPage() {
  const perms = usePermissions();
  const { message } = App.useApp();
  const canCreate = perms.can('features', 'create');
  const canUpdate = perms.can('features', 'update');
  const canDelete = perms.can('features', 'delete');

  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState({ open: false, row: null });

  const { data, isLoading, isFetching, refetch } = adminApi.endpoints.featureTypesList.useQuery();
  // Once per visit: the meter list only changes with a deploy.
  const { data: meters, isError: metersFailed } = useFeatureTypeMetersQuery(undefined, {
    refetchOnMountOrArgChange: true,
  });
  const [deleteFeatureType] = adminApi.endpoints.featureTypesRemove.useMutation();

  const rows = useMemo(() => {
    const all = data || [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (f) => f.key?.toLowerCase().includes(q) || f.label?.toLowerCase().includes(q),
    );
  }, [data, search]);

  const unenforcedCount = useMemo(
    () => (data || []).filter((f) => isUnenforced(f, meters)).length,
    [data, meters],
  );

  const handleDelete = async (row) => {
    try {
      await deleteFeatureType(row.id).unwrap();
      message.success('Feature type deleted');
    } catch {
      /* notification handled globally */
    }
  };

  const columns = [
    {
      title: 'Key',
      dataIndex: 'key',
      key: 'key',
      render: (v) => <Text code>{v}</Text>,
    },
    { title: 'Label', dataIndex: 'label', key: 'label' },
    {
      title: 'Data type',
      dataIndex: 'data_type',
      key: 'data_type',
      width: 200,
      render: (v, r) => (
        <Space size={4} wrap>
          <Tag>{v}</Tag>
          {v === 'integer' &&
            (isUnenforced(r, meters) ? (
              <Tooltip title={NOT_ENFORCED_TOOLTIP}>
                <Tag color="red">Not enforced</Tag>
              </Tooltip>
            ) : (
              meters && <Tag color="blue">Metered</Tag>
            ))}
        </Space>
      ),
    },
    {
      title: 'Reset period',
      dataIndex: 'reset_period',
      key: 'reset_period',
      width: 140,
      render: (v, r) =>
        r.data_type === 'integer' && RESET_HINT[v] ? (
          <Tooltip title={RESET_HINT[v]}>
            <Tag>{v}</Tag>
          </Tooltip>
        ) : (
          <Tag>{v || '—'}</Tag>
        ),
    },
    {
      // Turning this on is what makes a feature appear in the Top-up Packs and
      // quota-grant dropdowns — no deploy needed.
      title: 'Top-uppable',
      dataIndex: 'is_topupable',
      key: 'is_topupable',
      width: 120,
      render: (v) => <Tag color={isTrue(v) ? 'green' : 'default'}>{isTrue(v) ? 'Yes' : 'No'}</Tag>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 110,
      fixed: 'right',
      render: (_v, r) => (
        <Space size="small">
          {canUpdate && (
            <Button
              size="small"
              icon={<EditOutlined />}
              title="Edit"
              onClick={() => setEditor({ open: true, row: r })}
            />
          )}
          {canDelete && (
            <Popconfirm
              title="Delete this feature type?"
              description="Plans that list it lose that row."
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(r)}
            >
              <Button size="small" danger icon={<DeleteOutlined />} title="Delete" />
            </Popconfirm>
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
          Feature Types
        </Title>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="Search key or label"
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
              onClick={() => setEditor({ open: true, row: null })}
            >
              New Feature Type
            </Button>
          )}
        </Space>
      </div>

      {metersFailed && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Could not load the metered keys, so enforcement can't be shown. Reload to try again."
        />
      )}
      {unenforcedCount > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${unenforcedCount} integer feature type${unenforcedCount === 1 ? ' is' : 's are'} not enforced`}
          description={NOT_ENFORCED_TOOLTIP}
        />
      )}

      <Table
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        scroll={{ x: 'max-content' }}
        size="middle"
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} total` }}
      />

      <FeatureTypeEditorModal
        open={editor.open}
        featureType={editor.row}
        onClose={() => setEditor({ open: false, row: null })}
        onSaved={() => setEditor({ open: false, row: null })}
      />
    </div>
  );
}
