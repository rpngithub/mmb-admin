import { useEffect, useMemo, useState } from 'react';
import {
  Table,
  Typography,
  Space,
  Input,
  Button,
  Tag,
  Switch,
  InputNumber,
  Select,
  Form,
  Drawer,
  Popconfirm,
  Tooltip,
  Alert,
  App,
} from 'antd';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { adminApi } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';

const { Title, Text, Paragraph } = Typography;

const TYPE_OPTIONS = ['string', 'integer', 'boolean', 'json'].map((v) => ({
  label: v,
  value: v,
}));

// Deleting any of these removes it from the public GET /config feed and may
// break the app/website, so the delete confirm warns more loudly.
const CRITICAL_KEYS = new Set(['min_supported_version', 'cdn_base_url', 'maintenance_mode']);

// Stable-ish ordering for the grouped sections; unknown groups fall to the end
// alphabetically, and settings with no group land in "Ungrouped".
const GROUP_ORDER = ['general', 'billing', 'media'];
const UNGROUPED = 'Ungrouped';

function groupRank(name) {
  const i = GROUP_ORDER.indexOf(name);
  if (i !== -1) return i;
  if (name === UNGROUPED) return GROUP_ORDER.length + 1;
  return GROUP_ORDER.length; // other named groups, sorted alphabetically among themselves
}

const isTrue = (v) => v === true || v === 1 || v === '1' || v === 'true';

// ---- value <-> editor/api conversions --------------------------------------

// API string value → the form editor's native value for the given type.
function toEditorValue(type, value) {
  if (value === null || value === undefined) return type === 'boolean' ? false : undefined;
  if (type === 'boolean') return isTrue(value);
  if (type === 'integer') {
    const n = Number(value);
    return Number.isNaN(n) ? undefined : n;
  }
  if (type === 'json') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

// Editor value → the string (or null) the API stores. Throws on invalid JSON.
function toApiValue(type, value) {
  if (type === 'boolean') return value ? 'true' : 'false';
  if (value === undefined || value === null || value === '') return null;
  if (type === 'integer') return String(value);
  if (type === 'json') {
    JSON.parse(value); // throws → caught by submit handler
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  return String(value);
}

// ---- list cell renderers ----------------------------------------------------

function ValueCell({ record }) {
  const { type, value } = record;
  if (value === null || value === undefined || value === '') {
    return <Text type="secondary">—</Text>;
  }
  if (type === 'boolean') {
    const on = isTrue(value);
    return <Tag color={on ? 'green' : 'default'}>{on ? 'true' : 'false'}</Tag>;
  }
  const text = String(value);
  const truncated = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  const node = type === 'json' ? <Text code>{truncated}</Text> : <span>{truncated}</span>;
  return text.length > 60 ? <Tooltip title={text}>{node}</Tooltip> : node;
}

export default function AppSettingsPage() {
  const perms = usePermissions();
  const { message } = App.useApp();

  const canCreate = perms.can('settings', 'create');
  const canUpdate = perms.can('settings', 'update');
  const canDelete = perms.can('settings', 'delete');

  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState({ open: false, record: null });
  const [togglingId, setTogglingId] = useState(null);

  const { data, isLoading, isFetching, refetch } =
    adminApi.endpoints.appSettingsList.useQuery();
  const [updateTrigger] = adminApi.endpoints.appSettingsUpdate.useMutation();
  const [removeTrigger] = adminApi.endpoints.appSettingsRemove.useMutation();

  const rows = useMemo(() => {
    const all = data || [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((r) =>
      [r.key, r.value, r.description, r.group].some(
        (v) => v != null && String(v).toLowerCase().includes(q),
      ),
    );
  }, [data, search]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const g = r.group || UNGROUPED;
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(r);
    }
    return [...map.entries()].sort((a, b) => {
      const ra = groupRank(a[0]);
      const rb = groupRank(b[0]);
      return ra !== rb ? ra - rb : a[0].localeCompare(b[0]);
    });
  }, [rows]);

  const handleTogglePublic = async (record, checked) => {
    setTogglingId(record.id);
    try {
      await updateTrigger({ id: record.id, body: { is_public: checked ? 1 : 0 } }).unwrap();
      message.success(
        `"${record.key}" is now ${checked ? 'public — clients read it from /config' : 'internal'}`,
      );
    } catch {
      // error notification already raised by baseQuery
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (record) => {
    try {
      await removeTrigger(record.id).unwrap();
      message.success(`"${record.key}" deleted`);
    } catch {
      // error notification handled by baseQuery
    }
  };

  const columns = [
    {
      title: 'Key',
      dataIndex: 'key',
      key: 'key',
      render: (v) => <Text strong>{v}</Text>,
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (v) => <Tag>{v || 'string'}</Tag>,
    },
    {
      title: 'Value',
      key: 'value',
      render: (_v, record) => <ValueCell record={record} />,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (v) => v || <Text type="secondary">—</Text>,
    },
    {
      title: 'Visibility',
      dataIndex: 'is_public',
      key: 'is_public',
      width: 170,
      render: (v, record) => {
        const pub = isTrue(v);
        return (
          <Space>
            <Tag color={pub ? 'blue' : 'default'}>{pub ? 'Public' : 'Internal'}</Tag>
            {canUpdate && (
              <Switch
                size="small"
                checked={pub}
                loading={togglingId === record.id}
                onChange={(checked) => handleTogglePublic(record, checked)}
              />
            )}
          </Space>
        );
      },
    },
    {
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
              onClick={() => setEditor({ open: true, record })}
              title="Edit"
            />
          )}
          {canDelete && (
            <Popconfirm
              title={`Delete "${record.key}"?`}
              description={
                CRITICAL_KEYS.has(record.key)
                  ? 'The app/website depends on this setting. Deleting it removes it from GET /config and may break clients.'
                  : 'This cannot be undone.'
              }
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(record)}
            >
              <Button size="small" danger icon={<DeleteOutlined />} title="Delete" />
            </Popconfirm>
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
          App Settings
        </Title>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="Search settings"
            style={{ width: 240 }}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={setSearch}
          />
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
            Reload
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setEditor({ open: true, record: null })}
            >
              New Setting
            </Button>
          )}
        </Space>
      </div>

      {groups.length === 0 ? (
        <Table
          rowKey="id"
          columns={columns}
          dataSource={[]}
          loading={isLoading}
          pagination={false}
        />
      ) : (
        groups.map(([group, items]) => (
          <div key={group} style={{ marginBottom: 28 }}>
            <Title level={5} style={{ margin: '0 0 8px', textTransform: 'capitalize' }}>
              {group}{' '}
              <Text type="secondary" style={{ fontWeight: 400, fontSize: 13 }}>
                ({items.length})
              </Text>
            </Title>
            <Table
              rowKey="id"
              columns={columns}
              dataSource={items}
              loading={isLoading}
              pagination={false}
              scroll={{ x: 'max-content' }}
              size="middle"
            />
          </div>
        ))
      )}

      <SettingEditor
        open={editor.open}
        record={editor.record}
        onClose={() => setEditor({ open: false, record: null })}
        onSaved={refetch}
      />
    </div>
  );
}

const jsonValidator = (_rule, value) => {
  if (value === undefined || value === null || value === '') return Promise.resolve();
  try {
    JSON.parse(value);
    return Promise.resolve();
  } catch {
    return Promise.reject(new Error('Value must be valid JSON'));
  }
};

function ValueField({ type }) {
  switch (type) {
    case 'boolean':
      return (
        <Form.Item name="value" label="Value" valuePropName="checked" initialValue={false}>
          <Switch checkedChildren="true" unCheckedChildren="false" />
        </Form.Item>
      );
    case 'integer':
      return (
        <Form.Item name="value" label="Value">
          <InputNumber style={{ width: '100%' }} placeholder="Numeric value (stored as text)" />
        </Form.Item>
      );
    case 'json':
      return (
        <Form.Item name="value" label="Value" rules={[{ validator: jsonValidator }]}>
          <Input.TextArea
            rows={6}
            style={{ fontFamily: 'monospace' }}
            placeholder={'{ "key": "value" }'}
          />
        </Form.Item>
      );
    case 'string':
    default:
      return (
        <Form.Item name="value" label="Value">
          <Input placeholder="String value" />
        </Form.Item>
      );
  }
}

function SettingEditor({ open, record, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const isEdit = Boolean(record);

  const type = Form.useWatch('type', form) || 'string';

  const [createTrigger] = adminApi.endpoints.appSettingsCreate.useMutation();
  const [updateTrigger] = adminApi.endpoints.appSettingsUpdate.useMutation();

  useEffect(() => {
    if (!open) return;
    if (record) {
      form.setFieldsValue({
        key: record.key,
        type: record.type || 'string',
        value: toEditorValue(record.type || 'string', record.value),
        description: record.description ?? undefined,
        group: record.group ?? undefined,
        is_public: isTrue(record.is_public),
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ type: 'string', is_public: false });
    }
  }, [open, record, form]);

  // When the type changes, the value editor changes shape — reset the value so a
  // boolean editor never inherits a leftover string, etc.
  const handleValuesChange = (changed) => {
    if ('type' in changed) {
      form.setFieldsValue({ value: changed.type === 'boolean' ? false : undefined });
    }
  };

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return; // field-level errors already shown
    }
    const t = values.type || 'string';
    let valueStr;
    try {
      valueStr = toApiValue(t, values.value);
    } catch {
      message.error('Value must be valid JSON for the "json" type.');
      return;
    }

    const body = {
      type: t,
      value: valueStr,
      description: values.description?.trim() ? values.description.trim() : null,
      group: values.group?.trim() ? values.group.trim() : null,
      is_public: values.is_public ? 1 : 0,
    };

    setSubmitting(true);
    try {
      if (isEdit) {
        await updateTrigger({ id: record.id, body }).unwrap();
        message.success('Setting updated');
        if (body.is_public === 1) {
          message.info('Public setting — clients read it from GET /config (may be cached).');
        }
      } else {
        await createTrigger({ key: values.key.trim(), ...body }).unwrap();
        message.success('Setting created');
      }
      onSaved?.();
      onClose();
    } catch {
      /* baseQuery raised the server message (incl. 409 duplicate key) */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      title={isEdit ? `Edit "${record?.key}"` : 'New App Setting'}
      open={open}
      onClose={onClose}
      width={600}
      destroyOnClose
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="primary" loading={submitting} onClick={handleSubmit}>
              Save
            </Button>
          </Space>
        </div>
      }
    >
      <Form form={form} layout="vertical" onValuesChange={handleValuesChange}>
        <Form.Item
          name="key"
          label="Key"
          rules={[
            { required: true, message: 'Key is required' },
            { max: 100, message: 'Key must be 100 characters or fewer' },
          ]}
          extra={isEdit ? 'Key is immutable after creation.' : 'Unique, e.g. support_email'}
        >
          <Input disabled={isEdit} placeholder="setting_key" />
        </Form.Item>

        <Form.Item name="type" label="Type" rules={[{ required: true }]}>
          <Select options={TYPE_OPTIONS} />
        </Form.Item>

        <ValueField type={type} />

        <Form.Item name="description" label="Description">
          <Input.TextArea rows={2} placeholder="What this setting controls" />
        </Form.Item>

        <Form.Item
          name="group"
          label="Group"
          rules={[{ max: 50, message: 'Group must be 50 characters or fewer' }]}
          extra="Used to group settings in the list (e.g. general, billing, media)."
        >
          <Input placeholder="general" />
        </Form.Item>

        <Form.Item
          name="is_public"
          label="Public"
          valuePropName="checked"
          extra="Public settings are served to unauthenticated clients via GET /config. This is visibility, not access control — don't store secrets here."
        >
          <Switch checkedChildren="Public" unCheckedChildren="Internal" />
        </Form.Item>

        {type === 'json' && (
          <Alert
            type="info"
            showIcon
            message="JSON value is validated client-side and stored as a string; the server also enforces it."
          />
        )}
        {type === 'integer' && (
          <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
            Stored and returned as a string (e.g. <code>&quot;18&quot;</code>); the type is just metadata for consumers.
          </Paragraph>
        )}
      </Form>
    </Drawer>
  );
}
