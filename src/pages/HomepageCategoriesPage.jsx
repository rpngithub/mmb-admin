import { useMemo, useState } from 'react';
import { Typography, Space, Button, Card, Tag, Empty, Spin, Alert, App } from 'antd';
import { ReloadOutlined, HolderOutlined } from '@ant-design/icons';
import { useAppDispatch } from '../app/hooks';
import {
  adminApi,
  useTemplateCategoriesReorderMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import ImageThumb from '../components/ImageThumb';

const { Title, Text } = Typography;

const isTrue = (v) => v === true || v === 1 || v === '1';

const orderCmp = (a, b) =>
  (a.display_order ?? 0) - (b.display_order ?? 0) ||
  String(a.name || '').localeCompare(String(b.name || ''));

// Move an array item from `from` to `to`, returning a new array.
function moveItem(arr, from, to) {
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Homepage categories — display the template categories flagged for the homepage
 * and let an editor reorder them by drag-and-drop. Persistence is a single bulk
 * PATCH per sibling group (see templateCategoriesReorder); the public homepage
 * renders categories by the resulting display_order.
 *
 * Rows are grouped by parent_id: each group is an independent sibling set, and a
 * drop within a group sends only that group's uids (mixing parents → 400).
 */
export default function HomepageCategoriesPage() {
  const dispatch = useAppDispatch();
  const perms = usePermissions();
  const { message } = App.useApp();
  const canUpdate = perms.can('categories', 'update');

  const {
    data: categories = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = adminApi.endpoints.templateCategoriesList.useQuery();

  const [reorder] = useTemplateCategoriesReorderMutation();
  // Single in-flight key doubles as a global save-lock so two quick drops on the
  // same (or any) group can't race the atomic endpoint.
  const [savingKey, setSavingKey] = useState(null);

  const nameById = useMemo(() => {
    const m = new Map();
    categories.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [categories]);

  // Homepage rows grouped by parent_id (null → the top-level group), each sorted
  // by display_order. Parent may itself be hidden from the homepage — grouping is
  // by the real parent_id so the reorder call stays sibling-scoped.
  const groups = useMemo(() => {
    const homepage = categories.filter((c) => isTrue(c.show_in_homepage));
    const byParent = new Map();
    for (const row of homepage) {
      const key = row.parent_id ?? null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(row);
    }
    const out = [];
    for (const [parentId, rows] of byParent.entries()) {
      out.push({
        key: String(parentId ?? 'root'),
        parentId,
        title:
          parentId == null
            ? 'Top-level categories'
            : `Under: ${nameById.get(parentId) || 'Unknown parent'}`,
        rows: [...rows].sort(orderCmp),
      });
    }
    // Root group first, then child groups alphabetically by their header.
    out.sort((a, b) => {
      if (a.parentId == null) return -1;
      if (b.parentId == null) return 1;
      return a.title.localeCompare(b.title);
    });
    return out;
  }, [categories, nameById]);

  const handleReorder = async (group, nextRows) => {
    const ids = nextRows.map((r) => r.uid);
    // Optimistic patch: assign display_order by array position (mirrors what the
    // server does), so the derived groups re-sort into the new order immediately.
    const patch = dispatch(
      adminApi.util.updateQueryData('templateCategoriesList', undefined, (draft) => {
        nextRows.forEach((r, i) => {
          const row = draft.find((d) => d.uid === r.uid);
          if (row) row.display_order = i;
        });
      }),
    );
    setSavingKey(group.key);
    try {
      await reorder(ids).unwrap();
    } catch (err) {
      patch.undo();
      message.error(err?.message || 'Failed to save the new order — reverted.');
      refetch();
    } finally {
      setSavingKey(null);
    }
  };

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
          Homepage Categories
        </Title>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
            Reload
          </Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={
          canUpdate
            ? 'Drag the categories to set the order they appear on the homepage. Each change saves automatically.'
            : 'These are the categories shown on the homepage, in display order. You need the categories “update” permission to reorder them.'
        }
      />

      {error ? (
        <Alert
          type="error"
          showIcon
          message="Failed to load categories"
          description="Please reload and try again."
        />
      ) : isLoading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
        </div>
      ) : groups.length === 0 ? (
        <Empty description="No categories are flagged to show on the homepage yet." />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {groups.map((group) => (
            <Card
              key={group.key}
              size="small"
              title={group.title}
              extra={
                savingKey === group.key ? (
                  <Space size={6}>
                    <Spin size="small" />
                    <Text type="secondary">Saving…</Text>
                  </Space>
                ) : (
                  <Text type="secondary">{group.rows.length} categories</Text>
                )
              }
            >
              <SortableList
                items={group.rows}
                disabled={!canUpdate || savingKey != null}
                onReorder={(nextRows) => handleReorder(group, nextRows)}
              />
            </Card>
          ))}
        </Space>
      )}
    </div>
  );
}

// ---- native HTML5 drag-and-drop sortable list ------------------------------

function SortableList({ items, disabled, onReorder }) {
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  const reset = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const onDrop = (index) => {
    if (dragIndex == null || dragIndex === index) {
      reset();
      return;
    }
    onReorder(moveItem(items, dragIndex, index));
    reset();
  };

  return (
    <div>
      {items.map((row, index) => {
        const dragging = index === dragIndex;
        const isOver = index === overIndex && dragIndex != null && dragIndex !== index;
        return (
          <div
            key={row.uid}
            draggable={!disabled}
            onDragStart={(e) => {
              setDragIndex(index);
              e.dataTransfer.effectAllowed = 'move';
              // Firefox requires data to be set for a drag to start.
              e.dataTransfer.setData('text/plain', row.uid);
            }}
            onDragOver={(e) => {
              if (disabled || dragIndex == null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (overIndex !== index) setOverIndex(index);
            }}
            onDrop={(e) => {
              e.preventDefault();
              onDrop(index);
            }}
            onDragEnd={reset}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 12px',
              marginBottom: 8,
              border: '1px solid',
              borderColor: isOver ? '#1677ff' : '#f0f0f0',
              borderRadius: 8,
              background: dragging ? '#f5f5f5' : '#fff',
              opacity: dragging ? 0.5 : 1,
              cursor: disabled ? 'default' : 'grab',
              transition: 'border-color 0.15s ease',
            }}
          >
            <HolderOutlined
              style={{ color: disabled ? '#ccc' : '#999', fontSize: 16, cursor: disabled ? 'default' : 'grab' }}
            />
            <ImageThumb k={row.icon_s3_key} size={28} alt={row.name} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text strong ellipsis>
                {row.name}
              </Text>
              {row.slug && (
                <div>
                  <Text code style={{ fontSize: 12 }}>
                    {row.slug}
                  </Text>
                </div>
              )}
            </div>
            {!isTrue(row.is_active) && <Tag>Inactive</Tag>}
          </div>
        );
      })}
    </div>
  );
}
