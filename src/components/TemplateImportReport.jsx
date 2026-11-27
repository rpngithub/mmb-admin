import { memo, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Table, Tag, Typography, Space, Progress, Segmented, Tooltip, Empty } from 'antd';
import {
  CloseCircleFilled,
  WarningFilled,
  InfoCircleFilled,
  LoadingOutlined,
  CheckCircleFilled,
} from '@ant-design/icons';
import {
  STAGE,
  OUTCOME,
  fmtBytes,
  isFileWarning,
  publishWarnings,
  rowKey,
  warningCount,
  warningLevel,
} from '../lib/templateImport';

const { Text } = Typography;

const LEVEL = {
  error: { color: '#ff4d4f', icon: <CloseCircleFilled /> },
  warning: { color: '#d48806', icon: <WarningFilled /> },
  // Info is a quiet note: grey text, small, blue icon only.
  info: { color: 'rgba(0, 0, 0, 0.45)', iconColor: '#1677ff', icon: <InfoCircleFilled />, fontSize: 12 },
};

/** One message line: errors red, level "warning" amber, level "info" a quiet grey note. */
function Line({ m, level, boxed }) {
  const l = LEVEL[level] || LEVEL.info;
  const box = boxed
    ? { background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 4, padding: '2px 8px', fontWeight: 600 }
    : null;
  return (
    <div
      style={{ color: l.color, display: 'flex', gap: 6, alignItems: 'baseline', fontSize: l.fontSize, ...box }}
    >
      <span style={{ flex: 'none', color: l.iconColor }}>{l.icon}</span>
      <span>
        {m.field ? <Text code style={{ color: 'inherit' }}>{m.field}</Text> : null} {m.message}
      </span>
    </div>
  );
}

/**
 * `reason`: warnings to show first under "Stays a draft because" (a row whose
 * result is "draft": its scope "publish" warnings).
 */
export function Messages({ errors: errs, warnings: warns, notes = [], extra, reason }) {
  const errors = errs || [];
  const reasons = reason || [];
  const warnings = (warns || []).filter((w) => !reasons.includes(w));
  // Warnings before quiet info notes.
  const ordered = [
    ...warnings.filter((w) => warningLevel(w) === 'warning'),
    ...warnings.filter((w) => warningLevel(w) !== 'warning'),
  ];
  if (!errors.length && !ordered.length && !reasons.length && !notes.length && !extra) {
    return <Text type="secondary">—</Text>;
  }
  return (
    <Space direction="vertical" size={2} style={{ fontSize: 13 }}>
      {reasons.length > 0 && (
        <Text strong style={{ color: '#d48806', fontSize: 12 }}>
          Stays a draft because:
        </Text>
      )}
      {reasons.map((m, i) => (
        <Line key={`r${i}`} m={m} level="warning" boxed />
      ))}
      {errors.map((m, i) => (
        <Line key={`e${i}`} m={m} level="error" />
      ))}
      {/* What this browser found in the bundle: the reason behind the errors above. */}
      {notes.map((text, i) => (
        <Line key={`n${i}`} m={{ message: text }} level="error" />
      ))}
      {ordered.map((m, i) => (
        <Line key={`w${i}`} m={m} level={warningLevel(m)} boxed={isFileWarning(m)} />
      ))}
      {extra}
    </Space>
  );
}

const hasProblem = (item, run, notes) =>
  Boolean(notes?.length) ||
  item.stage === 'invalid' ||
  item.stage === 'failed' ||
  run?.state === 'error' ||
  (item.errors || []).length > 0 ||
  (item.warnings || []).some((w) => warningLevel(w) === 'warning');

function StageCell({ item, run }) {
  const s = STAGE[item.stage] || { label: item.stage, color: 'default' };
  const showProgress = run && (run.state === 'running' || (run.total > 0 && run.state !== 'done'));
  const warns = warningCount(item);
  return (
    <Space direction="vertical" size={2} style={{ width: '100%' }}>
      <Space size={4} wrap>
        <Tag color={s.color} style={{ marginInlineEnd: 0 }}>
          {s.label}
          {item.stage === 'failed' && item.failed_stage ? ` at ${item.failed_stage}` : ''}
        </Tag>
        {item.result && (
          <Tag color={item.result === 'published' ? 'green' : 'gold'} style={{ marginInlineEnd: 0 }}>
            {item.result === 'published' ? 'Published' : 'Draft'}
          </Tag>
        )}
        {/* Warnings never block the row: it still imports. */}
        {warns > 0 && (
          <Tooltip title="Imported anyway — the warnings are listed in Messages.">
            <Tag color="warning" icon={<WarningFilled />} style={{ marginInlineEnd: 0 }}>
              {warns} warning{warns === 1 ? '' : 's'}
            </Tag>
          </Tooltip>
        )}
        {run?.state === 'running' && <LoadingOutlined style={{ color: '#1677ff' }} />}
        {run?.state === 'done' && item.stage === 'completed' && <CheckCircleFilled style={{ color: '#52c41a' }} />}
      </Space>
      {showProgress && (
        <Tooltip title={`${run.filesDone || 0} / ${run.filesTotal || 0} files · ${fmtBytes(run.sent)} of ${fmtBytes(run.total)}`}>
          <Progress
            size="small"
            percent={run.total ? Math.floor((run.sent / run.total) * 100) : 0}
            status={run.state === 'error' ? 'exception' : 'active'}
            style={{ margin: 0, minWidth: 120 }}
          />
        </Tooltip>
      )}
    </Space>
  );
}

/**
 * The import report grouped by design (designs[]) with its rows (items[])
 * underneath. `run` is the upload runner's per-row state (Map rowKey → { state,
 * message, sent, total, filesDone, filesTotal }); omit it for a static view.
 * `notes` is what this browser found reading the bundles (Map rowKey → [string]).
 * Both are keyed by folder (rowKey), not row: a new manifest renumbers rows.
 */
function TemplateImportReport({ report, run, notes }) {
  const [show, setShow] = useState('all');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const items = useMemo(() => report?.items || [], [report]);
  // `rows` of a design are the CURRENT row numbers — only used to join here.
  const byRow = useMemo(() => new Map(items.map((i) => [i.row, i])), [items]);

  const groups = useMemo(() => {
    const seen = new Set();
    const out = (report?.designs || []).map((d) => {
      const rows = (d.rows || []).map((r) => byRow.get(r)).filter(Boolean);
      rows.forEach((r) => seen.add(r.row));
      // Keyed by name, so collapsed designs stay collapsed after a new manifest.
      return { key: `d:${String(d.family_name || '').toLowerCase()}`, design: d, rows };
    });
    const orphans = items.filter((i) => !seen.has(i.row));
    if (orphans.length) {
      out.push({ key: 'orphans', design: { family_name: null, warnings: [] }, rows: orphans });
    }
    return out;
  }, [report, items, byRow]);

  const visible = useMemo(() => {
    if (show === 'all') return groups;
    return groups
      .map((g) => ({
        ...g,
        rows: g.rows.filter((r) => hasProblem(r, run?.get(rowKey(r)), notes?.get(rowKey(r)))),
      }))
      .filter((g) => g.rows.length || (g.design.warnings || []).some((w) => warningLevel(w) === 'warning'));
  }, [groups, show, run, notes]);

  const rowColumns = [
    {
      title: 'Line',
      dataIndex: 'line',
      width: 64,
      render: (v, r) => (
        <Tooltip title={`Row ${r.row}`}>
          <Text strong>{v ?? r.row}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Version',
      key: 'version',
      width: 170,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Text>
            {r.language || <Text type="secondary">Text-free</Text>} · {r.size || '—'}
          </Text>
          {r.template_uid && (
            <Text type="secondary" style={{ fontSize: 12 }} copyable={{ text: r.template_uid }}>
              {r.template_status ? `${r.template_status} · ` : ''}
              {r.template_uid.slice(0, 10)}…
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'ZIP / folder',
      key: 'folder',
      width: 200,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Text code style={{ wordBreak: 'break-all' }}>
            {r.folder || '—'}
          </Text>
          {(r.files || []).length > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {r.files.length} file(s), {fmtBytes(r.files.reduce((s, f) => s + (Number(f.size) || 0), 0))}
            </Text>
          )}
          {/* Null until the files are sent: a blank cell lets the server pick one. */}
          <Text type="secondary" style={{ fontSize: 12, wordBreak: 'break-all' }}>
            Thumbnail: {r.thumbnail || (r.stage === 'awaiting_files' ? 'detected from the files' : 'none')}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Stage',
      key: 'stage',
      width: 190,
      render: (_, r) => <StageCell item={r} run={run?.get(rowKey(r))} />,
    },
    {
      title: 'Messages',
      key: 'messages',
      render: (_, r) => {
        const rr = run?.get(rowKey(r));
        return (
          <Messages
            errors={r.errors}
            warnings={r.warnings}
            reason={r.result === 'draft' ? publishWarnings(r.warnings) : undefined}
            notes={notes?.get(rowKey(r))}
            extra={
              rr?.state === 'error' && rr.message ? (
                <Line m={{ message: `Upload stopped: ${rr.message}` }} level="error" />
              ) : null
            }
          />
        );
      },
    },
  ];

  const designColumns = [
    {
      title: 'Design',
      key: 'name',
      render: (_, g) => {
        const d = g.design;
        if (d.family_name === null) return <Text type="secondary">Rows without a design</Text>;
        return (
          <Space size={6} wrap>
            {d.family_uid ? (
              <Link to={`/templates/${d.family_uid}`}>
                <Text strong>{d.family_name}</Text>
              </Link>
            ) : (
              <Text strong>{d.family_name}</Text>
            )}
            {d.existing && (
              <Tooltip title="A design with this name already exists — these versions are added to it.">
                <Tag color="blue">Existing{d.family_status ? ` · ${d.family_status}` : ''}</Tag>
              </Tooltip>
            )}
            {d.outcome && <Tag color={OUTCOME[d.outcome]?.color}>{OUTCOME[d.outcome]?.label || d.outcome}</Tag>}
            {/* The publish check's prediction (no tags, no category, files missing from a bundle…). */}
            {!d.outcome && publishWarnings(d.warnings).some((w) => warningLevel(w) === 'warning') && (
              <Tooltip title="Predicted from the publish check — the reasons are in that column.">
                <Tag color="gold">Will stay a draft</Tag>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Rows',
      key: 'rows',
      width: 260,
      render: (_, g) => {
        const counts = {};
        g.rows.forEach((r) => {
          counts[r.stage] = (counts[r.stage] || 0) + 1;
        });
        return (
          <Space size={[4, 4]} wrap>
            {Object.entries(counts).map(([s, n]) => (
              <Tag key={s} color={STAGE[s]?.color} style={{ marginInlineEnd: 0 }}>
                {n} {(STAGE[s]?.label || s).toLowerCase()}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: 'Publish check',
      key: 'warnings',
      render: (_, g) => (
        <Messages
          warnings={g.design.warnings || []}
          reason={g.design.outcome === 'draft' ? publishWarnings(g.design.warnings) : undefined}
        />
      ),
    },
  ];

  if (!items.length) return <Empty description="No rows" />;

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Segmented
        value={show}
        onChange={setShow}
        options={[
          { value: 'all', label: `All designs (${groups.length})` },
          { value: 'problems', label: 'Problems only' },
        ]}
      />
      <Table
        rowKey="key"
        size="small"
        columns={designColumns}
        dataSource={visible}
        pagination={visible.length > 30 ? { pageSize: 30, showSizeChanger: false } : false}
        expandable={{
          // Every design open by default; remember only what the admin closed.
          expandedRowKeys: visible.map((g) => g.key).filter((k) => !collapsed.has(k)),
          onExpand: (open, g) =>
            setCollapsed((prev) => {
              const next = new Set(prev);
              if (open) next.delete(g.key);
              else next.add(g.key);
              return next;
            }),
          expandedRowRender: (g) => (
            <Table
              rowKey={rowKey}
              size="small"
              columns={rowColumns}
              dataSource={g.rows}
              pagination={false}
              scroll={{ x: 900 }}
            />
          ),
        }}
        scroll={{ x: 800 }}
      />
    </Space>
  );
}

// Memoised: the page re-renders on every progress tick, this table is large.
export default memo(TemplateImportReport);
