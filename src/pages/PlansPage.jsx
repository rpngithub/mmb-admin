import { useMemo, useState } from 'react';
import {
  Table,
  Typography,
  Space,
  Input,
  Button,
  Tag,
  Popconfirm,
  Drawer,
  Descriptions,
  List,
  App,
} from 'antd';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  adminApi,
  usePlanDeleteMutation,
  usePlanBillingOptionsByPlanQuery,
  usePlanFeaturesByPlanQuery,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import PlanEditorDrawer from './plan/PlanEditorDrawer';

const { Title, Text } = Typography;

const boolTag = (v) => {
  const c = v === 1 || v === true;
  return <Tag color={c ? 'green' : 'default'}>{c ? 'Yes' : 'No'}</Tag>;
};

// Render a feature value using its FeatureType's data_type.
function formatFeatureValue(value, dataType) {
  if (value === -1) return 'Unlimited';
  if (dataType === 'boolean') return value === 1 ? 'On' : 'Off';
  return String(value ?? 0);
}

export default function PlansPage() {
  const perms = usePermissions();
  const { message } = App.useApp();

  const canCreate = perms.can('plans', 'create');
  const canUpdate = perms.can('plans', 'update');
  const canDelete = perms.can('plans', 'delete');

  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState({ open: false, plan: null });
  const [viewPlan, setViewPlan] = useState(null);

  const { data, isLoading, isFetching, refetch } = adminApi.endpoints.plansList.useQuery();
  const [deletePlan] = usePlanDeleteMutation();

  const rows = useMemo(() => {
    const all = data || [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((p) => p.name?.toLowerCase().includes(q));
  }, [data, search]);

  const handleDelete = async (record) => {
    try {
      await deletePlan(record.uid).unwrap();
      message.success('Plan deleted');
    } catch (err) {
      if (err?.status === 409) {
        message.error('This plan is referenced by active subscriptions and cannot be deleted.');
      } else {
        message.error(err?.message || 'Failed to delete plan.');
      }
    }
  };

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (v) => <Tag color={v === 'active' ? 'green' : 'default'}>{v || '—'}</Tag>,
    },
    {
      title: 'Type',
      dataIndex: 'plan_type',
      key: 'plan_type',
      width: 200,
      render: (v, record) => {
        const isPass = v === 'access_pass';
        return (
          <Space size={4} wrap>
            <Tag color={isPass ? 'purple' : 'blue'}>
              {isPass ? 'Access Pass' : 'Subscription'}
            </Tag>
            {isPass
              ? (record.pass_price != null || record.pass_days != null) && (
                  <Tag color="gold">
                    ₹{record.pass_price ?? '—'} / {record.pass_days ?? '—'} days
                  </Tag>
                )
              : record.trial_days > 0 && (
                  <Tag color="green">{record.trial_days}-day trial</Tag>
                )}
          </Space>
        );
      },
    },
    { title: 'Popular', dataIndex: 'is_popular', key: 'is_popular', width: 90, render: boolTag },
    {
      title: 'Order',
      dataIndex: 'display_order',
      key: 'display_order',
      width: 80,
      render: (v) => v ?? 0,
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 120,
      render: (v) => (v && dayjs(v).isValid() ? dayjs(v).format('YYYY-MM-DD') : '—'),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 130,
      fixed: 'right',
      render: (_v, record) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => setViewPlan(record)} />
          {canUpdate && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditor({ open: true, plan: record })}
            />
          )}
          {canDelete && (
            <Popconfirm
              title="Delete this plan?"
              description="Its billing options and features are removed too."
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(record)}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
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
          Plans
        </Title>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="Search plans"
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
              onClick={() => setEditor({ open: true, plan: null })}
            >
              New Plan
            </Button>
          )}
        </Space>
      </div>

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `${t} total` }}
      />

      <PlanEditorDrawer
        open={editor.open}
        plan={editor.plan}
        onClose={() => setEditor({ open: false, plan: null })}
        onSaved={refetch}
      />

      <PlanViewDrawer plan={viewPlan} onClose={() => setViewPlan(null)} />
    </div>
  );
}

function PlanViewDrawer({ plan, onClose }) {
  const { data: featureTypes } = adminApi.endpoints.featureTypesList.useQuery(undefined, {
    skip: !plan,
  });
  const { data: billing } = usePlanBillingOptionsByPlanQuery(plan?.id, { skip: !plan?.id });
  const { data: features } = usePlanFeaturesByPlanQuery(plan?.id, { skip: !plan?.id });

  const ftById = useMemo(() => {
    const map = {};
    (featureTypes || []).forEach((f) => {
      map[f.id] = f;
    });
    return map;
  }, [featureTypes]);

  return (
    <Drawer title={plan ? `Plan — ${plan.name}` : 'Plan'} open={Boolean(plan)} onClose={onClose} width={560}>
      {plan && (
        <>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Name">{plan.name}</Descriptions.Item>
            <Descriptions.Item label="Status">
              <Tag color={plan.status === 'active' ? 'green' : 'default'}>{plan.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Description">{plan.description || '—'}</Descriptions.Item>
            <Descriptions.Item label="Type">
              {plan.plan_type === 'access_pass' ? (
                <Tag color="purple">Access Pass</Tag>
              ) : (
                <Tag color="blue">Subscription</Tag>
              )}
            </Descriptions.Item>
            {plan.plan_type === 'access_pass' ? (
              <Descriptions.Item label="Pass">
                ₹{plan.pass_price ?? '—'} / {plan.pass_days ?? '—'} days
              </Descriptions.Item>
            ) : (
              <Descriptions.Item label="Free trial">
                {plan.trial_days > 0 ? `${plan.trial_days} days` : 'None'}
              </Descriptions.Item>
            )}
            <Descriptions.Item label="Popular">{boolTag(plan.is_popular)}</Descriptions.Item>
            <Descriptions.Item label="Display order">{plan.display_order ?? 0}</Descriptions.Item>
          </Descriptions>

          <Title level={5} style={{ marginTop: 20 }}>
            Billing options
          </Title>
          <List
            size="small"
            bordered
            locale={{ emptyText: 'No billing options' }}
            dataSource={billing || []}
            renderItem={(b) => (
              <List.Item>
                <Space wrap>
                  <Tag>{b.billing_cycle}</Tag>
                  <Text strong>
                    {b.currency || 'INR'} {b.price}
                  </Text>
                  {b.discounted_price != null && (
                    <Text type="secondary">→ {b.discounted_price}</Text>
                  )}
                  {b.discount_label && <Tag color="orange">{b.discount_label}</Tag>}
                  <Tag color={b.is_active === 1 || b.is_active === true ? 'green' : 'default'}>
                    {b.is_active === 1 || b.is_active === true ? 'active' : 'inactive'}
                  </Tag>
                </Space>
              </List.Item>
            )}
          />

          <Title level={5} style={{ marginTop: 20 }}>
            Features
          </Title>
          <List
            size="small"
            bordered
            locale={{ emptyText: 'No features' }}
            dataSource={features || []}
            renderItem={(f) => {
              const ft = ftById[f.feature_type_id];
              return (
                <List.Item>
                  <Space wrap>
                    <Text>{f.display_label || ft?.label || `Feature #${f.feature_type_id}`}</Text>
                    <Text strong>{formatFeatureValue(f.value, ft?.data_type)}</Text>
                    {(f.show_on_card === 1 || f.show_on_card === true) && (
                      <Tag color="blue">on card</Tag>
                    )}
                  </Space>
                </List.Item>
              );
            }}
          />
        </>
      )}
    </Drawer>
  );
}
