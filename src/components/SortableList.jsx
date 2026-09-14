import { useState } from 'react';
import { HolderOutlined } from '@ant-design/icons';
import { moveItem } from '../lib/pageContent';

/**
 * Native HTML5 drag-and-drop sortable list (no DnD library in this repo — same
 * approach as Homepage Categories), written so lists can NEST: a section list
 * whose rows each contain an item list.
 *
 *  - A row only becomes draggable while the mouse is down on its handle, so
 *    buttons and text inside a row never start a drag by accident.
 *  - Drag events stop at the list they belong to. An inner list ignores drags
 *    it did not start (its dragIndex is null) and lets them bubble to the
 *    outer one; a drag it did start never reaches the outer list.
 *
 * `renderRow(row, { handle, dragging, isOver })` returns the row's content;
 * `handle` is the drag handle element to place wherever the row wants it
 * (null when the row cannot be dragged). `canDrag(row)` opts individual rows
 * out — an inherited block has no handle at all.
 */
export default function SortableList({
  items,
  onReorder,
  renderRow,
  disabled = false,
  canDrag = () => true,
  rowKey = (row) => row.uid,
  gap = 8,
  handleStyle,
}) {
  const [armed, setArmed] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  const reset = () => {
    setArmed(null);
    setDragIndex(null);
    setOverIndex(null);
  };

  const drop = (index) => {
    const from = dragIndex;
    reset();
    if (from == null || from === index) return;
    onReorder(moveItem(items, from, index));
  };

  return (
    <div>
      {items.map((row, index) => {
        const draggable = !disabled && canDrag(row);
        const dragging = index === dragIndex;
        const isOver = index === overIndex && dragIndex != null && dragIndex !== index;
        const handle = draggable ? (
          <HolderOutlined
            title="Drag to reorder"
            onMouseDown={() => setArmed(index)}
            onMouseUp={() => setArmed(null)}
            style={{ color: '#999', fontSize: 16, cursor: 'grab', ...handleStyle }}
          />
        ) : null;
        return (
          <div
            key={rowKey(row)}
            draggable={draggable && armed === index}
            onDragStart={(e) => {
              if (!(draggable && armed === index)) return;
              e.stopPropagation();
              setDragIndex(index);
              e.dataTransfer.effectAllowed = 'move';
              // Firefox requires data to be set for a drag to start.
              e.dataTransfer.setData('text/plain', String(rowKey(row)));
            }}
            onDragOver={(e) => {
              if (dragIndex == null) return; // not our drag — let it bubble
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              if (overIndex !== index) setOverIndex(index);
            }}
            onDrop={(e) => {
              if (dragIndex == null) return;
              e.preventDefault();
              e.stopPropagation();
              drop(index);
            }}
            onDragEnd={(e) => {
              if (dragIndex == null && armed == null) return;
              e.stopPropagation();
              reset();
            }}
            style={{
              marginBottom: index === items.length - 1 ? 0 : gap,
              opacity: dragging ? 0.5 : 1,
              boxShadow: isOver ? '0 -2px 0 0 #1677ff' : undefined,
              borderRadius: 8,
              transition: 'box-shadow 0.15s ease',
            }}
          >
            {renderRow(row, { handle, dragging, isOver })}
          </div>
        );
      })}
    </div>
  );
}
