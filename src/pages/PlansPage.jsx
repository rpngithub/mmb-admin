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
  Switch,
  Tooltip,
  Alert,
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
  useFeatureTypeMetersQuery,
  usePlanDeleteMutation,
  usePlanUpdateMutation,
  usePlanBillingOptionsByPlanQuery,
  usePlanFeaturesByPlanQuery,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import PlanEditorDrawer from './plan/PlanEditorDrawer';
import {
  NOT_ENFORCED_TOOLTIP,
  featureValueHint,
  freePlanStatusSentence,
  isFreePlan,
  isUnenforced,
  meterMap,
  meteredFeatureTypes,
} from '../lib/meteredFeatures';

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

function PlanTypeTag({ type }) {
  if (type === 'free') return <Tag color="cyan">Free tier</Tag>;
  if (type === 'access_pass') return <Tag color="purple">Access Pass</Tag>;
  return <Tag color="blue">Subscription</Tag>;
}

/**
 * Activate / deactivate the free plan. That switches limits on or off for every
 * user without a subscription, so it always goes through a Popconfirm stating
 * exactly that. A second active free plan is refused by the API (409).
 */
function FreePlanStatusToggle({ plan }) {
  const { message } = App.useApp();
  const [updatePlan, { isLoading }] = usePlanUpdateMutation();
  const active = plan.status === 'active';
  const next = active ? 'inactive' : 'active';

  const onConfirm = async () => {
    try {
      await updatePlan({ id: plan.uid, body: { status: next } }).unwrap();
      message.success(active ? 'Free plan deactivated' : 'Free plan activated');
    } catch (e) {
      message.error(e?.message || 'Could not change the free plan status.');
    }
  };

  return (
    <Popconfirm
      title={active ? 'Deactivate the free plan?' : 'Activate the free plan?'}
      description={freePlanStatusSentence(next)}
      okText={active ? 'Deactivate' : 'Activate'}
      okButtonProps={{ danger: active }}
      onConfirm={onConfirm}
    >
      <Switch
        size="small"
        checked={active}
        loading={isLoading}
        checkedChildren="On"
        unCheckedChildren="Off"
      />
    </Popconfirm>
  );
}

export default function PlansPage() {
  const perms = usePermissions();
  const { message } = App.useApp();

  const canCreate = perms.can('plans', 'create');
  const canUpdate = perms.can('plans', 'update');
  const canDelete = perms.can('plans', 'delete');

  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState({ open: false, plan: null });
  // By uid, so the view drawer follows the list (e.g. after a status toggle).
  const [viewUid, setViewUid] = useState(null);

  const { data, isLoading, isFetching, refetch } = adminApi.endpoints.plansList.useQuery();
  const [deletePlan] = usePlanDeleteMutation();
  const viewPlan = (data || []).find((p) => p.uid === viewUid) || null;

  // The free plan is pinned first; the rest keep the server's order.
  const rows = useMemo(() => {
    const all = [...(data || [])].sort((a, b) => isFreePlan(b) - isFreePlan(a));
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
      width: 150,
      render: (v, record) => (
        <Space size={6}>
          <Tag color={v === 'active' ? 'green' : 'default'}>{v || '—'}</Tag>
          {isFreePlan(record) && canUpdate && <FreePlanStatusToggle plan={record} />}
        </Space>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'plan_type',
      key: 'plan_type',
      width: 200,
      render: (v, record) => {
        const isPass = v === 'access_pass';
        if (v === 'free') {
          return (
            <Tooltip title={freePlanStatusSentence(record.status)}>
              <Tag color="cyan">Free tier</Tag>
            </Tooltip>
          );
        }
        return (
          <Space size={4} wrap>
            <PlanTypeTag type={v} />
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
          <Button size="small" icon={<EyeOutlined />} onClick={() => setViewUid(record.uid)} />
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

      <PlanViewDrawer
        plan={viewPlan}
        canUpdate={canUpdate}
        onClose={() => setViewUid(null)}
        onEdit={(p) => {
          setViewUid(null);
          setEditor({ open: true, plan: p });
        }}
      />
    </div>
  );
}


function PlanViewDrawer({ plan, canUpdate, onClose, onEdit }) {
  const { data: featureTypes } = adminApi.endpoints.featureTypesList.useQuery(undefined, {
    skip: !plan,
  });
  const { data: meters } = useFeatureTypeMetersQuery(undefined, { skip: !plan });
  const { data: billing } = usePlanBillingOptionsByPlanQuery(plan?.id, { skip: !plan?.id });
  const { data: features, isFetching: loadingFeatures } = usePlanFeaturesByPlanQuery(plan?.id, {
    skip: !plan?.id,
  });

  const ftById = useMemo(() => {
    const map = {};
    (featureTypes || []).forEach((f) => {
      map[f.id] = f;
    });
    return map;
  }, [featureTypes]);
  const meterByKey = useMemo(() => meterMap(meters), [meters]);

  // A plan with no row for a metered feature is UNLIMITED on it.
  const missingMetered = useMemo(() => {
    if (!features) return [];
    const held = new Set(features.map((f) => f.feature_type_id));
    return meteredFeatureTypes(featureTypes, meters).filter((f) => !held.has(f.id));
  }, [features, featureTypes, meters]);

  const isFree = isFreePlan(plan);

  return (
    <Drawer
      title={plan ? `Plan — ${plan.name}` : 'Plan'}
      open={Boolean(plan)}
      onClose={onClose}
      width={560}
      extra={
        plan && canUpdate ? (
          <Button icon={<EditOutlined />} onClick={() => onEdit(plan)}>
            Edit
          </Button>
        ) : null
      }
    >
      {plan && (
        <>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Name">{plan.name}</Descriptions.Item>
            <Descriptions.Item label="Status">
              <Space size={6} wrap>
                <Tag color={plan.status === 'active' ? 'green' : 'default'}>{plan.status}</Tag>
                {isFree && canUpdate && <FreePlanStatusToggle plan={plan} />}
              </Space>
              {isFree && (
                <div style={{ marginTop: 6 }}>
                  <Text type={plan.status === 'active' ? 'warning' : 'secondary'}>
                    {freePlanStatusSentence(plan.status)}
                  </Text>
                </div>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Description">{plan.description || '—'}</Descriptions.Item>
            <Descriptions.Item label="Type">
              <PlanTypeTag type={plan.plan_type} />
            </Descriptions.Item>
            {plan.plan_type === 'access_pass' && (
              <Descriptions.Item label="Pass">
                ₹{plan.pass_price ?? '—'} / {plan.pass_days ?? '—'} days
              </Descriptions.Item>
            )}
            {!isFree && plan.plan_type !== 'access_pass' && (
              <Descriptions.Item label="Free trial">
                {plan.trial_days > 0 ? `${plan.trial_days} days` : 'None'}
              </Descriptions.Item>
            )}
            <Descriptions.Item label="Popular">{boolTag(plan.is_popular)}</Descriptions.Item>
            <Descriptions.Item label="Display order">{plan.display_order ?? 0}</Descriptions.Item>
          </Descriptions>

          {!isFree && (
            <>
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
            </>
          )}

          <Title level={5} style={{ marginTop: 20 }}>
            Features
          </Title>
          {!loadingFeatures && missingMetered.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="These limits are not set, so this plan is unlimited on them"
              description={
                <div>
                  {missingMetered.map((f) => (
                    <div key={f.id}>
                      <Text strong>{f.label}</Text>: not set (unlimited)
                    </div>
                  ))}
                  {canUpdate && (
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      style={{ marginTop: 8 }}
                      onClick={() => onEdit(plan)}
                    >
                      Add in the editor
                    </Button>
                  )}
                </div>
              }
            />
          )}
          <List
            size="small"
            bordered
            locale={{ emptyText: 'No features' }}
            dataSource={features || []}
            renderItem={(f) => {
              const ft = ftById[f.feature_type_id];
              const hint = featureValueHint(ft, ft ? meterByKey.get(ft.key) : undefined);
              return (
                <List.Item>
                  <Space wrap>
                    <Text>{f.display_label || ft?.label || `Feature #${f.feature_type_id}`}</Text>
                    <Text strong>{formatFeatureValue(f.value, ft?.data_type)}</Text>
                    {hint && f.value !== -1 && <Text type="secondary">{hint}</Text>}
                    {ft && isUnenforced(ft, meters) && (
                      <Tooltip title={NOT_ENFORCED_TOOLTIP}>
                        <Tag color="red">Not enforced</Tag>
                      </Tooltip>
                    )}
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
