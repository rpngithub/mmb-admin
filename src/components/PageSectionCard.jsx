import { useState } from 'react';
import { Card, Space, Button, Tag, Typography, Popconfirm, Empty, Tooltip } from 'antd';
import {
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  CopyOutlined,
  RollbackOutlined,
  DownOutlined,
  RightOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import ImageThumb from './ImageThumb';
import SortableList from './SortableList';
import { isTrue, sectionItems } from '../lib/pageContent';

const { Text, Paragraph } = Typography;

const STATE_META = {
  default: { tag: null, color: undefined },
  inherited: { tag: 'Inherited from default', color: 'default' },
  custom: { tag: 'Custom', color: 'blue' },
  hidden: { tag: 'Hidden on this page', color: 'default' },
};

/**
 * One block, rendered in one of four states:
 *
 *   default    Mode A — the shared copy, fully editable. Hide/Show toggles the
 *              default's is_active (the page confirms the cascade).
 *   inherited  Mode B, `inherited: true` — READ-ONLY. Its uid is the DEFAULT
 *              row's uid, so nothing here may PATCH it; the two buttons clone
 *              it or hide it for this industry only.
 *   custom     Mode B, this industry's own copy — fully editable, draggable.
 *   hidden     Mode B, an override with is_active 0 — collapsed, struck
 *              through, one "Show again" button.
 *
 * Inherited cards show SUBSTITUTED text (the preview endpoint rendered it);
 * editable cards show the RAW text with tokens, because that is what the
 * editor is editing.
 */
export default function PageSectionCard({
  section,
  state,
  industryName,
  perms,
  handle,
  busy = false,
  itemsBusy = false,
  onEdit,
  onDelete,
  onHide,
  onShow,
  onCustomise,
  onRevert,
  onAddItem,
  onEditItem,
  onDeleteItem,
  onReorderItems,
}) {
  const [expanded, setExpanded] = useState(state !== 'hidden');
  const editable = state === 'default' || state === 'custom';
  const inactiveDefault = state === 'default' && !isTrue(section.is_active);
  const items = sectionItems(section);
  const meta = STATE_META[state] || STATE_META.default;
  const struck = state === 'hidden' || inactiveDefault;

  const titleText = section.heading || section.eyebrow || section.section_key;

  // ---- header actions per state --------------------------------------------
  const actions = [];
  if (state === 'default') {
    if (perms.canUpdate) {
      actions.push(
        <Button key="edit" size="small" icon={<EditOutlined />} onClick={onEdit} disabled={busy}>
          Edit
        </Button>,
      );
      actions.push(
        inactiveDefault ? (
          <Button key="show" size="small" icon={<EyeOutlined />} onClick={onShow} disabled={busy}>
            Show
          </Button>
        ) : (
          <Button
            key="hide"
            size="small"
            icon={<EyeInvisibleOutlined />}
            onClick={onHide}
            disabled={busy}
          >
            Hide
          </Button>
        ),
      );
    }
    if (perms.canDelete) {
      actions.push(
        <Button
          key="delete"
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={onDelete}
          disabled={busy}
        >
          Delete
        </Button>,
      );
    }
  } else if (state === 'inherited') {
    if (perms.canCreate) {
      actions.push(
        <Button
          key="customise"
          size="small"
          type="primary"
          ghost
          icon={<CopyOutlined />}
          onClick={onCustomise}
          disabled={busy}
        >
          Customise for {industryName}
        </Button>,
      );
      actions.push(
        <Button
          key="hide"
          size="small"
          icon={<EyeInvisibleOutlined />}
          onClick={onHide}
          disabled={busy}
        >
          Hide on this page
        </Button>,
      );
    }
  } else if (state === 'custom') {
    if (perms.canUpdate) {
      actions.push(
        <Button key="edit" size="small" icon={<EditOutlined />} onClick={onEdit} disabled={busy}>
          Edit
        </Button>,
      );
      actions.push(
        <Button
          key="hide"
          size="small"
          icon={<EyeInvisibleOutlined />}
          onClick={onHide}
          disabled={busy}
        >
          Hide
        </Button>,
      );
    }
    if (perms.canDelete) {
      actions.push(
        <Button
          key="revert"
          size="small"
          danger
          icon={<RollbackOutlined />}
          onClick={onRevert}
          disabled={busy}
        >
          Revert to default
        </Button>,
      );
    }
  } else if (state === 'hidden') {
    // Un-hiding is a DELETE for a hide-only row and a PATCH for a switched-off
    // copy; the page decides, and tells us which permission it needs.
    if (perms.canShowAgain) {
      actions.push(
        <Button key="show" size="small" icon={<EyeOutlined />} onClick={onShow} disabled={busy}>
          Show again
        </Button>,
      );
    }
  }

  return (
    <Card
      size="small"
      style={{
        background: state === 'inherited' || struck ? '#fafafa' : '#fff',
        borderColor: state === 'custom' ? '#91caff' : undefined,
      }}
      styles={{ body: { padding: expanded ? '8px 12px 12px' : '8px 12px' } }}
    >
      {/* ---- header ---------------------------------------------------- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {handle}
        <Button
          type="text"
          size="small"
          icon={expanded ? <DownOutlined /> : <RightOutlined />}
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        />
        <div style={{ flex: 1, minWidth: 200 }}>
          <Space size={6} wrap>
            {section.eyebrow && (
              <Tag color="gold" style={{ marginRight: 0 }}>
                {section.eyebrow}
              </Tag>
            )}
            <Text strong delete={struck} style={{ fontSize: 15 }}>
              {titleText}
            </Text>
            {meta.tag && <Tag color={meta.color}>{meta.tag}</Tag>}
            {inactiveDefault && <Tag>Hidden</Tag>}
          </Space>
          <div>
            <Text code style={{ fontSize: 12 }}>
              {section.section_key}
            </Text>
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
              {items.length} {items.length === 1 ? 'item' : 'items'}
            </Text>
          </div>
        </div>
        {actions.length > 0 && <Space size={4} wrap>{actions}</Space>}
      </div>

      {/* ---- body ------------------------------------------------------ */}
      {expanded && (
        <div style={{ marginTop: 10, paddingLeft: handle ? 26 : 0 }}>
          {(section.subheading || section.image_s3_key) && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 10 }}>
              {section.image_s3_key && (
                <ImageThumb k={section.image_s3_key} size={64} alt={section.section_key} />
              )}
              {section.subheading && (
                <Paragraph type="secondary" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                  {section.subheading}
                </Paragraph>
              )}
            </div>
          )}

          {items.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No items yet"
              style={{ margin: '8px 0' }}
            />
          ) : (
            <SortableList
              items={items}
              disabled={!editable || !perms.canUpdate || itemsBusy}
              onReorder={onReorderItems}
              handleStyle={{ fontSize: 14 }}
              gap={6}
              renderRow={(item, { handle: itemHandle }) => (
                <ItemRow
                  item={item}
                  handle={itemHandle}
                  editable={editable}
                  perms={perms}
                  busy={busy || itemsBusy}
                  onEdit={() => onEditItem?.(item)}
                  onDelete={() => onDeleteItem?.(item)}
                />
              )}
            />
          )}

          {editable && perms.canCreate && (
            <Button
              size="small"
              type="dashed"
              icon={<PlusOutlined />}
              onClick={onAddItem}
              disabled={busy}
              style={{ marginTop: 8 }}
            >
              Add item
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function ItemRow({ item, handle, editable, perms, busy, onEdit, onDelete }) {
  const hidden = !isTrue(item.is_active);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 10px',
        border: '1px solid #f0f0f0',
        borderRadius: 8,
        background: '#fff',
        opacity: hidden ? 0.6 : 1,
      }}
    >
      {handle}
      {item.icon_s3_key && <ImageThumb k={item.icon_s3_key} size={28} alt={item.title || ''} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Space size={6} wrap>
          {item.title ? (
            <Text strong delete={hidden}>
              {item.title}
            </Text>
          ) : (
            <Text type="secondary" italic>
              (no title)
            </Text>
          )}
          {hidden && <Tag style={{ marginRight: 0 }}>Hidden</Tag>}
          {item.link_url && (
            <Tooltip title={item.link_url}>
              <LinkOutlined style={{ color: '#999' }} />
            </Tooltip>
          )}
        </Space>
        {item.body && (
          <div>
            <Text type="secondary" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
              {item.body}
            </Text>
          </div>
        )}
      </div>
      {editable && (perms.canUpdate || perms.canDelete) && (
        <Space size={2}>
          {perms.canUpdate && (
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={onEdit}
              disabled={busy}
              title="Edit item"
            />
          )}
          {perms.canDelete && (
            <Popconfirm
              title="Delete this item?"
              description="This cannot be undone."
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={onDelete}
              disabled={busy}
            >
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={busy}
                title="Delete item"
              />
            </Popconfirm>
          )}
        </Space>
      )}
    </div>
  );
}
