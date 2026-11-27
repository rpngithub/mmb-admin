import { useRef, useState } from 'react';
import { Button, Space, Typography, Alert } from 'antd';
import { FolderOpenOutlined, InboxOutlined } from '@ant-design/icons';
import { entriesFromDrop, entriesFromInput, indexFolder, fmtBytes } from '../lib/templateImport';

const { Text } = Typography;

/** What was picked, counted as picked files: "3 ZIPs and 12 other files, 48 MB". */
function pickedText({ count, zipCount, bytes }) {
  const others = count - zipCount;
  const parts = [];
  if (zipCount) parts.push(`${zipCount} ZIP${zipCount === 1 ? '' : 's'}`);
  if (others || !zipCount) parts.push(`${others} ${zipCount ? 'other ' : ''}file${others === 1 ? '' : 's'}`);
  return `${parts.join(' and ')}, ${fmtBytes(bytes)}`;
}

/**
 * Pick the batch folder: `<input webkitdirectory>` or a drag-and-drop of the
 * folder. Calls onPicked(index) with the indexed files (see indexFolder).
 * `expectName` (resume) is shown so the admin picks the SAME folder.
 */
export default function TemplateImportFolderPicker({ onPicked, picked, expectName, disabled }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState(null);
  const [reading, setReading] = useState(false);

  const take = (entries) => {
    try {
      const index = indexFolder(entries);
      setError(null);
      onPicked(index);
    } catch (err) {
      setError(err.message);
    }
  };

  const onDrop = async (e) => {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    setReading(true);
    try {
      take(await entriesFromDrop(e.dataTransfer));
    } catch {
      setError('Could not read the dropped folder — use the "Choose folder" button instead.');
    } finally {
      setReading(false);
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        style={{
          border: `1px dashed ${over ? '#1677ff' : '#d9d9d9'}`,
          background: over ? 'rgba(22,119,255,0.04)' : 'rgba(0,0,0,0.02)',
          borderRadius: 8,
          padding: 24,
          textAlign: 'center',
          transition: 'all .15s',
        }}
      >
        <InboxOutlined style={{ fontSize: 36, color: '#1677ff' }} />
        <div style={{ margin: '8px 0' }}>
          <Text strong>
            {expectName ? `Drop the "${expectName}" folder here` : 'Drop the batch folder here'}
          </Text>
          <br />
          <Text type="secondary">manifest.csv at the top and one ZIP per version. Unzipped folders also work.</Text>
        </div>
        <Button
          icon={<FolderOpenOutlined />}
          onClick={() => inputRef.current?.click()}
          loading={reading}
          disabled={disabled}
        >
          Choose folder
        </Button>
        <input
          ref={inputRef}
          type="file"
          // Folder picker; React passes this lowercase attribute through.
          webkitdirectory=""
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            take(entriesFromInput(e.target.files));
            e.target.value = '';
          }}
        />
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      {picked && !error && (
        <Alert
          type={expectName && picked.rootName && picked.rootName !== expectName ? 'warning' : 'success'}
          showIcon
          message={
            <span>
              <Text strong>{picked.rootName || 'Folder'}</Text> — manifest.csv, {pickedText(picked)}
              {expectName && picked.rootName && picked.rootName !== expectName
                ? ` (the import was made from "${expectName}" — files are matched by name and size)`
                : ''}
            </span>
          }
        />
      )}
    </Space>
  );
}
