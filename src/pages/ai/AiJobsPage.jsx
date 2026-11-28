import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Collapse,
  DatePicker,
  Descriptions,
  Drawer,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { CopyOutlined, ReloadOutlined, UndoOutlined } from '@ant-design/icons';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi } from '../../features/api/adminApi';
import { usePermissions } from '../../features/auth/usePermissions';
import {
  JOB_STATUSES,
  JOB_STATUS_COLORS,
  RESOLVABLE,
  errorText,
  formatDateTime,
  formatInr,
  formatNumber,
  prettyJson,
  refOf,
} from '../../lib/ai';

const { Title, Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;

const EMPTY_FILTERS = {
  status: [],
  operation_key: undefined,
  provider_id: undefined,
  user_id: '',
  error_code: '',
  range: null,
};

const mono = {
  fontFamily: 'monospace',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  margin: 0,
  maxHeight: 320,
  overflow: 'auto',
};

const StatusTag = ({ status }) => (
  <Tag color={JOB_STATUS_COLORS[status] || 'default'}>{status || '—'}</Tag>
);

function userLabel(job) {
  const u = job.user || job.User || {};
  const name = u.name || u.full_name || job.user_name;
  const phone = u.phone || u.mobile || job.user_phone;
  if (!name && !phone) return job.user_id ? `#${job.user_id}` : '—';
  return (
    <Space direction="vertical" size={0}>
      <Text>{name || '—'}</Text>
      {phone && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {phone}
        </Text>
      )}
    </Space>
  );
}

function JsonBlock({ value }) {
  const text = prettyJson(value);
  if (!text) return <Text type="secondary">—</Text>;
  return <pre style={mono}>{text}</pre>;
}

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** A text operation's result: result.text.options as cards + "Copy JSON". */
function TextResult({ text }) {
  const { message } = App.useApp();
  const options = asArray(text?.options);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(text, null, 2));
      message.success('Copied');
    } catch {
      message.error('Could not copy — the browser blocked clipboard access.');
    }
  };
  return (
    <div>
      <Space style={{ marginBottom: 8 }}>
        <Text type="secondary">
          {options.length} option{options.length === 1 ? '' : 's'}
        </Text>
        <Button size="small" icon={<CopyOutlined />} onClick={copy}>
          Copy JSON
        </Button>
      </Space>
      {options.length === 0 && <JsonBlock value={text} />}
      <Row gutter={[12, 12]}>
        {options.map((o, i) => (
          <Col xs={24} md={12} key={i}>
            <Card size="small" title={o?.title || `Option ${i + 1}`}>
              {o?.caption && (
                <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>{o.caption}</Paragraph>
              )}
              {asArray(o?.hashtags).length > 0 && (
                <Space size={[4, 4]} wrap style={{ marginBottom: 8 }}>
                  {asArray(o.hashtags).map((h, j) => (
                    <Tag key={j} color="blue">
                      {String(h).startsWith('#') ? h : `#${h}`}
                    </Tag>
                  ))}
                </Space>
              )}
              {o?.alt_text && (
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Alt text:{' '}
                  </Text>
                  <Text style={{ fontSize: 12 }}>{o.alt_text}</Text>
                </div>
              )}
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}

/** A result file's URL — the key name isn't pinned down, so take the first one present. */
const fileUrl = (f) => f?.url || f?.signed_url || f?.public_url || f?.download_url || null;
const fileMime = (f) => String(f?.mime || f?.content_type || '');

function fmtDurationMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return null;
  const s = Math.round(n / 100) / 10;
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/** result.files: audio → <audio> player, image → thumbnail, else a link. */
function FilesResult({ files }) {
  return (
    <Row gutter={[12, 12]}>
      {files.map((f, i) => {
        const url = fileUrl(f);
        const mime = fileMime(f);
        const duration = fmtDurationMs(f?.duration_ms);
        let body;
        if (url && mime.startsWith('audio/')) {
          body = <audio controls preload="none" src={url} style={{ width: '100%' }} />;
        } else if (url && mime.startsWith('image/')) {
          body = (
            <a href={url} target="_blank" rel="noreferrer">
              <img
                src={url}
                alt={`Result ${i + 1}`}
                style={{
                  maxWidth: '100%',
                  maxHeight: 240,
                  display: 'block',
                  // Checkerboard so transparent (background-removed) results read as such.
                  background:
                    'repeating-conic-gradient(#e5e5e5 0% 25%, #fff 0% 50%) 50% / 16px 16px',
                }}
              />
            </a>
          );
        } else if (url) {
          body = (
            <a href={url} target="_blank" rel="noreferrer">
              Open file
            </a>
          );
        } else {
          body = <Text type="secondary">No URL on this file</Text>;
        }
        return (
          <Col xs={24} md={12} key={i}>
            <Card size="small">
              {body}
              <Space size={4} wrap style={{ marginTop: 6 }}>
                {mime && <Tag>{mime}</Tag>}
                {duration && <Tag>{duration}</Tag>}
              </Space>
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}

/** A done job's result: { text } for text operations, { files } for images / audio. */
function JobResult({ result }) {
  if (!result) return <Text type="secondary">—</Text>;
  if (result.text) return <TextResult text={result.text} />;
  if (Array.isArray(result.files) && result.files.length) return <FilesResult files={result.files} />;
  return <JsonBlock value={result} />;
}

const SHOWN_SEPARATELY = [
  'attempts',
  'charge_split',
  'refund_split',
  'context',
  'request_snapshot',
  'result',
];

function JobDrawer({ uid, onClose, onResolve, canResolve }) {
  const { data: job, isFetching } = adminApi.endpoints.aiJobGet.useQuery(uid, { skip: !uid });
  const attempts = job?.attempts || [];

  const attemptColumns = [
    { title: '#', dataIndex: 'attempt_no', key: 'attempt_no', width: 50 },
    { title: 'Outcome', dataIndex: 'outcome', key: 'outcome', render: (v) => <Tag>{v || '—'}</Tag> },
    { title: 'HTTP', dataIndex: 'http_status', key: 'http_status', render: (v) => v ?? '—' },
    { title: 'Error', dataIndex: 'error_code', key: 'error_code', render: (v) => v || '—' },
    {
      title: 'Detail',
      dataIndex: 'error_detail',
      key: 'error_detail',
      render: (v) => {
        if (!v) return '—';
        // Background removal whose result came back opaque: job fails, credits refunded.
        if (/no transparent background/i.test(String(v))) {
          return (
            <Tooltip title="The background-removal result had no transparency, so the job failed and the credits were refunded.">
              <Space size={4}>
                <Tag color="orange">not transparent</Tag>
                <Text style={{ fontSize: 12 }}>{String(v)}</Text>
              </Space>
            </Tooltip>
          );
        }
        return (
          <Text style={{ fontSize: 12 }} ellipsis={{ tooltip: String(v) }}>
            {String(v)}
          </Text>
        );
      },
    },
    { title: 'Started', dataIndex: 'started_at', key: 'started_at', render: formatDateTime },
    {
      title: 'Duration',
      dataIndex: 'duration_ms',
      key: 'duration_ms',
      render: (v) => (v === null || v === undefined ? '—' : `${formatNumber(v, 0)} ms`),
    },
  ];

  return (
    <Drawer
      title={job ? `Job ${job.uid}` : 'Job'}
      open={Boolean(uid)}
      onClose={onClose}
      width={860}
      destroyOnClose
      extra={
        job &&
        canResolve &&
        RESOLVABLE.has(job.status) && (
          <Button danger icon={<UndoOutlined />} onClick={() => onResolve(job)}>
            Resolve &amp; refund
          </Button>
        )
      }
    >
      {!job ? (
        <Spin spinning={isFetching} />
      ) : (
        <>
          <Descriptions size="small" bordered column={{ xs: 1, md: 2 }} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Status">
              <StatusTag status={job.status} />
            </Descriptions.Item>
            <Descriptions.Item label="Operation">
              <Text code>{job.operation_key}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="User">{userLabel(job)}</Descriptions.Item>
            <Descriptions.Item label="Created">{formatDateTime(job.created_at)}</Descriptions.Item>
            <Descriptions.Item label="Provider / model">
              {(job.provider?.name || job.provider_key || '—') + (job.model ? ` / ${job.model}` : '')}
            </Descriptions.Item>
            <Descriptions.Item label="Credits charged">
              {formatNumber(job.credits_charged, 4)}
            </Descriptions.Item>
            <Descriptions.Item label="Cost to us">{formatInr(job.cost_inr)}</Descriptions.Item>
            <Descriptions.Item label="Refunded">
              {job.refunded_at ? formatDateTime(job.refunded_at) : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Error code">{job.error_code || '—'}</Descriptions.Item>
            <Descriptions.Item label="Attempts">{job.attempts_count ?? attempts.length}</Descriptions.Item>
          </Descriptions>

          <Title level={5}>Attempts</Title>
          <Table
            rowKey={(a) => a.uid || a.attempt_no}
            size="small"
            columns={attemptColumns}
            dataSource={attempts}
            pagination={false}
            scroll={{ x: 'max-content' }}
            expandable={{
              rowExpandable: (a) => Boolean(a.response_excerpt),
              expandedRowRender: (a) => (
                <Collapse
                  size="small"
                  items={[
                    {
                      key: 'resp',
                      label: 'Captured provider response (excerpt)',
                      children: <JsonBlock value={a.response_excerpt} />,
                    },
                  ]}
                />
              ),
            }}
            style={{ marginBottom: 16 }}
          />

          {job.result && (
            <>
              <Title level={5}>Result</Title>
              <div style={{ marginBottom: 16 }}>
                <JobResult result={job.result} />
              </div>
            </>
          )}

          <Collapse
            size="small"
            defaultActiveKey={[]}
            items={[
              {
                key: 'context',
                label: 'Context (added by the server: language, business, project, attachments)',
                children: <JsonBlock value={job.context} />,
              },
              {
                key: 'snapshot',
                label: 'Request snapshot (what the last send used)',
                children: <JsonBlock value={job.request_snapshot} />,
              },
              { key: 'charge', label: 'Charge split', children: <JsonBlock value={job.charge_split} /> },
              { key: 'refund', label: 'Refund split', children: <JsonBlock value={job.refund_split} /> },
              ...(job.result?.text || (Array.isArray(job.result?.files) && job.result.files.length)
                ? [{ key: 'result', label: 'Result (raw JSON)', children: <JsonBlock value={job.result} /> }]
                : []),
              {
                key: 'all',
                label: 'All fields',
                children: (
                  <JsonBlock
                    value={Object.fromEntries(
                      Object.entries(job).filter(([k]) => !SHOWN_SEPARATELY.includes(k)),
                    )}
                  />
                ),
              },
            ]}
          />
        </>
      )}
    </Drawer>
  );
}

export default function AiJobsPage() {
  const perms = usePermissions();
  const { message } = App.useApp();
  const canResolve = perms.can('ai_jobs', 'update');

  // `?user_uid=` arrives from a user's detail page ("View AI jobs").
  const [searchParams, setSearchParams] = useSearchParams();
  const userUid = searchParams.get('user_uid') || undefined;
  const clearUserUid = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('user_uid');
    setSearchParams(next, { replace: true });
  };

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [openUid, setOpenUid] = useState(null);
  const [resolving, setResolving] = useState(null); // job being resolved
  const [note, setNote] = useState('');

  // Filter option sources — only fetched when the admin can read them.
  const { data: operations = [] } = adminApi.endpoints.aiOperationsList.useQuery(undefined, {
    skip: !perms.canRead('ai_operations'),
  });
  const { data: providers = [] } = adminApi.endpoints.aiProvidersList.useQuery(undefined, {
    skip: !perms.canRead('ai_providers'),
  });

  const queryArg = useMemo(
    () => ({
      status: filters.status.length ? filters.status.join(',') : undefined,
      operation_key: filters.operation_key,
      provider_id: filters.provider_id,
      user_id: filters.user_id.trim() || undefined,
      user_uid: userUid,
      error_code: filters.error_code.trim() || undefined,
      from: filters.range?.[0]?.startOf('day').toISOString(),
      to: filters.range?.[1]?.endOf('day').toISOString(),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    [filters, userUid, page, pageSize],
  );
  const { data, isLoading, isFetching, refetch } = adminApi.endpoints.aiJobsList.useQuery(queryArg);
  const [resolveJob, { isLoading: resolveBusy }] = adminApi.endpoints.aiJobResolve.useMutation();

  const setFilter = (k, v) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  const startResolve = (job) => {
    setNote('');
    setResolving(job);
  };

  const confirmResolve = async () => {
    const job = resolving;
    try {
      await resolveJob({ uid: job.uid, note: note.trim() || undefined }).unwrap();
      message.success('Resolved — the user’s credits were refunded.');
      setResolving(null);
    } catch (err) {
      if (err?.status === 409) {
        message.warning('This job already finished — refreshing.');
        setResolving(null);
        refetch();
        return;
      }
      message.error(errorText(err, 'Could not resolve the job.'));
    }
  };

  const columns = [
    { title: 'Created', dataIndex: 'created_at', key: 'created_at', render: formatDateTime },
    { title: 'User', key: 'user', render: (_v, r) => userLabel(r) },
    {
      title: 'Operation',
      dataIndex: 'operation_key',
      key: 'operation_key',
      render: (v) => <Text code>{v}</Text>,
    },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (v) => <StatusTag status={v} /> },
    {
      title: 'Credits',
      dataIndex: 'credits_charged',
      key: 'credits_charged',
      align: 'right',
      render: (v) => formatNumber(v, 4),
    },
    {
      title: 'Refunded',
      dataIndex: 'refunded_at',
      key: 'refunded_at',
      render: (v) => (v ? <Tooltip title={formatDateTime(v)}><Tag color="blue">refunded</Tag></Tooltip> : '—'),
    },
    { title: 'Error', dataIndex: 'error_code', key: 'error_code', render: (v) => v || '—' },
    { title: 'Model', dataIndex: 'model', key: 'model', render: (v) => v || '—' },
    {
      title: 'Cost',
      dataIndex: 'cost_inr',
      key: 'cost_inr',
      align: 'right',
      render: (v) => formatInr(v),
    },
    {
      title: 'Attempts',
      dataIndex: 'attempts_count',
      key: 'attempts_count',
      align: 'right',
      render: (v) => v ?? '—',
    },
    {
      title: '',
      key: 'actions',
      fixed: 'right',
      render: (_v, r) => (
        <Space size="small">
          <Button size="small" onClick={() => setOpenUid(r.uid)}>
            Details
          </Button>
          {canResolve && RESOLVABLE.has(r.status) && (
            <Tooltip title="Resolve & refund">
              <Button size="small" danger icon={<UndoOutlined />} onClick={() => startResolve(r)} />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  const filtersActive =
    userUid ||
    filters.status.length ||
    filters.operation_key ||
    filters.provider_id ||
    filters.user_id ||
    filters.error_code ||
    filters.range;

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
          AI Jobs
        </Title>
        <Space wrap>
          {filtersActive ? (
            <Button
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setPage(1);
                if (userUid) clearUserUid();
              }}
            >
              Clear filters
            </Button>
          ) : null}
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
            Reload
          </Button>
        </Space>
      </div>

      <Space wrap style={{ marginBottom: 16 }}>
        {userUid && (
          <Tag
            closable
            color="blue"
            onClose={(e) => {
              e.preventDefault();
              clearUserUid();
              setPage(1);
            }}
          >
            <Link to={`/users/${encodeURIComponent(userUid)}`}>User {userUid.slice(0, 8)}…</Link>
          </Tag>
        )}
        <Select
          mode="multiple"
          allowClear
          placeholder="Status"
          style={{ minWidth: 200 }}
          value={filters.status}
          onChange={(v) => setFilter('status', v)}
          options={JOB_STATUSES.map((s) => ({ value: s, label: s }))}
        />
        {operations.length ? (
          <Select
            allowClear
            showSearch
            placeholder="Operation"
            style={{ width: 200 }}
            value={filters.operation_key}
            onChange={(v) => setFilter('operation_key', v)}
            options={operations.map((o) => ({ value: o.key, label: o.label || o.key }))}
          />
        ) : (
          <Input
            allowClear
            placeholder="Operation key"
            style={{ width: 180 }}
            value={filters.operation_key || ''}
            onChange={(e) => setFilter('operation_key', e.target.value || undefined)}
          />
        )}
        {providers.length > 0 && (
          <Select
            allowClear
            placeholder="Provider"
            style={{ width: 170 }}
            value={filters.provider_id}
            onChange={(v) => setFilter('provider_id', v)}
            options={providers.map((p) => ({ value: refOf(p), label: p.name || p.key }))}
          />
        )}
        <Input
          allowClear
          placeholder="User id"
          style={{ width: 120 }}
          value={filters.user_id}
          onChange={(e) => setFilter('user_id', e.target.value)}
        />
        <Input
          allowClear
          placeholder="Error code"
          style={{ width: 160 }}
          value={filters.error_code}
          onChange={(e) => setFilter('error_code', e.target.value)}
        />
        <RangePicker value={filters.range} onChange={(v) => setFilter('range', v)} />
      </Space>

      <Table
        rowKey="uid"
        size="middle"
        columns={columns}
        dataSource={data?.items || []}
        loading={isLoading || isFetching}
        scroll={{ x: 'max-content' }}
        onRow={(r) => ({ onDoubleClick: () => setOpenUid(r.uid) })}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100],
          showTotal: (t) => `${t} jobs`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />

      <JobDrawer
        uid={openUid}
        onClose={() => setOpenUid(null)}
        onResolve={startResolve}
        canResolve={canResolve}
      />

      <Modal
        open={Boolean(resolving)}
        title="Resolve & refund this job?"
        okText="Resolve & refund"
        okButtonProps={{ danger: true }}
        confirmLoading={resolveBusy}
        onOk={confirmResolve}
        onCancel={() => setResolving(null)}
        destroyOnClose
        zIndex={1100}
      >
        {resolving && (
          <>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={`Refunds ${formatNumber(resolving.credits_charged, 4)} credits to the user and closes the job.`}
              description={`Status now: ${resolving.status}. If it has already finished, the server refuses and the list refreshes.`}
            />
            <Input.TextArea
              rows={3}
              placeholder="Note (why it’s being resolved) — saved with the job"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              showCount
            />
          </>
        )}
      </Modal>
    </div>
  );
}
