import { useEffect, useMemo, useState } from 'react';
import { Alert, Col, Row, Segmented, Space, Statistic, Table, Tag, Typography } from 'antd';
import { WarningOutlined } from '@ant-design/icons';

const { Text } = Typography;

const STATUS_META = {
  created: { color: 'green', label: 'Created' },
  updated: { color: 'blue', label: 'Updated' },
  skipped: { color: 'red', label: 'Skipped' },
};

// AntD's warning gold. Warnings are advisory — never the red used for skipped.
const WARNING_COLOR = '#faad14';

/** A row the editor probably has to act on: it didn't import, or it warned. */
const isProblem = (row) => row.status === 'skipped' || (row.warnings?.length ?? 0) > 0;

/**
 * Ordering rank for the report table: skipped rows first (something didn't
 * import), then rows that imported but carry warnings, then everything else.
 */
function problemRank(row) {
  if (row.status === 'skipped') return 0;
  if ((row.warnings?.length ?? 0) > 0) return 1;
  return 2;
}

/**
 * The result panel shared by the Bulk Import page and the per-screen import
 * drawer: dry-run/committed banner, run-level `notes`, the summary counters and
 * the per-line row report.
 *
 * `summary.warnings` is a count of ROWS carrying at least one warning, not a
 * total of warnings — and a warning is never a failure: a row can be `created`
 * and still warn three times. Hence amber everywhere, never red.
 *
 * @param {object}  props.result              the import response `data`
 * @param {boolean} [props.defaultProblemsOnly]  start filtered to skipped + warned rows
 */
export default function ImportResultReport({ result, defaultProblemsOnly = false }) {
  const rows = useMemo(() => result?.rows || [], [result]);
  const problems = useMemo(() => rows.filter(isProblem), [rows]);

  const [scope, setScope] = useState('all');

  // Every new run re-decides the default: problems first when there are any,
  // otherwise there is nothing to filter down to.
  useEffect(() => {
    setScope(defaultProblemsOnly && problems.length > 0 ? 'problems' : 'all');
  }, [result, defaultProblemsOnly, problems.length]);

  const dataSource = useMemo(() => {
    const list = scope === 'problems' ? problems : rows;
    return [...list].sort((a, b) => {
      const ra = problemRank(a);
      const rb = problemRank(b);
      if (ra !== rb) return ra - rb;
      return (a.line ?? 0) - (b.line ?? 0);
    });
  }, [rows, problems, scope]);

  const columns = [
    { title: 'Line', dataIndex: 'line', key: 'line', width: 80 },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (v) => v || <Text type="secondary">—</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      filters: Object.entries(STATUS_META).map(([value, m]) => ({ text: m.label, value })),
      onFilter: (value, record) => record.status === value,
      render: (status) => {
        const m = STATUS_META[status] || { color: 'default', label: status };
        return <Tag color={m.color}>{m.label}</Tag>;
      },
    },
    {
      // Advisory only — the row still imported. Amber, never red. The strings
      // themselves are in the expandable row below.
      title: 'Warnings',
      key: 'warnings',
      width: 130,
      filters: [{ text: 'Has warnings', value: 'yes' }],
      onFilter: (_value, record) => (record.warnings?.length ?? 0) > 0,
      render: (_v, record) => {
        const count = record.warnings?.length ?? 0;
        if (count === 0) return <Text type="secondary">—</Text>;
        return (
          <Tag icon={<WarningOutlined />} color="warning">
            {count === 1 ? '1 warning' : `${count} warnings`}
          </Tag>
        );
      },
    },
    {
      title: 'Message',
      dataIndex: 'message',
      key: 'message',
      render: (v) => v || <Text type="secondary">—</Text>,
    },
  ];

  const summary = result?.summary || {};
  const notes = result?.notes || [];

  return (
    <>
      <Alert
        style={{ marginBottom: 16 }}
        showIcon
        type={result.dry_run ? 'info' : 'success'}
        message={
          result.dry_run
            ? 'Validation only — nothing was written'
            : 'Import committed — these changes were written'
        }
        description={
          result.dry_run ? 'This is what would happen. Use Import to apply it.' : undefined
        }
      />

      {/* Run-level messages from the server (e.g. the S3 bucket was
          unreachable). Already user-facing prose — rendered as-is. */}
      {notes.length > 0 && (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message="Notes"
          description={
            notes.length === 1 ? (
              notes[0]
            ) : (
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                {notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )
          }
        />
      )}

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} md={4}>
          <Statistic title="Total" value={summary.total ?? 0} />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Statistic title="Created" value={summary.created ?? 0} valueStyle={{ color: '#52c41a' }} />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Statistic title="Updated" value={summary.updated ?? 0} valueStyle={{ color: '#1677ff' }} />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Statistic
            title="Skipped"
            value={summary.skipped ?? 0}
            valueStyle={{ color: (summary.skipped ?? 0) > 0 ? '#cf1322' : undefined }}
          />
        </Col>
        <Col xs={12} sm={8} md={4}>
          {/* Rows carrying at least one warning — not a failure count. */}
          <Statistic
            title="Warnings"
            value={summary.warnings ?? 0}
            valueStyle={{ color: (summary.warnings ?? 0) > 0 ? WARNING_COLOR : undefined }}
          />
        </Col>
      </Row>

      {problems.length > 0 && (
        <Space style={{ marginBottom: 12 }} wrap>
          <Segmented
            size="small"
            value={scope}
            onChange={setScope}
            options={[
              { label: `Needs attention (${problems.length})`, value: 'problems' },
              { label: `All rows (${rows.length})`, value: 'all' },
            ]}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            Skipped rows and rows that imported with a warning.
          </Text>
        </Space>
      )}

      <Table
        rowKey={(r) => `${r.line}-${r.name ?? ''}`}
        size="small"
        columns={columns}
        dataSource={dataSource}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} rows` }}
        scroll={{ x: 'max-content' }}
        expandable={{
          rowExpandable: (r) => (r.warnings?.length ?? 0) > 0,
          expandedRowRender: (r) => (
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              {r.warnings.map((w, i) => (
                // Warning strings are already human-readable and prefixed with
                // the column name — render them verbatim.
                <li key={`${r.line}-${i}`} style={{ color: WARNING_COLOR }}>
                  {w}
                </li>
              ))}
            </ul>
          ),
        }}
      />
    </>
  );
}
