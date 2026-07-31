import { useMemo, useState } from 'react';
import { Table, Typography, Space, Input, Button, Tag, Select, App } from 'antd';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { adminApi } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import ImageThumb from '../components/ImageThumb';
import ThemeEditorDrawer from '../components/ThemeEditorDrawer';

const { Title, Text } = Typography;

const isTrue = (v) => v === true || v === 1 || v === '1';

/**
 * Flat themes table with a Group column and a group filter. The themes list is
 * unfiltered (returns all themes), so the group filter is applied client-side.
 * Group names are resolved from the theme-groups list (group_id → name).
 */
export default function ThemesPage() {
  const perms = usePermissions();
  const { message, modal } = App.useApp();

  const canCreate = perms.can('themes', 'create');
  const canUpdate = perms.can('themes', 'update');
  const canDelete = perms.can('themes', 'delete');

  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState(null);
  const [editor, setEditor] = useState({ open: false, theme: null });

  const themesQuery = adminApi.endpoints.themesList.useQuery();
  const groupsQuery = adminApi.endpoints.themeGroupsList.useQuery();
  const [removeTheme] = adminApi.endpoints.themesRemove.useMutation();

  const themes = useMemo(() => themesQuery.data || [], [themesQuery.data]);
  const groups = useMemo(() => groupsQuery.data || [], [groupsQuery.data]);

  const groupName = useMemo(() => {
    const map = new Map();
    groups.forEach((g) => map.set(g.id, g.name));
    return map;
  }, [groups]);

  const rows = useMemo(() => {
    let list = themes;
    if (groupFilter != null) list = list.filter((t) => t.group_id === groupFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) => t.name?.toLowerCase().includes(q));
    }
    return list;
  }, [themes, groupFilter, search]);

  const onDelete = (theme) => {
    modal.confirm({
      title: `Delete theme "${theme.name}"?`,
      content: 'Its template associations are removed; the templates themselves are untouched.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeTheme(theme.uid).unwrap();
          message.success('Theme deleted');
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
      title: 'Group',
      dataIndex: 'group_id',
      key: 'group',
      render: (id) => groupName.get(id) || <Text type="secondary">#{id}</Text>,
    },
    {
      title: 'Likes',
      dataIndex: 'likes_count',
      key: 'likes',
      width: 90,
      render: (v) => <Text type="secondary">❤️ {v ?? 0}</Text>,
    },
    {
      title: 'Order',
      dataIndex: 'display_order',
      key: 'order',
      width: 80,
      render: (v) => v ?? 0,
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
      render: (_v, theme) => (
        <Space size="small">
          {canUpdate && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditor({ open: true, theme })}
              title="Edit"
            />
          )}
          {canDelete && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onDelete(theme)}
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
          Themes
        </Title>
        <Space wrap>
          <Select
            allowClear
            placeholder="All groups"
            style={{ width: 200 }}
            value={groupFilter ?? undefined}
            onChange={(v) => setGroupFilter(v ?? null)}
            showSearch
            optionFilterProp="label"
            options={groups.map((g) => ({ label: g.name, value: g.id }))}
          />
          <Input.Search
            allowClear
            placeholder="Search themes"
            style={{ width: 220 }}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={setSearch}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              themesQuery.refetch();
              groupsQuery.refetch();
            }}
            loading={themesQuery.isFetching}
          >
            Reload
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setEditor({ open: true, theme: null })}
            >
              New Theme
            </Button>
          )}
        </Space>
      </div>

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={rows}
        loading={themesQuery.isLoading}
        scroll={{ x: 'max-content' }}
        size="middle"
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} total` }}
      />

      <ThemeEditorDrawer
        open={editor.open}
        theme={editor.theme}
        defaultGroupId={groupFilter}
        onClose={() => setEditor({ open: false, theme: null })}
        onSaved={() => {
          themesQuery.refetch();
        }}
      />
    </div>
  );
}
