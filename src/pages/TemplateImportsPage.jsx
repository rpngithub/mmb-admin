import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Typography, Space, Button, Select, Tag, Tooltip, App } from 'antd';
import { ReloadOutlined, PlusOutlined, DownloadOutlined, PauseCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTemplateImportsListQuery } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import { useAppSelector } from '../app/hooks';
import { downloadCsv } from '../lib/downloadTemplate';
import { IMPORT_STATUS, STAGE, STAGE_ORDER } from '../lib/templateImport';

const { Title, Text } = Typography;

const PAGE_SIZE = 20;

const fmt = (v) => (v ? dayjs(v).format('D MMM YYYY, HH:mm') : '—');

const adminName = (v) => {
  if (!v) return '—';
  if (typeof v === 'string') return v;
  return v.name || v.full_name || v.email || v.uid || '—';
};

/** Whether an import still has work an admin can pick up. */
const isOpen = (r) => ['draft', 'validated', 'running'].includes(r.status);

export function ManifestTemplateLinks({ size = 'middle' }) {
  const { message } = App.useApp();
  const token = useAppSelector((s) => s.auth.accessToken);
  const [busy, setBusy] = useState(null);
  const get = async (example) => {
    setBusy(example ? 'example' : 'blank');
    try {
      await downloadCsv({
        path: `/admin/template-imports/manifest-template${example ? '?example=1' : ''}`,
        token,
        fallbackName: example ? 'manifest_EXAMPLE.csv' : 'manifest.csv',
      });
    } catch (err) {
      message.error(err.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Space wrap size={4}>
      <Button size={size} icon={<DownloadOutlined />} loading={busy === 'blank'} onClick={() => get(false)}>
        Download manifest template
      </Button>
      <Button size={size} type="link" loading={busy === 'example'} onClick={() => get(true)}>
        with example rows
      </Button>
    </Space>
  );
}

export default function TemplateImportsPage() {
  const navigate = useNavigate();
  const perms = usePermissions();
  const canCreate = perms.can('templates', 'create');
  const [status, setStatus] = useState();
  const [page, setPage] = useState(1);

  const { data, isFetching, refetch } = useTemplateImportsListQuery({
    status,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const columns = [
    {
      title: 'Import',
      key: 'label',
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <a onClick={() => navigate(`/template-imports/${r.uid}`)}>{r.label || 'Untitled import'}</a>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {r.uid}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 200,
      render: (_, r) => (
        <Space size={4} wrap>
          <Tag color={IMPORT_STATUS[r.status]?.color}>{IMPORT_STATUS[r.status]?.label || r.status}</Tag>
          {r.is_paused && (
            <Tooltip title="Running, but nothing has happened for 30 minutes. Open it and pick the same folder to continue.">
              <Tag icon={<PauseCircleOutlined />} color="warning">
                Paused
              </Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Rows',
      key: 'rows',
      render: (_, r) => (
        <Space size={[4, 4]} wrap>
          <Text strong>{r.total_items ?? 0}</Text>
          {STAGE_ORDER.filter((s) => r.counts?.[s]).map((s) => (
            <Tag key={s} color={STAGE[s].color} style={{ marginInlineEnd: 0 }}>
              {r.counts[s]} {STAGE[s].label.toLowerCase()}
            </Tag>
          ))}
        </Space>
      ),
    },
    { title: 'By', dataIndex: 'created_by', width: 140, render: adminName },
    {
      title: 'Last activity',
      dataIndex: 'last_activity_at',
      width: 170,
      render: (v, r) => fmt(v || r.created_at),
    },
    {
      title: 'Started / finished',
      key: 'times',
      width: 200,
      render: (_, r) => (
        <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
          <Text type="secondary">Started {fmt(r.started_at)}</Text>
          <Text type="secondary">Finished {fmt(r.finished_at)}</Text>
        </Space>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 110,
      align: 'right',
      render: (_, r) =>
        isOpen(r) && canCreate ? (
          <Button size="small" type={r.is_paused ? 'primary' : 'default'} onClick={() => navigate(`/template-imports/${r.uid}`)}>
            Resume
          </Button>
        ) : (
          <Button size="small" onClick={() => navigate(`/template-imports/${r.uid}`)}>
            Open
          </Button>
        ),
    },
  ];

  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Space direction="vertical" size={0}>
          <Title level={4} style={{ margin: 0 }}>
            Template Import
          </Title>
          <Text type="secondary">
            Import many designs and their versions from a folder of ZIPs. Files upload straight from this
            browser, so keep the tab open while an import runs.
          </Text>
        </Space>
        <Space wrap>
          <ManifestTemplateLinks />
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
            Reload
          </Button>
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/template-imports/new')}>
              New import
            </Button>
          )}
        </Space>
      </div>

      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          allowClear
          placeholder="Any status"
          style={{ width: 220 }}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={Object.entries(IMPORT_STATUS).map(([value, s]) => ({ value, label: s.label }))}
        />
      </Space>

      <Table
        rowKey="uid"
        size="middle"
        columns={columns}
        dataSource={data?.items || []}
        loading={isFetching}
        scroll={{ x: 1000 }}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total: data?.total || 0,
          showSizeChanger: false,
          onChange: setPage,
        }}
      />
    </>
  );
}
