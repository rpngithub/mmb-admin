import { useMemo, useState } from 'react';
import { Table, Typography, Space, Button, Select, Tag, Tooltip, Progress, Alert, App } from 'antd';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  EyeOutlined,
  StopOutlined,
  DeleteOutlined,
  HistoryOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  useNotificationCampaignsListQuery,
  useNotificationTemplatesListQuery,
  useNotificationCampaignCancelMutation,
  useNotificationCampaignRemoveMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import NotificationCampaignEditorDrawer from '../components/NotificationCampaignEditorDrawer';
import {
  BYPASS_FATIGUE_SCOPE,
  CAMPAIGN_STATUS_COLORS,
  CAMPAIGN_STATUS_OPTIONS,
  CANCEL_CONFIRM_NOTE,
  SEND_NOW_PACING_NOTE,
  campaignStatusLabel,
  describeAudience,
  errorText,
  isCampaignEditable,
  isTrue,
} from '../lib/notifications';

const { Title, Text } = Typography;

// A batch job writes a large campaign out every 5 minutes, so a slow poll is
// enough to show a climbing count — and a fast one would just add load.
const SENDING_POLL_MS = 30000;

const num = (v) => (v == null ? 0 : Number(v) || 0);

/**
 * Campaigns — one-off blasts, on `notification_campaigns` (super_admin only).
 * Editing the wording of a notification and blasting an unsolicited message to
 * every user on the platform are different authorities.
 *
 * NOT paginated — the list comes back whole; `status` and `template_id` are the
 * server-side filters.
 *
 * `status` is not writable: it moves through schedule / send-now / cancel only.
 * Anything past draft/scheduled cannot be edited (403), so those rows open
 * read-only with a "duplicate into a new draft" route out.
 */
export default function NotificationCampaignsPage() {
  const perms = usePermissions();
  const { message, modal } = App.useApp();

  const canCreate = perms.can('notification_campaigns', 'create');
  const canUpdate = perms.can('notification_campaigns', 'update');
  const canDelete = perms.can('notification_campaigns', 'delete');
  const canReadLog = perms.canRead('notifications');

  const [filters, setFilters] = useState({ status: undefined, template_id: undefined });
  const [editor, setEditor] = useState({ open: false, uid: null });
  const [busyUid, setBusyUid] = useState(null);

  const queryArg = useMemo(
    () => ({ status: filters.status, template_id: filters.template_id }),
    [filters],
  );

  const { data, isLoading, isFetching, refetch } = useNotificationCampaignsListQuery(queryArg);
  const { data: templates } = useNotificationTemplatesListQuery();

  const rows = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const anySending = rows.some((r) => r.status === 'sending');

  // Re-subscribe with a poll only while something is actually in flight.
  useNotificationCampaignsListQuery(queryArg, {
    skip: !anySending,
    pollingInterval: SENDING_POLL_MS,
  });

  const [cancelCampaign] = useNotificationCampaignCancelMutation();
  const [removeCampaign] = useNotificationCampaignRemoveMutation();

  const templateOptions = useMemo(
    () =>
      (Array.isArray(templates) ? templates : []).map((t) => ({
        value: t.id,
        label: t.title ? `${t.title} (${t.code})` : t.code,
      })),
    [templates],
  );

  const onCancel = (record) => {
    modal.confirm({
      title: `Cancel “${record.name || record.title || record.uid}”?`,
      content:
        record.status === 'sending'
          ? `Cancelling stops the remaining batches. ${CANCEL_CONFIRM_NOTE}`
          : `The campaign will not go out. ${CANCEL_CONFIRM_NOTE}`,
      okText: 'Cancel campaign',
      okButtonProps: { danger: true },
      cancelText: 'Leave it',
      onOk: async () => {
        setBusyUid(record.uid);
        try {
          await cancelCampaign(record.uid).unwrap();
          message.success('Campaign cancelled');
        } catch (err) {
          message.error(errorText(err, 'Could not cancel the campaign.'));
        } finally {
          setBusyUid(null);
        }
      },
    });
  };

  const onDelete = (record) => {
    modal.confirm({
      title: `Delete “${record.name || record.title || record.uid}”?`,
      content: `This removes the campaign record. ${CANCEL_CONFIRM_NOTE} They stay in the delivery log too.`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusyUid(record.uid);
        try {
          await removeCampaign(record.uid).unwrap();
          message.success('Campaign deleted');
        } catch (err) {
          message.error(errorText(err, 'Could not delete the campaign.'));
        } finally {
          setBusyUid(null);
        }
      },
    });
  };

  const columns = [
    {
      title: 'Campaign',
      key: 'name',
      render: (_v, r) => (
        <Space direction="vertical" size={2}>
          <Space size={6} wrap>
            <Text strong>{r.name || r.title || <Text type="secondary">(untitled draft)</Text>}</Text>
            {isTrue(r.bypass_fatigue) && (
              <Tooltip title={`Ignores the limits on how many notifications someone can receive. ${BYPASS_FATIGUE_SCOPE}`}>
                <Tag color="volcano" icon={<ThunderboltOutlined />}>
                  limits bypassed
                </Tag>
              </Tooltip>
            )}
          </Space>
          {r.title && r.name ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              “{r.title}”
            </Text>
          ) : null}
          <Text type="secondary" style={{ fontSize: 12 }}>
            {describeAudience(r.audience)}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (v) => (
        <Tag color={CAMPAIGN_STATUS_COLORS[v] || 'default'}>{campaignStatusLabel(v)}</Tag>
      ),
    },
    {
      title: 'Progress',
      key: 'progress',
      width: 260,
      render: (_v, r) => {
        const audience = num(r.audience_count);
        const sent = num(r.sent_count);
        const skipped = num(r.skipped_count);
        const failed = num(r.failed_count);
        const done = sent + skipped + failed;

        if (r.status === 'draft' || r.status === 'scheduled') {
          return (
            <Text type="secondary">
              {audience ? `${audience.toLocaleString('en-IN')} in audience` : 'Not previewed yet'}
            </Text>
          );
        }
        const pct = audience > 0 ? Math.min(100, Math.round((done / audience) * 100)) : 0;
        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Progress
              percent={pct}
              size="small"
              status={
                r.status === 'sending' ? 'active' : r.status === 'failed' ? 'exception' : 'normal'
              }
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {sent.toLocaleString('en-IN')} sent
              {skipped ? ` · ${skipped.toLocaleString('en-IN')} skipped` : ''}
              {failed ? ` · ${failed.toLocaleString('en-IN')} failed` : ''}
              {audience ? ` of ${audience.toLocaleString('en-IN')}` : ''}
            </Text>
          </Space>
        );
      },
    },
    {
      title: 'Scheduled',
      dataIndex: 'scheduled_at',
      key: 'scheduled_at',
      width: 160,
      render: (v) =>
        v && dayjs(v).isValid() ? (
          <Tooltip title={dayjs(v).format('YYYY-MM-DD HH:mm:ss')}>
            {dayjs(v).format('YYYY-MM-DD HH:mm')}
          </Tooltip>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 160,
      fixed: 'right',
      render: (_v, record) => {
        const editable = isCampaignEditable(record);
        const cancellable = record.status === 'scheduled' || record.status === 'sending';
        return (
          <Space size="small">
            <Tooltip title={editable ? 'Edit' : 'View — this campaign can no longer be edited'}>
              <Button
                size="small"
                icon={editable && canUpdate ? <EditOutlined /> : <EyeOutlined />}
                onClick={() => setEditor({ open: true, uid: record.uid })}
              />
            </Tooltip>
            {canReadLog && record.status !== 'draft' && (
              <Tooltip title="What this campaign actually delivered">
                <Link to={`/notification-log?campaign_id=${record.id ?? ''}`}>
                  <Button size="small" icon={<HistoryOutlined />} disabled={record.id == null} />
                </Link>
              </Tooltip>
            )}
            {canUpdate && cancellable && (
              <Tooltip title="Cancel — stops what has not gone out yet">
                <Button
                  size="small"
                  danger
                  icon={<StopOutlined />}
                  loading={busyUid === record.uid}
                  onClick={() => onCancel(record)}
                />
              </Tooltip>
            )}
            {canDelete && (record.status === 'draft' || record.status === 'cancelled') && (
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                loading={busyUid === record.uid}
                onClick={() => onDelete(record)}
                title="Delete"
              />
            )}
          </Space>
        );
      },
    },
  ];

  const filtersActive = Object.values(filters).some((v) => v !== undefined);

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
          Campaigns
        </Title>
        <Space wrap>
          {canReadLog && (
            <Link to="/notification-log">
              <Button icon={<HistoryOutlined />}>Delivery log</Button>
            </Link>
          )}
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
            Reload
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setEditor({ open: true, uid: null })}
            >
              New Campaign
            </Button>
          )}
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="A campaign is a one-off blast, previewed before it goes anywhere."
        description={`${SEND_NOW_PACING_NOTE} A campaign that has started sending can no longer be edited — duplicate it into a new draft instead.`}
      />

      {anySending && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="A campaign is sending right now."
          description="The counts below refresh every 30 seconds. The delivered total lands below the audience count — recipients who muted the category, opted out of marketing, or have hit their daily or weekly limit are skipped."
        />
      )}

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="Status"
          style={{ width: 180 }}
          value={filters.status}
          onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          options={CAMPAIGN_STATUS_OPTIONS}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Based on notification"
          style={{ width: 280 }}
          value={filters.template_id}
          onChange={(v) => setFilters((f) => ({ ...f, template_id: v }))}
          options={templateOptions}
        />
        {filtersActive && (
          <Button onClick={() => setFilters({ status: undefined, template_id: undefined })}>
            Clear
          </Button>
        )}
      </Space>

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        scroll={{ x: 'max-content' }}
        size="middle"
        pagination={false}
        locale={{
          emptyText: filtersActive
            ? 'No campaigns match.'
            : 'No campaigns yet — write one, choose who gets it, preview it, then send.',
        }}
      />

      <NotificationCampaignEditorDrawer
        open={editor.open}
        uid={editor.uid}
        onClose={() => setEditor({ open: false, uid: null })}
        onSaved={refetch}
      />
    </div>
  );
}
