import { useEffect, useMemo, useState } from 'react';
import {
  Table,
  Typography,
  Space,
  Input,
  Button,
  Tag,
  Select,
  InputNumber,
  Switch,
  Form,
  Drawer,
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

const { Title, Text } = Typography;

const PLATFORMS = ['instagram', 'facebook', 'youtube', 'whatsapp', 'custom'];
const isTrue = (v) => v === true || v === 1 || v === '1';

/**
 * Template Sizes — simple reference CRUD. Dedicated (not generic) so the payload
 * carries the exact strict types: width/height as integers, platform from the
 * enum, is_active as 0|1, unit default "px".
 */
export default function TemplateSizesPage() {
  const perms = usePermissions();
  const { message, modal } = App.useApp();

  const canCreate = perms.can('sizes', 'create');
  const canUpdate = perms.can('sizes', 'update');
  const canDelete = perms.can('sizes', 'delete');

  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState({ open: false, record: null });

  const { data, isLoading, isFetching, refetch } =
    adminApi.endpoints.templateSizesList.useQuery();
  const [removeTrigger] = adminApi.endpoints.templateSizesRemove.useMutation();

  const rows = useMemo(() => {
    const all = data || [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (r) => r.name?.toLowerCase().includes(q) || r.platform?.toLowerCase().includes(q),
    );
  }, [data, search]);

  const onDelete = (record) => {
    modal.confirm({
      title: `Delete size "${record.name}"?`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeTrigger(record.uid).unwrap();
          message.success('Size deleted');
        } catch {
          // error notification handled by baseQuery
        }
      },
    });
  };

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name', render: (v) => <Text strong>{v}</Text> },
    {
      title: 'Slug',
      dataIndex: 'slug',
      key: 'slug',
      width: 160,
      render: (v) => (v ? <Text code>{v}</Text> : <Text type="secondary">—</Text>),
    },
    {
      title: 'Dimensions',
      key: 'dims',
      render: (_v, r) => `${r.width} × ${r.height} ${r.unit || 'px'}`,
    },
    {
      title: 'Platform',
      dataIndex: 'platform',
      key: 'platform',
      width: 130,
      render: (v) => (v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text>),
    },
    {
      title: 'Active',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      render: (v) => <Tag color={isTrue(v) ? 'green' : 'default'}>{isTrue(v) ? 'Yes' : 'No'}</Tag>,
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
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => onDelete(record)}
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
          Template Sizes
        </Title>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="Search sizes"
            style={{ width: 220 }}
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
              New Size
            </Button>
          )}
        </Space>
      </div>

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        scroll={{ x: 'max-content' }}
        size="middle"
        pagination={{ pageSize: 15, showSizeChanger: true, showTotal: (t) => `${t} total` }}
      />

      <SizeEditor
        open={editor.open}
        record={editor.record}
        onClose={() => setEditor({ open: false, record: null })}
        onSaved={refetch}
      />
    </div>
  );
}

function SizeEditor({ open, record, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const isEdit = Boolean(record);

  const [createTrigger] = adminApi.endpoints.templateSizesCreate.useMutation();
  const [updateTrigger] = adminApi.endpoints.templateSizesUpdate.useMutation();

  useEffect(() => {
    if (!open) return;
    if (record) {
      form.setFieldsValue({
        name: record.name,
        width: record.width,
        height: record.height,
        unit: record.unit || 'px',
        platform: record.platform || 'custom',
        is_active: isTrue(record.is_active),
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ unit: 'px', platform: 'custom', is_active: true });
    }
  }, [open, record, form]);

  const handleSubmit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const body = {
      name: values.name.trim(),
      width: Math.trunc(values.width),
      height: Math.trunc(values.height),
      unit: (values.unit || 'px').trim() || 'px',
      platform: values.platform,
      is_active: values.is_active ? 1 : 0,
    };
    setSubmitting(true);
    try {
      if (isEdit) {
        await updateTrigger({ id: record.uid, body }).unwrap();
        message.success('Size updated');
      } else {
        await createTrigger(body).unwrap();
        message.success('Size created');
      }
      onSaved?.();
      onClose();
    } catch {
      // error notification handled by baseQuery
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      title={isEdit ? `Edit "${record?.name}"` : 'New Template Size'}
      open={open}
      onClose={onClose}
      width={480}
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
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Name is required' }]}>
          <Input placeholder="e.g. Instagram Post" />
        </Form.Item>
        <Space size="large" wrap>
          <Form.Item
            name="width"
            label="Width"
            rules={[{ required: true, message: 'Width is required' }]}
          >
            <InputNumber min={1} precision={0} style={{ width: 140 }} placeholder="px" />
          </Form.Item>
          <Form.Item
            name="height"
            label="Height"
            rules={[{ required: true, message: 'Height is required' }]}
          >
            <InputNumber min={1} precision={0} style={{ width: 140 }} placeholder="px" />
          </Form.Item>
        </Space>
        <Form.Item name="unit" label="Unit">
          <Input style={{ width: 140 }} placeholder="px" />
        </Form.Item>
        <Form.Item name="platform" label="Platform" rules={[{ required: true }]}>
          <Select
            style={{ width: 200 }}
            options={PLATFORMS.map((p) => ({ label: p, value: p }))}
          />
        </Form.Item>
        <Form.Item name="is_active" label="Active" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
