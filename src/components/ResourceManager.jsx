import { useMemo, useState } from 'react';
import {
  Table,
  Button,
  Space,
  Form,
  Input,
  Popconfirm,
  Typography,
  Drawer,
  Descriptions,
  Tag,
  App,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { usePermissions } from '../features/auth/usePermissions';
import { buildColumns } from './columns';
import FormFields from './FormFields';
import { toFormValues, fromFormValues, inferFields, inferColumns, humanize } from './formUtils';

const { Title } = Typography;

/**
 * Reusable, config-driven CRUD surface: toolbar (search/filters/create), Table
 * with row actions, a create/edit Modal+Form, a details Drawer, and delete
 * Popconfirm. Data + mutation wiring are injected by the page so the same
 * component serves generic client-side resources and server-paginated ones.
 */
export default function ResourceManager({
  resource,
  rows = [],
  total,
  loading = false,
  fetching = false,
  onReload,
  mutations = {},
  server = null,
  readOnly = false,
  rowActions,
}) {
  const { message } = App.useApp();
  const perms = usePermissions();
  const [form] = Form.useForm();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null); // record being edited, null = create
  const [submitting, setSubmitting] = useState(false);
  const [viewRecord, setViewRecord] = useState(null);
  const [clientSearch, setClientSearch] = useState('');

  const idField = resource.idField || 'uid';
  const domain = resource.permission;

  const fields = useMemo(
    () => resource.fields || inferFields(rows),
    [resource.fields, rows],
  );
  const baseColumns = useMemo(
    () => resource.columns || inferColumns(rows),
    [resource.columns, rows],
  );

  const canCreate = !readOnly && Boolean(mutations.create) && perms.can(domain, 'create');
  const canEdit = !readOnly && Boolean(mutations.update) && perms.can(domain, 'update');
  const canDelete = !readOnly && Boolean(mutations.remove) && perms.can(domain, 'delete');

  // ---- client-side search filter (server mode controls search via props) ----
  const filteredRows = useMemo(() => {
    if (server || !clientSearch.trim()) return rows;
    const q = clientSearch.toLowerCase();
    return rows.filter((row) =>
      Object.values(row).some((v) =>
        v != null && String(typeof v === 'object' ? JSON.stringify(v) : v).toLowerCase().includes(q),
      ),
    );
  }, [rows, clientSearch, server]);

  // ---- editor ----------------------------------------------------------------
  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setEditorOpen(true);
  };

  const openEdit = (record) => {
    setEditing(record);
    form.resetFields();
    form.setFieldsValue(toFormValues(record, fields));
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditing(null);
  };

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return; // field-level errors already shown
    }
    let payload;
    try {
      payload = fromFormValues(values, fields);
    } catch {
      message.error('Invalid JSON in one of the fields.');
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await mutations.update(editing[idField], payload);
        message.success(`${resource.singular} updated`);
      } else {
        await mutations.create(payload);
        message.success(`${resource.singular} created`);
      }
      closeEditor();
    } catch {
      // baseQuery already raised a notification with the server message
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (record) => {
    try {
      await mutations.remove(record[idField]);
      message.success(`${resource.singular} deleted`);
    } catch {
      /* notification handled globally */
    }
  };

  // ---- columns ---------------------------------------------------------------
  const columns = useMemo(() => {
    const cols = buildColumns(baseColumns);
    const hasActions = canEdit || canDelete || rowActions;
    cols.push({
      key: '__view',
      title: 'Actions',
      fixed: 'right',
      width: hasActions ? 200 : 90,
      render: (_v, record) => (
        <Space size="small">
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => setViewRecord(record)}
            title="View"
          />
          {canEdit && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(record)}
              title="Edit"
            />
          )}
          {canDelete && (
            <Popconfirm
              title={`Delete this ${resource.singular.toLowerCase()}?`}
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(record)}
            >
              <Button size="small" danger icon={<DeleteOutlined />} title="Delete" />
            </Popconfirm>
          )}
          {rowActions?.(record)}
        </Space>
      ),
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseColumns, canEdit, canDelete, rowActions]);

  // ---- pagination ------------------------------------------------------------
  const pagination = server
    ? {
        current: server.page,
        pageSize: server.pageSize,
        total: total ?? 0,
        showSizeChanger: true,
        showTotal: (t) => `${t} total`,
        onChange: server.onPageChange,
      }
    : {
        pageSize: 10,
        showSizeChanger: true,
        showTotal: (t) => `${t} total`,
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
          {resource.plural}
        </Title>
        <Space wrap>
          {server?.filtersNode}
          <Input.Search
            allowClear
            placeholder={`Search ${resource.plural.toLowerCase()}`}
            style={{ width: 240 }}
            value={server ? server.search : clientSearch}
            onChange={(e) =>
              server ? server.onSearchChange?.(e.target.value) : setClientSearch(e.target.value)
            }
            onSearch={(val) => (server ? server.onSearchChange?.(val) : setClientSearch(val))}
          />
          <Button icon={<ReloadOutlined />} onClick={onReload} loading={fetching}>
            Reload
          </Button>
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              New {resource.singular}
            </Button>
          )}
        </Space>
      </div>

      <Table
        rowKey={(record) => record[idField] ?? record.id ?? record.uid}
        columns={columns}
        dataSource={filteredRows}
        loading={loading}
        pagination={pagination}
        scroll={{ x: 'max-content' }}
        size="middle"
      />

      <Drawer
        title={editing ? `Edit ${resource.singular}` : `New ${resource.singular}`}
        open={editorOpen}
        onClose={closeEditor}
        width={600}
        destroyOnClose
        footer={
          <div style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={closeEditor}>Cancel</Button>
              <Button type="primary" loading={submitting} onClick={handleSubmit}>
                Save
              </Button>
            </Space>
          </div>
        }
      >
        <Form form={form} layout="vertical">
          <FormFields fields={fields} />
        </Form>
      </Drawer>

      <Drawer
        title={`${resource.singular} details`}
        open={Boolean(viewRecord)}
        onClose={() => setViewRecord(null)}
        width={520}
      >
        {viewRecord && (
          <Descriptions column={1} bordered size="small">
            {Object.entries(viewRecord).map(([key, value]) => (
              <Descriptions.Item key={key} label={humanize(key)}>
                {renderDetailValue(value)}
              </Descriptions.Item>
            ))}
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
}

function renderDetailValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return <Tag color={value ? 'green' : 'default'}>{String(value)}</Tag>;
  if (Array.isArray(value)) return value.map((v) => <Tag key={String(v)}>{String(v)}</Tag>);
  if (typeof value === 'object') {
    return (
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return String(value);
}
