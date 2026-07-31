import { useMemo, useState } from 'react';
import { Select, Input, Button, Space, Divider, App } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { adminApi } from '../features/api/adminApi';

/**
 * Multi-select bound to the shared Tags table (GET /admin/tags) with inline tag
 * creation (POST /admin/tags). Value/onChange are an array of numeric tag ids,
 * so it drops straight into a Form.Item. Used by business categories and assets.
 */
export default function TagSelect({ value, onChange }) {
  const { message } = App.useApp();
  const { data: tags } = adminApi.endpoints.tagsList.useQuery();
  const [createTag, { isLoading }] = adminApi.endpoints.tagsCreate.useMutation();
  const [name, setName] = useState('');

  const options = useMemo(() => (tags || []).map((t) => ({ label: t.name, value: t.id })), [tags]);

  const addTag = async () => {
    const n = name.trim();
    if (!n) return;
    try {
      const created = await createTag({ name: n }).unwrap();
      setName('');
      onChange?.([...(value || []), created.id]);
      message.success(`Tag "${created.name}" created`);
    } catch {
      // 409 duplicate (and others) surfaced by baseQuery
    }
  };

  return (
    <Select
      mode="multiple"
      allowClear
      value={value}
      onChange={onChange}
      options={options}
      optionFilterProp="label"
      placeholder="Select tags"
      dropdownRender={(menu) => (
        <>
          {menu}
          <Divider style={{ margin: '8px 0' }} />
          <Space style={{ padding: '0 8px 4px' }}>
            <Input
              size="small"
              placeholder="New tag name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onPressEnter={(e) => {
                e.preventDefault();
                addTag();
              }}
            />
            <Button
              size="small"
              type="text"
              icon={<PlusOutlined />}
              loading={isLoading}
              onClick={addTag}
            >
              Add
            </Button>
          </Space>
        </>
      )}
    />
  );
}
