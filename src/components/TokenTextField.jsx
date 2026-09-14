import { useRef } from 'react';
import { Input, Space, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { TOKENS } from '../lib/pageContent';

const { Text } = Typography;

/**
 * A text input (or textarea) with the two industry-token chips under it.
 * Clicking a chip drops `{{industry}}` / `{{industry_lower}}` in AT THE CURSOR,
 * not at the end — the same behaviour as the notification placeholder chips.
 *
 * Controlled through a Form.Item (`value` / `onChange`), so it slots in where a
 * plain <Input> would. `multiline` renders an Input.TextArea.
 */
export default function TokenTextField({
  value,
  onChange,
  multiline = false,
  rows = 3,
  disabled,
  placeholder,
  maxLength,
}) {
  const ref = useRef(null);

  const insertToken = (name) => {
    if (disabled) return;
    const token = `{{${name}}}`;
    const current = value || '';
    // AntD's TextArea wraps the element; Input exposes it directly.
    const el = ref.current?.resizableTextArea?.textArea || ref.current?.input || null;
    if (!el) {
      onChange?.(`${current}${token}`);
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? start;
    onChange?.(`${current.slice(0, start)}${token}${current.slice(end)}`);
    // Put the caret after what was just inserted.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const control = multiline ? (
    <Input.TextArea
      ref={ref}
      rows={rows}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      maxLength={maxLength}
    />
  ) : (
    <Input
      ref={ref}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      maxLength={maxLength}
    />
  );

  return (
    <div>
      {control}
      <Space size={4} wrap style={{ marginTop: 4 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Insert:
        </Text>
        {TOKENS.map((t) => (
          <Tag
            key={t.name}
            icon={<PlusOutlined />}
            style={{ cursor: disabled ? 'default' : 'pointer', userSelect: 'none', margin: 0 }}
            onMouseDown={(e) => e.preventDefault()} // keep the input's caret where it is
            onClick={() => insertToken(t.name)}
          >
            {t.name}
          </Tag>
        ))}
      </Space>
    </div>
  );
}
