import { Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import ImageThumb from './ImageThumb';

function renderBoolean(value) {
  const truthy = value === true || value === 1 || value === '1';
  return <Tag color={truthy ? 'green' : 'default'}>{truthy ? 'Yes' : 'No'}</Tag>;
}

function renderTags(value) {
  if (!Array.isArray(value)) return value ?? '—';
  if (value.length === 0) return '—';
  const shown = value.slice(0, 6);
  return (
    <span>
      {shown.map((t) => (
        <Tag key={String(t)} style={{ marginBottom: 2 }}>
          {String(t)}
        </Tag>
      ))}
      {value.length > shown.length && <Tag>+{value.length - shown.length}</Tag>}
    </span>
  );
}

function renderDate(value) {
  if (!value) return '—';
  const d = dayjs(value);
  return d.isValid() ? (
    <Tooltip title={d.format('YYYY-MM-DD HH:mm:ss')}>{d.format('YYYY-MM-DD')}</Tooltip>
  ) : (
    String(value)
  );
}

function renderCode(value) {
  if (value === null || value === undefined || value === '') return '—';
  return <code>{String(value)}</code>;
}

/** A hex colour as a swatch + its code, so the palette is scannable at a glance. */
function renderColor(value) {
  if (!value) return '—';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 4,
          background: String(value),
          border: '1px solid rgba(0,0,0,0.15)',
          flex: 'none',
        }}
      />
      <code>{String(value)}</code>
    </span>
  );
}

function renderImage(value) {
  return <ImageThumb k={value} />;
}

function renderDefault(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return <code>{JSON.stringify(value)}</code>;
  return String(value);
}

/**
 * Turn column configs into AntD Table columns, applying a renderer based on the
 * declared `type` unless the config supplies its own `render`.
 */
export function buildColumns(configs) {
  return configs.map((c) => {
    const col = {
      key: c.key || c.dataIndex,
      dataIndex: c.dataIndex,
      title: c.title,
      width: c.width,
      ellipsis: c.ellipsis,
      sorter: c.sorter,
    };
    if (c.render) {
      col.render = c.render;
    } else if (c.type === 'boolean') {
      col.render = renderBoolean;
    } else if (c.type === 'tags') {
      col.render = renderTags;
    } else if (c.type === 'date') {
      col.render = renderDate;
    } else if (c.type === 'code') {
      col.render = renderCode;
    } else if (c.type === 'color') {
      col.render = renderColor;
    } else if (c.type === 'image') {
      col.render = renderImage;
    } else {
      col.render = renderDefault;
    }
    return col;
  });
}
