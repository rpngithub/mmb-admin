import { useMemo, useState } from 'react';
import {
  Table,
  Button,
  Space,
  Tag,
  Tooltip,
  Alert,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Typography,
  App,
} from 'antd';
import { PlusOutlined, ReloadOutlined, StopOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  adminApi,
  useUserQuotaGrantsQuery,
  useQuotaGrantCreateMutation,
  useQuotaGrantRevokeMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import {
  CONSUMED_EXPLAINER,
  GRANT_STATUS_COLORS,
  balancesByFeature,
  buildFeatureOptions,
  describeGrant,
  errorText,
  formatQuantity,
  remainingOf,
  unitFor,
} from '../lib/quotaPacks';

const { Text, Paragraph } = Typography;

const GRANT_FIELDS = ['feature', 'quantity', 'note'];

/**
 * Quota grants for one user — the support view.
 *
 * A grant is one block of quota the user holds: bought through the store, or
 * issued from here. The user's balance for a feature is the SUM OVER THEIR
 * ACTIVE GRANTS, so this table is the balance itself, not a report of it —
 * `pending` (an unconfirmed purchase) contributes nothing and is never counted
 * in the totals above the table, and `revoked` rows stay as the audit record.
 *
 * Everything here needs `quota_packs.update` (list + grant); revoking needs
 * `quota_packs.delete`.
 */
export default function UserQuotaGrantsPanel({ userUid, userLabel }) {
  const { message, modal } = App.useApp();
  const perms = usePermissions();
  const [form] = Form.useForm();

  const canGrant = perms.can('quota_packs', 'update');
  const canRevoke = perms.can('quota_packs', 'delete');

  const [grantOpen, setGrantOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [revokingUid, setRevokingUid] = useState(null);

  const { data: features } = adminApi.endpoints.featureTypesList.useQuery();
  const {
    data: grants,
    isLoading,
    isFetching,
    refetch,
  } = useUserQuotaGrantsQuery(userUid, { skip: !userUid });
  const [createGrant] = useQuotaGrantCreateMutation();
  const [revokeGrant] = useQuotaGrantRevokeMutation();

  // `feature` is the feature-type KEY here — a string, not the numeric id the
  // packs endpoint takes — because a human types it.
  const featureOptions = useMemo(
    () => buildFeatureOptions(features, { valueField: 'key' }),
    [features],
  );
  const featureByKey = useMemo(
    () => new Map((features || []).map((f) => [f.key, f])),
    [features],
  );

  const rows = grants || [];
  const balances = balancesByFeature(rows);

  const selectedKey = Form.useWatch('feature', form);
  const selectedUnit = unitFor(selectedKey);

  const openGrant = () => {
    form.resetFields();
    setFormError(null);
    setGrantOpen(true);
  };

  const doGrant = async (body) => {
    setSubmitting(true);
    try {
      await createGrant({ userUid, body }).unwrap();
      // Active immediately — there is no payment to wait for.
      message.success('Quota granted — it is active straight away.');
      setGrantOpen(false);
      refetch();
    } catch (err) {
      const details = Array.isArray(err?.details) ? err.details : [];
      const mapped = details.filter((d) => GRANT_FIELDS.includes(d.field));
      if (mapped.length) {
        form.setFields(mapped.map((d) => ({ name: d.field, errors: [d.message] })));
        setFormError(null);
      } else {
        setFormError(errorText(err, 'Could not create the grant.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitGrant = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setFormError(null);
    const body = {
      feature: values.feature,
      quantity: Number(values.quantity),
      note: (values.note || '').trim(),
    };
    const feature = featureByKey.get(values.feature);

    // Confirm in plain words: this is the only path that mints quota with no
    // payment behind it.
    modal.confirm({
      title: 'Grant this quota?',
      content: (
        <div>
          <Paragraph style={{ marginBottom: 8 }}>
            Grant <Text strong>{describeGrant(body.quantity, feature)}</Text> to{' '}
            <Text strong>{userLabel || 'this user'}</Text>. This does not expire.
          </Paragraph>
          <Text type="secondary">Reason: {body.note}</Text>
        </div>
      ),
      okText: 'Grant',
      onOk: () => doGrant(body),
    });
  };

  const onRevoke = (record) => {
    const feature = record.FeatureType || featureByKey.get(record.FeatureType?.key);
    modal.confirm({
      title: `Revoke ${describeGrant(record.quantity, feature)}?`,
      width: 560,
      content: (
        <div>
          <Paragraph style={{ marginBottom: 8 }}>
            The row stays as the audit record — it is marked revoked, not deleted.
          </Paragraph>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              It only withdraws what is <Text strong>left</Text>: the quantity and what has been
              consumed leave the balance together, so revoking a fully-spent grant changes nothing.
            </li>
            <li>
              For storage this can put the account <Text strong>over its limit</Text>. Further
              uploads are refused; nothing already stored is deleted.
            </li>
          </ul>
        </div>
      ),
      okText: 'Revoke',
      okButtonProps: { danger: true },
      onOk: async () => {
        setRevokingUid(record.uid);
        try {
          await revokeGrant({ uid: record.uid, userUid }).unwrap();
          message.success('Grant revoked');
          refetch();
        } catch (err) {
          message.error(errorText(err, 'Could not revoke the grant.'));
        } finally {
          setRevokingUid(null);
        }
      },
    });
  };

  const columns = [
    {
      title: 'Feature',
      key: 'feature',
      render: (_v, r) => <Tag>{r.FeatureType?.label || r.FeatureType?.key || '—'}</Tag>,
    },
    {
      title: 'Quantity',
      key: 'quantity',
      width: 120,
      render: (_v, r) => formatQuantity(r.quantity, r.FeatureType?.key),
    },
    {
      title: (
        <Space size={4}>
          Remaining
          <Tooltip title={CONSUMED_EXPLAINER}>
            <QuestionCircleOutlined style={{ color: '#999' }} />
          </Tooltip>
        </Space>
      ),
      key: 'remaining',
      width: 140,
      render: (_v, r) => (
        <Tooltip title={`Consumed: ${formatQuantity(r.consumed ?? 0, r.FeatureType?.key)}`}>
          <Text>{formatQuantity(remainingOf(r), r.FeatureType?.key)}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Source',
      key: 'source',
      width: 170,
      render: (_v, r) => (
        <Space direction="vertical" size={0}>
          <Text>{r.source || '—'}</Text>
          {r.QuotaPack?.name && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {r.QuotaPack.name}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 120,
      render: (_v, r) =>
        r.status === 'pending' ? (
          <Tooltip title="An unconfirmed purchase — it adds nothing to the balance until payment is confirmed, and it is not counted in the totals above.">
            <Tag color={GRANT_STATUS_COLORS.pending}>Pending</Tag>
          </Tooltip>
        ) : (
          <Tag color={GRANT_STATUS_COLORS[r.status] || 'default'}>{r.status || '—'}</Tag>
        ),
    },
    {
      title: 'Note',
      dataIndex: 'note',
      key: 'note',
      ellipsis: true,
      render: (v) => v || <Text type="secondary">—</Text>,
    },
    {
      title: 'Granted',
      key: 'granted_at',
      width: 130,
      render: (_v, r) => {
        const at = r.granted_at || r.created_at;
        return at && dayjs(at).isValid() ? dayjs(at).format('YYYY-MM-DD') : '—';
      },
    },
  ];

  if (canRevoke) {
    columns.push({
      title: '',
      key: 'actions',
      width: 60,
      render: (_v, record) => {
        // Only an `active` grant can be revoked. A pending one is an
        // unconfirmed purchase and 409s — the honest fix there is a refund, so
        // the action is disabled rather than the error surfaced.
        const disabled = record.status !== 'active';
        return (
          <Tooltip
            title={
              disabled
                ? record.status === 'pending'
                  ? 'An unconfirmed purchase can’t be revoked — refund it instead.'
                  : 'Already revoked.'
                : 'Revoke this grant'
            }
          >
            <Button
              size="small"
              danger
              icon={<StopOutlined />}
              disabled={disabled}
              loading={revokingUid === record.uid}
              onClick={() => onRevoke(record)}
            />
          </Tooltip>
        );
      },
    });
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <Space wrap size={6}>
          <Text type="secondary">Active balance:</Text>
          {balances.length ? (
            balances.map((b) => (
              <Tag key={b.key} color="blue">
                {b.label}: {formatQuantity(b.remaining, b.key)}
              </Tag>
            ))
          ) : (
            <Text type="secondary">nothing on top of the plan allowance.</Text>
          )}
        </Space>
        <Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
            Reload
          </Button>
          {canGrant && (
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openGrant}>
              Grant quota
            </Button>
          )}
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="These grants ARE the user’s top-up balance — the sum of the active ones, on top of their plan allowance. A top-up never expires."
        description="Pending rows are unconfirmed purchases and count for nothing until payment lands; revoked rows are kept as the record of what happened."
      />

      <Table
        rowKey="uid"
        size="small"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        scroll={{ x: 'max-content' }}
        pagination={false}
        locale={{ emptyText: 'No top-ups — this user is on their plan allowance alone.' }}
      />

      <Modal
        title="Grant quota"
        open={grantOpen}
        onCancel={() => setGrantOpen(false)}
        onOk={submitGrant}
        okText="Review"
        confirmLoading={submitting}
        destroyOnClose
      >
        {formError && (
          <Alert type="error" showIcon style={{ marginBottom: 12 }} message={formError} />
        )}
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="This mints quota with no payment behind it, and it never expires."
        />
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="feature"
            label="Feature"
            rules={[{ required: true, message: 'Pick the feature to top up' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Pick a feature"
              options={featureOptions}
              notFoundContent="No feature is enabled for top-ups yet — turn one on from Feature Types."
            />
          </Form.Item>
          <Form.Item
            name="quantity"
            label="Quantity"
            extra={
              selectedUnit.suffix
                ? 'In megabytes — this feature’s own unit.'
                : 'In the feature’s own unit.'
            }
            rules={[{ required: true, message: 'How much?' }]}
          >
            <InputNumber
              min={1}
              precision={0}
              style={{ width: 220 }}
              addonAfter={selectedUnit.suffix || undefined}
            />
          </Form.Item>
          {/* Required by the API AND on purpose: a grant with no reason is
              indistinguishable from a mistake six months later. */}
          <Form.Item
            name="note"
            label="Reason"
            extra="Include the ticket reference — this is the only record of why the quota was issued."
            rules={[
              { required: true, message: 'A reason is required' },
              { max: 255, message: 'At most 255 characters' },
            ]}
          >
            <Input.TextArea rows={2} placeholder="e.g. Ticket 4821 — generation failed" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
