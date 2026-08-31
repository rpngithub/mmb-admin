import { useMemo, useState } from 'react';
import {
  Table,
  Typography,
  Space,
  Button,
  Select,
  Input,
  Switch,
  Tag,
  Tooltip,
  Collapse,
  Segmented,
  Alert,
  App,
} from 'antd';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  StopOutlined,
  HistoryOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import {
  adminApi,
  useNotificationTemplatesListQuery,
  useNotificationTemplateUpdateMutation,
  useNotificationTemplateRemoveMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import NotificationTemplateEditorDrawer from '../components/NotificationTemplateEditorDrawer';
import {
  DEACTIVATE_CONFIRM,
  PENDING_FEATURE_NOTE,
  PROMOTIONAL_EXPLAINER,
  ctaActionLabel,
  describeTrigger,
  errorText,
  isPendingFeature,
  isTrue,
} from '../lib/notifications';

const { Title, Text, Paragraph } = Typography;

const EMPTY_FILTERS = {
  search: '',
  category_id: undefined,
  trigger_type: undefined,
  is_active: undefined,
  is_system: undefined,
  is_promotional: undefined,
};

const UNCATEGORISED = '__none__';

/**
 * Notifications — the copy behind everything the app sends by itself.
 *
 * The list is NOT paginated: every row comes back in one call, so filtering and
 * sorting happen here. 43 rows in a flat table is a wall, so they are grouped
 * under their category by default.
 *
 * Four columns, not twenty. The Status switch PATCHes straight from the row,
 * because turning a notification off is the second most common thing anyone does
 * here and it should not need a drawer.
 */
export default function NotificationTemplatesPage() {
  const perms = usePermissions();
  const { message, modal } = App.useApp();

  const canCreate = perms.can('notifications', 'create');
  const canUpdate = perms.can('notifications', 'update');
  const canDelete = perms.can('notifications', 'delete');

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [grouped, setGrouped] = useState(true);
  const [editor, setEditor] = useState({ open: false, uid: null });
  const [busyUid, setBusyUid] = useState(null);

  const { data: categories } = adminApi.endpoints.notificationCategoriesList.useQuery();
  // No params: the endpoint returns every row, and the server-side filters would
  // only narrow what is already in hand.
  const { data, isLoading, isFetching, refetch } = useNotificationTemplatesListQuery();

  const [updateTemplate] = useNotificationTemplateUpdateMutation();
  const [removeTemplate] = useNotificationTemplateRemoveMutation();

  const all = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const triggerOptions = useMemo(() => {
    const seen = new Set();
    for (const t of all) if (t.trigger_type) seen.add(t.trigger_type);
    return [...seen].sort().map((v) => ({ value: v, label: v }));
  }, [all]);

  const rows = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return all.filter((t) => {
      if (filters.category_id !== undefined && t.category_id !== filters.category_id) return false;
      if (filters.trigger_type !== undefined && t.trigger_type !== filters.trigger_type) {
        return false;
      }
      if (filters.is_active !== undefined && isTrue(t.is_active) !== Boolean(filters.is_active)) {
        return false;
      }
      if (filters.is_system !== undefined && isTrue(t.is_system) !== Boolean(filters.is_system)) {
        return false;
      }
      if (
        filters.is_promotional !== undefined &&
        isTrue(t.is_promotional) !== Boolean(filters.is_promotional)
      ) {
        return false;
      }
      if (q) {
        const hay = `${t.title || ''} ${t.body || ''} ${t.code || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [all, filters]);

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const filtersActive = Object.entries(filters).some(([k, v]) =>
    k === 'search' ? v !== '' : v !== undefined,
  );

  const toggleActive = async (record, next) => {
    setBusyUid(record.uid);
    try {
      await updateTemplate({ uid: record.uid, body: { is_active: next ? 1 : 0 } }).unwrap();
      message.success(next ? 'Switched on' : 'Switched off');
    } catch (err) {
      message.error(errorText(err, 'Could not change the status.'));
    } finally {
      setBusyUid(null);
    }
  };

  // DELETE returns 200 but sets is_active = 0 — the row stays. A hard delete
  // would orphan every notification already in a user's inbox.
  const onDeactivate = (record) => {
    modal.confirm({
      title: `Deactivate “${record.title || record.code}”?`,
      content: DEACTIVATE_CONFIRM,
      okText: 'Deactivate',
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusyUid(record.uid);
        try {
          await removeTemplate(record.uid).unwrap();
          message.success('Deactivated — it stays on this list, switched off.');
        } catch (err) {
          message.error(errorText(err, 'Could not deactivate the notification.'));
        } finally {
          setBusyUid(null);
        }
      },
    });
  };

  const columns = [
    {
      title: 'Message',
      key: 'message',
      render: (_v, r) => (
        <Space direction="vertical" size={2} style={{ maxWidth: 520 }}>
          <Space size={6} wrap>
            <Text strong>{r.title || r.code}</Text>
            <Tag color={isTrue(r.is_system) ? 'purple' : 'blue'}>
              {isTrue(r.is_system) ? 'Built-in' : 'Custom'}
            </Tag>
            {isTrue(r.is_promotional) && (
              <Tooltip title={PROMOTIONAL_EXPLAINER}>
                <Tag color="magenta">Promotional</Tag>
              </Tooltip>
            )}
            {isPendingFeature(r) && (
              <Tooltip title={PENDING_FEATURE_NOTE}>
                <Tag icon={<ClockCircleOutlined />} color="warning">
                  Waiting on a feature
                </Tag>
              </Tooltip>
            )}
          </Space>
          <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
            {r.body || '—'}
          </Text>
          {r.cta_label ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Button: {r.cta_label}
              {r.cta_action ? ` → ${ctaActionLabel(r.cta_action)}` : ''}
            </Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: 'Category',
      key: 'category',
      width: 170,
      render: (_v, r) =>
        r.NotificationCategory?.name ? (
          <Tag>{r.NotificationCategory.name}</Tag>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      // Never the raw trigger_type or the trigger_config JSON — a sentence.
      title: 'Sends when',
      key: 'sends_when',
      width: 240,
      render: (_v, r) => <Text>{describeTrigger(r)}</Text>,
    },
    {
      title: 'Status',
      key: 'status',
      width: 130,
      render: (_v, r) =>
        canUpdate ? (
          <Space size={6}>
            <Switch
              size="small"
              checked={isTrue(r.is_active)}
              loading={busyUid === r.uid}
              onChange={(checked) => toggleActive(r, checked)}
            />
            {!isTrue(r.is_active) && <Tag>Off</Tag>}
          </Space>
        ) : (
          <Tag color={isTrue(r.is_active) ? 'green' : 'default'}>
            {isTrue(r.is_active) ? 'On' : 'Off'}
          </Tag>
        ),
    },
  ];

  if (canUpdate || canDelete) {
    columns.push({
      title: '',
      key: 'actions',
      width: 130,
      fixed: 'right',
      render: (_v, record) => (
        <Space size="small">
          {canUpdate && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditor({ open: true, uid: record.uid })}
              title="Edit"
            />
          )}
          <Tooltip title="Who actually received this">
            <Link to={`/notification-log?template_id=${record.id ?? ''}`}>
              <Button size="small" icon={<HistoryOutlined />} disabled={record.id == null} />
            </Link>
          </Tooltip>
          {canDelete && isTrue(record.is_active) && (
            <Tooltip title="Deactivate — it stops being sent, but stays on this list">
              <Button
                size="small"
                danger
                icon={<StopOutlined />}
                loading={busyUid === record.uid}
                onClick={() => onDeactivate(record)}
              />
            </Tooltip>
          )}
        </Space>
      ),
    });
  }

  const tableProps = {
    rowKey: 'uid',
    columns,
    size: 'middle',
    pagination: false,
    scroll: { x: 'max-content' },
  };

  // Grouped: one section per category, in the categories' own display order.
  const groups = useMemo(() => {
    const byKey = new Map();
    for (const r of rows) {
      const key = r.category_id ?? UNCATEGORISED;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(r);
    }
    const ordered = [...(categories || [])]
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
      .filter((c) => byKey.has(c.id))
      .map((c) => ({ key: String(c.id), name: c.name, rows: byKey.get(c.id) }));
    if (byKey.has(UNCATEGORISED)) {
      ordered.push({
        key: UNCATEGORISED,
        name: 'Uncategorised',
        rows: byKey.get(UNCATEGORISED),
      });
    }
    return ordered;
  }, [rows, categories]);

  const editingRow = all.find((r) => r.uid === editor.uid) || null;

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
          Notifications
        </Title>
        <Space wrap>
          <Link to="/notification-log">
            <Button icon={<HistoryOutlined />}>Delivery log</Button>
          </Link>
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
            Reload
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setEditor({ open: true, uid: null })}
            >
              New Notification
            </Button>
          )}
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Built-in notifications are yours to reword."
        description="Only the identifier and the trigger are fixed — they are wired to the app and to notifications already sent. Title, message, button, timing and the on/off switch are all editable. Switching one off never deletes it: the row stays here with an Off tag, because notifications already delivered still live in people’s inboxes."
      />

      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          placeholder="Search the wording"
          style={{ width: 220 }}
          value={filters.search}
          onChange={(e) => setFilter('search', e.target.value)}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Category"
          style={{ width: 190 }}
          value={filters.category_id}
          onChange={(v) => setFilter('category_id', v)}
          options={(categories || []).map((c) => ({ label: c.name, value: c.id }))}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Trigger"
          style={{ width: 170 }}
          value={filters.trigger_type}
          onChange={(v) => setFilter('trigger_type', v)}
          options={triggerOptions}
        />
        <Select
          allowClear
          placeholder="On / off"
          style={{ width: 120 }}
          value={filters.is_active}
          onChange={(v) => setFilter('is_active', v)}
          options={[
            { value: 1, label: 'On' },
            { value: 0, label: 'Off' },
          ]}
        />
        <Select
          allowClear
          placeholder="Built-in"
          style={{ width: 140 }}
          value={filters.is_system}
          onChange={(v) => setFilter('is_system', v)}
          options={[
            { value: 1, label: 'Built-in' },
            { value: 0, label: 'Custom' },
          ]}
        />
        <Select
          allowClear
          placeholder="Promotional"
          style={{ width: 160 }}
          value={filters.is_promotional}
          onChange={(v) => setFilter('is_promotional', v)}
          options={[
            { value: 1, label: 'Promotional' },
            { value: 0, label: 'Always sent' },
          ]}
        />
        {filtersActive && <Button onClick={() => setFilters(EMPTY_FILTERS)}>Clear</Button>}
        <Segmented
          value={grouped ? 'grouped' : 'flat'}
          onChange={(v) => setGrouped(v === 'grouped')}
          options={[
            { label: 'By category', value: 'grouped' },
            { label: 'Flat list', value: 'flat' },
          ]}
        />
      </Space>

      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {rows.length} of {all.length} notification{all.length === 1 ? '' : 's'}
      </Paragraph>

      {grouped ? (
        <Collapse
          defaultActiveKey={groups.map((g) => g.key)}
          // Remount when the set of groups changes so newly-matching sections
          // start open rather than collapsed.
          key={groups.map((g) => g.key).join(',')}
          items={groups.map((g) => ({
            key: g.key,
            label: (
              <Space size={8}>
                <Text strong>{g.name}</Text>
                <Text type="secondary">{g.rows.length}</Text>
              </Space>
            ),
            children: <Table {...tableProps} dataSource={g.rows} showHeader={false} />,
          }))}
        />
      ) : (
        <Table
          {...tableProps}
          dataSource={rows}
          loading={isLoading}
          locale={{
            emptyText: filtersActive ? 'Nothing matches.' : 'No notifications yet.',
          }}
        />
      )}

      {grouped && groups.length === 0 && !isLoading && (
        <Paragraph type="secondary">
          {filtersActive ? 'Nothing matches.' : 'No notifications yet.'}
        </Paragraph>
      )}

      <NotificationTemplateEditorDrawer
        open={editor.open}
        uid={editor.uid}
        row={editingRow}
        onClose={() => setEditor({ open: false, uid: null })}
        onSaved={refetch}
      />
    </div>
  );
}
