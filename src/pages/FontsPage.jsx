import { useMemo, useState } from 'react';
import { Table, Typography, Space, Input, Button, Tag, Switch, Select, Tooltip, Alert, App } from 'antd';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  HolderOutlined,
  WarningFilled,
  ExclamationCircleFilled,
  CheckCircleFilled,
} from '@ant-design/icons';
import { useAppDispatch } from '../app/hooks';
import {
  adminApi,
  useFontUpdateMutation,
  useFontsReorderMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import { summarizeFontFiles } from '../lib/fontFiles';
import FontEditorDrawer from '../components/FontEditorDrawer';

const { Title, Text } = Typography;

const isTrue = (v) => v === true || v === 1 || v === '1';

const orderCmp = (a, b) =>
  (a.display_order ?? 0) - (b.display_order ?? 0) ||
  String(a.family || '').localeCompare(String(b.family || ''));

function moveItem(arr, from, to) {
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

const FILE_STATUS = {
  ok: { icon: <CheckCircleFilled style={{ color: '#52c41a' }} />, color: 'green' },
  warn: { icon: <WarningFilled style={{ color: '#faad14' }} />, color: 'gold' },
  error: { icon: <ExclamationCircleFilled style={{ color: '#ff4d4f' }} />, color: 'red' },
  empty: { icon: <ExclamationCircleFilled style={{ color: '#bfbfbf' }} />, color: 'default' },
};

/**
 * Fonts — the curated library users pick from in Brand Kit → Fonts.
 *
 * LIBRARY fonts only: users can upload their own, which live in the same table
 * but are private to them and are deliberately not manageable here.
 *
 * The file-count column carries the dual-format verdict (see lib/fontFiles), so a
 * family that is silently missing from the Flutter app is visible without opening
 * it — that failure produces no error anywhere else.
 */
export default function FontsPage() {
  const dispatch = useAppDispatch();
  const perms = usePermissions();
  const { message, modal } = App.useApp();

  const canCreate = perms.can('fonts', 'create');
  const canUpdate = perms.can('fonts', 'update');
  const canDelete = perms.can('fonts', 'delete');

  const [search, setSearch] = useState('');
  const [premiumFilter, setPremiumFilter] = useState(undefined);
  const [editor, setEditor] = useState({ open: false, uid: null });
  const [togglingUid, setTogglingUid] = useState(null);
  const [reordering, setReordering] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  const { data, isLoading, isFetching, refetch } = adminApi.endpoints.fontsList.useQuery();
  const [updateFont] = useFontUpdateMutation();
  const [removeFont] = adminApi.endpoints.fontsRemove.useMutation();
  const [reorder] = useFontsReorderMutation();

  const ordered = useMemo(() => [...(data || [])].sort(orderCmp), [data]);

  // Search/premium filtering is client-side, over the full ordered list — the
  // drag-reorder must always send EVERY uid, so it only runs on the unfiltered
  // view (see dragEnabled).
  const rows = useMemo(() => {
    let out = ordered;
    const q = search.trim().toLowerCase();
    if (q) out = out.filter((f) => f.family?.toLowerCase().includes(q));
    if (premiumFilter !== undefined) {
      out = out.filter((f) => (isTrue(f.is_premium) ? 1 : 0) === premiumFilter);
    }
    return out;
  }, [ordered, search, premiumFilter]);

  const filtered = rows.length !== ordered.length;
  const dragEnabled = canUpdate && !reordering && !filtered;

  const resetDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const handleDrop = async (index) => {
    if (dragIndex == null || dragIndex === index) {
      resetDrag();
      return;
    }
    const nextRows = moveItem(ordered, dragIndex, index);
    resetDrag();

    const patch = dispatch(
      adminApi.util.updateQueryData('fontsList', undefined, (draft) => {
        nextRows.forEach((r, i) => {
          const row = draft.find((d) => d.uid === r.uid);
          if (row) row.display_order = i;
        });
      }),
    );
    setReordering(true);
    try {
      await reorder(nextRows.map((r) => r.uid)).unwrap();
    } catch (err) {
      patch.undo();
      message.error(err?.message || 'Failed to save the new order — reverted.');
      refetch();
    } finally {
      setReordering(false);
    }
  };

  const toggleActive = async (record, next) => {
    setTogglingUid(record.uid);
    try {
      await updateFont({ uid: record.uid, body: { is_active: next ? 1 : 0 } }).unwrap();
      message.success(next ? `${record.family} is back in the picker` : `${record.family} hidden`);
    } catch (err) {
      message.error(err?.message || 'Could not change the font status.');
    } finally {
      setTogglingUid(null);
    }
  };

  const onDelete = (record) => {
    modal.confirm({
      title: `Delete "${record.family}"?`,
      content:
        'Safe to do: any business using it falls back to its default typeface rather than breaking.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeFont(record.uid).unwrap();
          message.success('Font deleted');
        } catch {
          // error notification handled by baseQuery
        }
      },
    });
  };

  const columns = [
    {
      title: '',
      key: 'drag',
      width: 40,
      render: () => (
        <HolderOutlined
          style={{ color: dragEnabled ? '#999' : '#d9d9d9', cursor: dragEnabled ? 'grab' : 'default' }}
        />
      ),
    },
    {
      title: 'Family',
      dataIndex: 'family',
      key: 'family',
      render: (v, r) => (
        <Space size={6}>
          <Text strong>{v}</Text>
          {isTrue(r.is_premium) && <Tag color="gold">Premium</Tag>}
        </Space>
      ),
    },
    {
      title: 'Files',
      key: 'files',
      width: 150,
      render: (_v, r) => {
        const files = r.FontFiles || [];
        const { level, reasons } = summarizeFontFiles(files);
        const status = FILE_STATUS[level];
        return (
          <Tooltip title={reasons.length ? reasons.join(' ') : 'Regular has both a woff2 and a ttf/otf.'}>
            <Space size={6}>
              {status.icon}
              <Text>
                {files.length} {files.length === 1 ? 'file' : 'files'}
              </Text>
            </Space>
          </Tooltip>
        );
      },
    },
    {
      title: 'Scripts',
      key: 'languages',
      render: (_v, r) => {
        const langs = r.Languages || [];
        if (!langs.length) {
          return (
            <Tooltip title="Unspecified — offered for every language.">
              <Tag>Any</Tag>
            </Tooltip>
          );
        }
        return (
          <span>
            {langs.slice(0, 4).map((l) => (
              <Tag key={l.id}>{l.native_name || l.name}</Tag>
            ))}
            {langs.length > 4 && <Tag>+{langs.length - 4}</Tag>}
          </span>
        );
      },
    },
    {
      title: 'Active',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 90,
      render: (v, record) =>
        canUpdate ? (
          <Switch
            size="small"
            checked={isTrue(v)}
            loading={togglingUid === record.uid}
            onChange={(checked) => toggleActive(record, checked)}
          />
        ) : (
          <Tag color={isTrue(v) ? 'green' : 'default'}>{isTrue(v) ? 'Yes' : 'No'}</Tag>
        ),
    },
  ];

  if (canUpdate || canDelete) {
    columns.push({
      title: 'Actions',
      key: 'actions',
      width: 110,
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
          {canDelete && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onDelete(record)}
              title="Delete"
            />
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
          Fonts
        </Title>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="Search families"
            style={{ width: 200 }}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={setSearch}
          />
          <Select
            allowClear
            placeholder="Premium"
            style={{ width: 120 }}
            value={premiumFilter}
            onChange={setPremiumFilter}
            options={[
              { label: 'Premium', value: 1 },
              { label: 'Free', value: 0 },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching || reordering}>
            Reload
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setEditor({ open: true, uid: null })}
            >
              New Font
            </Button>
          )}
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="The curated library users pick from in Brand Kit → Fonts."
        description={
          <>
            Fonts users upload themselves live in the same table but are private to them and are not
            listed here.
            {canUpdate && !filtered
              ? ' Drag the rows to set the order the picker shows them in.'
              : ''}
            {filtered ? ' Clear the search and filter to reorder.' : ''}
          </>
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
        locale={{
          emptyText: filtered
            ? 'No families match.'
            : 'The library is empty — add a family, upload its files, then tag the scripts it covers.',
        }}
        onRow={(_record, index) => ({
          draggable: dragEnabled,
          onDragStart: (e) => {
            setDragIndex(index);
            e.dataTransfer.effectAllowed = 'move';
            // Firefox requires data to be set for a drag to start.
            e.dataTransfer.setData('text/plain', String(index));
          },
          onDragOver: (e) => {
            if (!dragEnabled || dragIndex == null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (overIndex !== index) setOverIndex(index);
          },
          onDrop: (e) => {
            e.preventDefault();
            handleDrop(index);
          },
          onDragEnd: resetDrag,
          style: {
            cursor: dragEnabled ? 'grab' : 'default',
            opacity: dragIndex === index ? 0.5 : 1,
            boxShadow:
              overIndex === index && dragIndex != null && dragIndex !== index
                ? 'inset 0 2px 0 #1677ff'
                : undefined,
          },
        })}
      />

      <FontEditorDrawer
        open={editor.open}
        uid={editor.uid}
        onClose={() => setEditor({ open: false, uid: null })}
        onSaved={refetch}
      />
    </div>
  );
}
