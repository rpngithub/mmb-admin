import { useMemo, useState } from 'react';
import { Select, Typography, Button, Empty, Input, Space, Divider } from 'antd';
import { HolderOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons';

const { Text } = Typography;

// Move an array item from `from` to `to`, returning a new array.
function moveItem(arr, from, to) {
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * A multi-select whose value is an ORDERED array of ids: pick in the Select, then
 * drag the rows below to set the order. Both are the same `value` array — the
 * caller just re-sends it, because on the brand-series relations endpoint the
 * array position IS the stored display_order.
 *
 * Drag uses native HTML5 DnD (same approach as the homepage-categories reorder);
 * there is no DnD library in this repo. `renderLabel` lets a caller decorate the
 * row (e.g. a colour swatch); it falls back to the option's label.
 *
 * Pass `onCreate(name) => id | null` to get an inline "add new" row in the
 * dropdown (same affordance as TagSelect). The new id is appended to the end of
 * the order; return null/undefined to leave the selection untouched (e.g. a 409).
 */
export default function OrderedMultiSelect({
  value = [],
  onChange,
  options = [],
  placeholder,
  disabled,
  renderLabel,
  emptyText = 'Nothing selected yet.',
  onCreate,
  createPlaceholder = 'New name',
}) {
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const optionById = useMemo(() => {
    const m = new Map();
    options.forEach((o) => m.set(o.value, o));
    return m;
  }, [options]);

  const reset = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const onDrop = (index) => {
    if (dragIndex == null || dragIndex === index) {
      reset();
      return;
    }
    onChange?.(moveItem(value, dragIndex, index));
    reset();
  };

  const remove = (id) => onChange?.(value.filter((v) => v !== id));

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const id = await onCreate(name);
      if (id == null) return; // creation failed — the caller surfaced why
      setNewName('');
      onChange?.([...value, id]);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <Select
        mode="multiple"
        allowClear
        style={{ width: '100%' }}
        value={value}
        onChange={onChange}
        options={options}
        optionFilterProp="label"
        placeholder={placeholder}
        disabled={disabled}
        // Tags are rendered by the ordered list below, so keep the box compact.
        maxTagCount={0}
        maxTagPlaceholder={(omitted) => `${omitted.length} selected`}
        dropdownRender={
          onCreate
            ? (menu) => (
                <>
                  {menu}
                  <Divider style={{ margin: '8px 0' }} />
                  <Space style={{ padding: '0 8px 4px' }}>
                    <Input
                      size="small"
                      placeholder={createPlaceholder}
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onPressEnter={(e) => {
                        e.preventDefault();
                        create();
                      }}
                    />
                    <Button
                      size="small"
                      type="text"
                      icon={<PlusOutlined />}
                      loading={creating}
                      onClick={create}
                    >
                      Add
                    </Button>
                  </Space>
                </>
              )
            : undefined
        }
      />

      <div style={{ marginTop: 8 }}>
        {value.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<Text type="secondary">{emptyText}</Text>}
            style={{ margin: '8px 0' }}
          />
        ) : (
          value.map((id, index) => {
            const option = optionById.get(id);
            const dragging = index === dragIndex;
            const isOver = index === overIndex && dragIndex != null && dragIndex !== index;
            return (
              <div
                key={id}
                draggable={!disabled}
                onDragStart={(e) => {
                  setDragIndex(index);
                  e.dataTransfer.effectAllowed = 'move';
                  // Firefox requires data to be set for a drag to start.
                  e.dataTransfer.setData('text/plain', String(id));
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
                  gap: 10,
                  padding: '6px 10px',
                  marginBottom: 6,
                  border: '1px solid',
                  borderColor: isOver ? '#1677ff' : '#f0f0f0',
                  borderRadius: 6,
                  background: dragging ? '#f5f5f5' : '#fff',
                  opacity: dragging ? 0.5 : 1,
                  cursor: disabled ? 'default' : 'grab',
                  transition: 'border-color 0.15s ease',
                }}
              >
                <HolderOutlined style={{ color: disabled ? '#ccc' : '#999' }} />
                <Text type="secondary" style={{ fontSize: 12, width: 18 }}>
                  {index + 1}
                </Text>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {renderLabel ? renderLabel(option, id) : option?.label ?? `#${id}`}
                </div>
                {!disabled && (
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={() => remove(id)}
                    title="Remove"
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
