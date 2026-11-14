import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import {
  Alert,
  App,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { adminApi } from '../../features/api/adminApi';
import { usePermissions } from '../../features/auth/usePermissions';
import {
  applyServerErrors,
  costUnitLabel,
  errorText,
  formatDate,
  formatInr,
  formatNumber,
  isPostpaid,
  matchesRef,
  refOf,
  toNum,
} from '../../lib/ai';
import AiServerErrors from '../../components/ai/AiServerErrors';

const { Title, Text } = Typography;

const FORM_FIELDS = [
  'provider_id',
  'purchased_at',
  'credits_received',
  'amount_paid_inr',
  'amount_foreign',
  'currency',
  'note',
];

function PurchaseDrawer({ open, record, providers, defaultProviderId, onClose }) {
  const isEdit = Boolean(record);
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [create, { isLoading: creating }] = adminApi.endpoints.aiPurchaseCreate.useMutation();
  const [update, { isLoading: updating }] = adminApi.endpoints.aiPurchaseUpdate.useMutation();
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.resetFields();
    if (record) {
      form.setFieldsValue({
        provider_id: record.provider_id ?? refOf(record.provider),
        purchased_at: record.purchased_at ? dayjs(record.purchased_at) : undefined,
        credits_received: toNum(record.credits_received),
        amount_paid_inr: toNum(record.amount_paid_inr),
        amount_foreign: toNum(record.amount_foreign),
        currency: record.currency || undefined,
        note: record.note || undefined,
      });
    } else {
      form.setFieldsValue({ provider_id: defaultProviderId, purchased_at: dayjs() });
    }
  }, [open, record, form, defaultProviderId]);

  const credits = Form.useWatch('credits_received', form);
  const paid = Form.useWatch('amount_paid_inr', form);
  const providerId = Form.useWatch('provider_id', form);
  const perCredit = toNum(credits) > 0 && toNum(paid) !== null ? toNum(paid) / toNum(credits) : null;
  // For a POSTPAID provider a row is an INVOICE: credits_received = units
  // billed (US cents for Google), amount_paid_inr = rupees paid. It overrides
  // the provider's settings.inr_per_unit once one exists.
  const provider = providers.find((p) => matchesRef(p, providerId)) || record?.provider;
  const invoice = isPostpaid(provider);
  const unitName = costUnitLabel(provider?.cost_unit);

  const submit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setFormError(null);
    const body = {
      provider_id: values.provider_id,
      purchased_at: values.purchased_at ? values.purchased_at.format('YYYY-MM-DD') : null,
      credits_received: values.credits_received,
      amount_paid_inr: values.amount_paid_inr,
      amount_foreign: values.amount_foreign ?? null,
      currency: values.currency ? values.currency.toUpperCase() : null,
      note: values.note?.trim() ? values.note.trim() : null,
    };
    try {
      if (isEdit) await update({ uid: record.uid, body }).unwrap();
      else await create(body).unwrap();
      message.success('Saved — the provider’s cost per unit has been recomputed.');
      onClose();
    } catch (err) {
      setFormError(
        applyServerErrors(
          form,
          err,
          FORM_FIELDS,
          invoice ? 'Could not save the invoice.' : 'Could not save the purchase.',
        ),
      );
    }
  };

  const title = invoice
    ? isEdit
      ? 'Edit invoice'
      : 'Record an invoice'
    : isEdit
      ? 'Edit credit purchase'
      : 'Record a credit purchase';

  return (
    <Drawer
      title={title}
      open={open}
      onClose={onClose}
      width={520}
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={creating || updating} onClick={submit}>
            Save
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" requiredMark="optional">
        <AiServerErrors error={formError} />
        {invoice && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Postpaid provider — record a monthly invoice"
            description={`Units billed and the rupees paid for them. Once an invoice exists, its rate (₹ per ${unitName}) overrides the provider’s “Rupees per provider unit” setting.`}
          />
        )}
        <Form.Item name="provider_id" label="Provider" rules={[{ required: true }]}>
          <Select
            showSearch
            optionFilterProp="label"
            options={providers.map((p) => ({
              value: refOf(p),
              label: `${p.name} (${p.key})${isPostpaid(p) ? ' — postpaid' : ''}`,
            }))}
          />
        </Form.Item>
        <Form.Item
          name="purchased_at"
          label={invoice ? 'Invoice date' : 'Purchased on'}
          rules={[{ required: true }]}
        >
          <DatePicker style={{ width: '100%' }} format="DD MMM YYYY" />
        </Form.Item>
        <Form.Item
          name="credits_received"
          label={invoice ? 'Units billed' : 'Credits received'}
          rules={[
            {
              required: true,
              message: invoice ? 'How many units does the invoice bill?' : 'How many provider credits arrived?',
            },
          ]}
          extra={
            invoice
              ? `In the provider’s billing unit (${unitName}${provider?.cost_unit === 'usd_cent' ? 's — e.g. $12.34 = 1234' : 's'}).`
              : 'In the provider’s own units.'
          }
        >
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="amount_paid_inr"
          label="Amount paid (₹)"
          rules={[{ required: true, message: 'Enter what was paid in rupees' }]}
          extra={
            invoice
              ? 'The rupees paid for this invoice, incl. bank forex markup and GST.'
              : 'The rupees on the card statement, incl. bank forex markup and GST.'
          }
        >
          <InputNumber min={0} step={0.01} style={{ width: '100%' }} prefix="₹" />
        </Form.Item>
        <Space size="middle" align="start" style={{ display: 'flex' }}>
          <Form.Item name="amount_foreign" label="Amount (foreign)">
            <InputNumber min={0} step={0.01} style={{ width: 200 }} />
          </Form.Item>
          <Form.Item
            name="currency"
            label="Currency"
            normalize={(v) => (v ? v.toUpperCase() : v)}
            rules={[{ pattern: /^[A-Za-z]{3}$/, message: '3 letters, e.g. USD' }]}
          >
            <Input maxLength={3} style={{ width: 100 }} placeholder="USD" />
          </Form.Item>
        </Space>
        <Form.Item name="note" label="Note">
          <Input.TextArea rows={3} />
        </Form.Item>
        {perCredit !== null && (
          <Text type="secondary">
            This {invoice ? 'invoice' : 'purchase'} alone works out at{' '}
            {formatInr(perCredit, { digits: 4 })} per {invoice ? unitName : 'credit'}.
          </Text>
        )}
      </Form>
    </Drawer>
  );
}

/**
 * Credit purchases — what we paid a provider for its prepaid credits. These
 * drive each provider's cost per unit (and so Health + the margin report).
 */
export default function AiPurchasesPage() {
  const perms = usePermissions();
  const { message, modal } = App.useApp();
  const canCreate = perms.can('ai_providers', 'create');
  const canUpdate = perms.can('ai_providers', 'update');
  const canDelete = perms.can('ai_providers', 'delete');

  const [providerId, setProviderId] = useState();
  const [editor, setEditor] = useState({ open: false, record: null });

  const { data: providers = [] } = adminApi.endpoints.aiProvidersList.useQuery();
  const { data, isLoading, isFetching, refetch } = adminApi.endpoints.aiPurchasesList.useQuery({
    provider_id: providerId,
  });
  const [remove] = adminApi.endpoints.aiPurchaseRemove.useMutation();
  const rows = data?.items || [];

  const providerName = useMemo(
    () => (row) => {
      const p = row.provider || providers.find((x) => matchesRef(x, row.provider_id));
      return p ? p.name || p.key : String(row.provider_id ?? '—');
    },
    [providers],
  );

  const onDelete = (record) => {
    modal.confirm({
      title: 'Delete this purchase?',
      content: 'The provider’s cost per unit is recomputed without it.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await remove(record.uid).unwrap();
          message.success('Purchase deleted');
        } catch (err) {
          message.error(errorText(err, 'Could not delete the purchase.'));
        }
      },
    });
  };

  const columns = [
    { title: 'Purchased', dataIndex: 'purchased_at', key: 'purchased_at', render: formatDate },
    {
      title: 'Provider',
      key: 'provider',
      render: (_v, r) => {
        const p = providers.find((x) => matchesRef(x, r.provider_id ?? refOf(r.provider))) || r.provider;
        return (
          <Space size={4}>
            {providerName(r)}
            {isPostpaid(p) && <Tag color="purple">invoice</Tag>}
          </Space>
        );
      },
    },
    {
      title: (
        <Tooltip title="Credits received — or, for a postpaid provider's invoice, units billed (US cents for Google).">
          Credits / units
        </Tooltip>
      ),
      dataIndex: 'credits_received',
      key: 'credits',
      align: 'right',
      render: (v) => formatNumber(v),
    },
    {
      title: 'Paid (₹)',
      dataIndex: 'amount_paid_inr',
      key: 'paid',
      align: 'right',
      render: (v) => formatInr(v, { digits: 2 }),
    },
    {
      title: 'Foreign',
      key: 'foreign',
      align: 'right',
      render: (_v, r) =>
        r.amount_foreign === null || r.amount_foreign === undefined
          ? '—'
          : `${formatNumber(r.amount_foreign)} ${r.currency || ''}`,
    },
    {
      title: '₹ / unit',
      key: 'per',
      align: 'right',
      render: (_v, r) =>
        toNum(r.credits_received) > 0
          ? formatInr(toNum(r.amount_paid_inr) / toNum(r.credits_received), { digits: 4 })
          : '—',
    },
    { title: 'Note', dataIndex: 'note', key: 'note', ellipsis: true, render: (v) => v || '—' },
  ];
  if (canUpdate || canDelete) {
    columns.push({
      title: 'Actions',
      key: 'actions',
      fixed: 'right',
      render: (_v, r) => (
        <Space size="small">
          {canUpdate && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditor({ open: true, record: r })}
            />
          )}
          {canDelete && (
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(r)} />
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
          Credit Purchases
        </Title>
        <Space wrap>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="All providers"
            style={{ width: 220 }}
            value={providerId}
            onChange={setProviderId}
            options={providers.map((p) => ({ value: refOf(p), label: p.name || p.key }))}
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
              Record purchase
            </Button>
          )}
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Each provider’s cost per unit is computed from these purchases."
        description="Adding, editing or deleting a purchase recomputes it, and with it the Health balance and the margin report. For a postpaid provider each row is a monthly invoice (units billed, rupees paid) and overrides its “Rupees per provider unit” setting."
      />

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: 'No purchases recorded.' }}
      />

      <PurchaseDrawer
        open={editor.open}
        record={editor.record}
        providers={providers}
        defaultProviderId={providerId}
        onClose={() => setEditor({ open: false, record: null })}
      />
    </div>
  );
}
