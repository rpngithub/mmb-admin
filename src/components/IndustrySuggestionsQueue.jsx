import { useMemo, useState } from 'react';
import { Table, Typography, Space, Button, Alert, Empty, App } from 'antd';
import { ReloadOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  adminApi,
  useBusinessCategoriesFilteredQuery,
  useBusinessCategorySetStatusMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';

const { Text, Paragraph } = Typography;

/**
 * Industry suggestions — the moderation queue.
 *
 * At signup a user picks an industry, then a sub-industry. If theirs isn't listed
 * they choose "Other" and type it; that becomes a PENDING industry parented to the
 * one they did find, and their business is linked to it straight away — but it is
 * invisible everywhere public until approved here.
 *
 * Approval goes through `status`, never `is_active`. The two are separate on
 * purpose: `status` is the moderation verdict, `is_active` is whether it is
 * currently offered. Sending { status:'approved' } flips is_active to 1 for you;
 * sending is_active by hand does NOT approve. That separation is what lets an
 * admin retire an approved industry later without it dropping back into this
 * queue.
 */
export default function IndustrySuggestionsQueue() {
  const perms = usePermissions();
  const { message, modal } = App.useApp();
  const canUpdate = perms.can('categories', 'update');

  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isFetching, refetch } = useBusinessCategoriesFilteredQuery({
    status: 'pending',
  });
  // The full tree, for resolving the parent industry each suggestion sits under.
  const { data: allCategories } = adminApi.endpoints.businessCategoriesList.useQuery();
  const [setStatus] = useBusinessCategorySetStatusMutation();

  const rows = useMemo(() => data || [], [data]);

  const parentNameById = useMemo(() => {
    const m = new Map();
    (allCategories || []).forEach((c) => m.set(c.id, c.name));
    return m;
  }, [allCategories]);

  /**
   * Apply one verdict to a set of rows. Each PATCH is independent, so a partial
   * failure is real — report how many landed rather than pretending it was atomic.
   */
  const applyStatus = async (records, status) => {
    setBusy(true);
    try {
      const results = await Promise.allSettled(
        records.map((r) => setStatus({ uid: r.uid, status }).unwrap()),
      );
      const failed = results.filter((r) => r.status === 'rejected');
      const ok = results.length - failed.length;
      const verb = status === 'approved' ? 'approved' : 'rejected';
      if (failed.length === 0) {
        message.success(`${ok} ${ok === 1 ? 'suggestion' : 'suggestions'} ${verb}`);
      } else if (ok === 0) {
        message.error(failed[0].reason?.message || `Could not ${status.slice(0, -1)} the suggestion.`);
      } else {
        message.warning(`${ok} ${verb}, ${failed.length} failed — the failures are still listed.`);
      }
      setSelected((ids) => {
        const done = new Set(
          records.filter((_r, i) => results[i].status === 'fulfilled').map((r) => r.uid),
        );
        return ids.filter((id) => !done.has(id));
      });
    } finally {
      setBusy(false);
    }
  };

  const approve = (records) => applyStatus(records, 'approved');

  const reject = (records) => {
    const many = records.length > 1;
    modal.confirm({
      title: many
        ? `Reject ${records.length} suggestions?`
        : `Reject "${records[0]?.name}"?`,
      content: (
        <>
          <Paragraph style={{ marginBottom: 8 }}>
            Rejecting is permanent for {many ? 'these names' : 'this name'} — nobody can suggest{' '}
            {many ? 'them' : 'it'} again.
          </Paragraph>
          <Text type="secondary">
            Businesses currently pointing at {many ? 'them' : 'it'} keep the link, but it stays
            invisible everywhere public.
          </Text>
        </>
      ),
      okText: 'Reject',
      okButtonProps: { danger: true },
      onOk: () => applyStatus(records, 'rejected'),
    });
  };

  const selectedRows = rows.filter((r) => selected.includes(r.uid));

  const columns = [
    {
      title: 'Suggested industry',
      dataIndex: 'name',
      key: 'name',
      render: (v) => <Text strong>{v}</Text>,
    },
    {
      title: 'Under',
      key: 'parent',
      width: 200,
      render: (_v, r) =>
        r.parent_id != null ? (
          parentNameById.get(r.parent_id) || <Text type="secondary">#{r.parent_id}</Text>
        ) : (
          <Text type="secondary">Top-level</Text>
        ),
    },
    {
      title: 'Suggested by',
      key: 'suggestedBy',
      width: 220,
      // null for admin-created industries that happen to sit at pending.
      render: (_v, r) =>
        r.suggestedBy ? (
          <div>
            <div>{r.suggestedBy.name || <Text type="secondary">Unnamed</Text>}</div>
            {r.suggestedBy.phone && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {r.suggestedBy.phone}
              </Text>
            )}
          </div>
        ) : (
          <Text type="secondary">Admin-created</Text>
        ),
    },
    {
      title: 'Suggested',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 130,
      render: (v) => (v && dayjs(v).isValid() ? dayjs(v).format('YYYY-MM-DD') : '—'),
    },
  ];

  if (canUpdate) {
    columns.push({
      title: 'Actions',
      key: 'actions',
      width: 190,
      fixed: 'right',
      render: (_v, record) => (
        <Space size="small">
          <Button
            size="small"
            type="primary"
            icon={<CheckOutlined />}
            disabled={busy}
            onClick={() => approve([record])}
          >
            Approve
          </Button>
          <Button
            size="small"
            danger
            icon={<CloseOutlined />}
            disabled={busy}
            onClick={() => reject([record])}
          >
            Reject
          </Button>
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
        <Space wrap>
          {canUpdate && selected.length > 0 && (
            <>
              <Text type="secondary">{selected.length} selected</Text>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                loading={busy}
                onClick={() => approve(selectedRows)}
              >
                Approve selected
              </Button>
              <Button danger icon={<CloseOutlined />} disabled={busy} onClick={() => reject(selectedRows)}>
                Reject selected
              </Button>
            </>
          )}
        </Space>
        <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
          Reload
        </Button>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Users typed these in at signup when their industry wasn't listed."
        description={
          canUpdate
            ? 'Approving takes effect immediately — businesses already pointing at a suggestion start showing it publicly with no further action. Rejecting is permanent for that name.'
            : 'You need the categories “update” permission to approve or reject.'
        }
      />

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        size="middle"
        rowSelection={
          canUpdate
            ? { selectedRowKeys: selected, onChange: setSelected, preserveSelectedRowKeys: false }
            : undefined
        }
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Nothing waiting — every suggested industry has been dealt with."
            />
          ),
        }}
      />
    </div>
  );
}
