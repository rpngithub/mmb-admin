import { useMemo, useState } from 'react';
import { Table, Typography, Space, Input, Button, Tag, App } from 'antd';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { adminApi } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import ImageThumb from '../components/ImageThumb';
import SpecialEventEditorDrawer from '../components/SpecialEventEditorDrawer';

const { Title, Text } = Typography;

const isTrue = (v) => v === true || v === 1 || v === '1';

const TYPE_COLOR = {
  holiday: 'red',
  observance: 'blue',
  awareness: 'purple',
  custom: 'default',
};

/**
 * Render the event's date. Recurring events show the annual "MM-DD" as
 * "Dec 25 (yearly)"; one-off events show their concrete full_date.
 */
function formatWhen(ev) {
  if (isTrue(ev.is_recurring) && ev.event_date) {
    const [mm, dd] = String(ev.event_date).split('-');
    const d = dayjs(`2000-${mm}-${dd}`);
    const label = d.isValid() ? d.format('MMM D') : ev.event_date;
    return `${label} (yearly)`;
  }
  if (ev.full_date) return dayjs(ev.full_date).format('MMM D, YYYY');
  if (ev.event_date) {
    const [mm, dd] = String(ev.event_date).split('-');
    const d = dayjs(`2000-${mm}-${dd}`);
    return d.isValid() ? d.format('MMM D') : ev.event_date;
  }
  return '—';
}

/**
 * Special Events list: a calendar-style table of recurring/one-off events with
 * their type, date and cover thumbnail. Create/edit open the tabbed editor
 * (details + design linking). Row/new actions are permission-gated on events.*.
 */
export default function SpecialEventsPage() {
  const perms = usePermissions();
  const { message, modal } = App.useApp();

  const canCreate = perms.can('events', 'create');
  const canUpdate = perms.can('events', 'update');
  const canDelete = perms.can('events', 'delete');

  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState({ open: false, event: null });

  const eventsQuery = adminApi.endpoints.specialEventsList.useQuery();
  const [removeEvent] = adminApi.endpoints.specialEventsRemove.useMutation();

  const events = useMemo(() => eventsQuery.data || [], [eventsQuery.data]);

  const rows = useMemo(() => {
    if (!search.trim()) return events;
    const q = search.toLowerCase();
    return events.filter((e) => e.name?.toLowerCase().includes(q));
  }, [events, search]);

  const onDelete = (event) => {
    modal.confirm({
      title: `Delete event "${event.name}"?`,
      content: 'Its design links are removed; the designs themselves are untouched.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeEvent(event.uid).unwrap();
          message.success('Event deleted');
        } catch {
          // error notification handled by baseQuery
        }
      },
    });
  };

  const columns = [
    {
      title: 'Thumbnail',
      dataIndex: 'thumbnail_s3_key',
      key: 'thumb',
      width: 90,
      render: (k) => <ImageThumb k={k} />,
    },
    { title: 'Name', dataIndex: 'name', key: 'name', render: (v) => <Text strong>{v}</Text> },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 130,
      render: (t) => (t ? <Tag color={TYPE_COLOR[t] || 'default'}>{t}</Tag> : <Text type="secondary">—</Text>),
    },
    {
      title: 'When',
      key: 'when',
      width: 160,
      render: (_v, ev) => formatWhen(ev),
    },
    {
      title: 'Active',
      dataIndex: 'is_active',
      key: 'active',
      width: 80,
      render: (v) => <Tag color={isTrue(v) ? 'green' : 'default'}>{isTrue(v) ? 'Yes' : 'No'}</Tag>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 110,
      fixed: 'right',
      render: (_v, event) => (
        <Space size="small">
          {canUpdate && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditor({ open: true, event })}
              title="Edit"
            />
          )}
          {canDelete && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onDelete(event)}
              title="Delete"
            />
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
          Special Events
        </Title>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="Search events"
            style={{ width: 220 }}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={setSearch}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => eventsQuery.refetch()}
            loading={eventsQuery.isFetching}
          >
            Reload
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setEditor({ open: true, event: null })}
            >
              New Event
            </Button>
          )}
        </Space>
      </div>

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={rows}
        loading={eventsQuery.isLoading}
        scroll={{ x: 'max-content' }}
        size="middle"
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} total` }}
      />

      <SpecialEventEditorDrawer
        open={editor.open}
        event={editor.event}
        onClose={() => setEditor({ open: false, event: null })}
        onSaved={() => {
          eventsQuery.refetch();
        }}
      />
    </div>
  );
}
