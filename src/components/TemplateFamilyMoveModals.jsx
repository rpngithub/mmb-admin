import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Select, Space, Alert, Tag, Typography, Spin, Descriptions, App } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import { adminApi } from '../features/api/adminApi';
import { STATUS_COLORS, isTrue, num, TEXT_FREE_LABEL } from '../lib/templateFamilies';

const { Text, Paragraph } = Typography;

/** Server-searched design picker (limit caps the page, so search is remote). */
function FamilyPicker({ excludeUid, value, onChange, disabled }) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isFetching } = adminApi.endpoints.templateFamiliesList.useQuery({
    search: debounced || undefined,
    limit: 20,
  });

  const options = useMemo(
    () =>
      (data?.items || [])
        .filter((f) => f.uid !== excludeUid)
        .map((f) => {
          const langs = isTrue(f.text_free)
            ? TEXT_FREE_LABEL
            : `${(f.languages || []).length} lang`;
          return {
            value: f.uid,
            label: f.name,
            display: (
              <Space size={6}>
                <span>{f.name}</span>
                <Tag color={STATUS_COLORS[f.status] || 'default'} style={{ marginInlineEnd: 0 }}>
                  {f.status}
                </Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {num(f.version_count)} version{num(f.version_count) === 1 ? '' : 's'} · {langs}
                </Text>
              </Space>
            ),
          };
        }),
    [data, excludeUid],
  );

  return (
    <Select
      showSearch
      allowClear
      disabled={disabled}
      style={{ width: '100%' }}
      placeholder="Search designs by name"
      filterOption={false}
      onSearch={setSearch}
      value={value}
      onChange={onChange}
      loading={isFetching}
      notFoundContent={isFetching ? <Spin size="small" /> : 'No designs found'}
      options={options.map((o) => ({ value: o.value, label: o.display, name: o.label }))}
      optionLabelProp="name"
    />
  );
}

const OUTCOME_TEXT = {
  unchanged: { color: 'default', text: 'stays as it is' },
  draft: {
    color: 'gold',
    text: 'goes back to draft — it loses the version it needed to stay live',
  },
  archived: {
    color: 'red',
    text: 'has no versions left, so it becomes inactive and its views, likes and trending score are added to the target',
  },
};

function versionLabel(v) {
  if (!v) return '';
  return v.name || v.uid;
}

/** Renders a dry-run plan (move or merge — same shape). */
function PlanPreview({ plan, conflicts }) {
  const outcome = OUTCOME_TEXT[plan?.source?.outcome] || null;
  const changes = Array.isArray(plan?.changes) ? plan.changes : [];
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {conflicts.length > 0 && (
        <Alert
          type="error"
          showIcon
          message="This can't go ahead — the target already has a version in these slots"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {conflicts.map((c, i) => (
                <li key={`${c.version_uid || c.field || ''}-${i}`}>
                  {c.version ? (
                    <Text strong>{versionLabel(c.version)}: </Text>
                  ) : null}
                  {c.message}
                </li>
              ))}
            </ul>
          }
        />
      )}

      <Descriptions
        size="small"
        column={1}
        bordered
        items={[
          plan?.version && {
            key: 'version',
            label: 'Version',
            children: <Text>{versionLabel(plan.version)}</Text>,
          },
          {
            key: 'from',
            label: 'From',
            children: (
              <Space size={6} wrap>
                <Text strong>{plan?.source?.name}</Text>
                {plan?.source?.versions != null && (
                  <Text type="secondary">
                    ({num(plan.source.versions)} version{num(plan.source.versions) === 1 ? '' : 's'})
                  </Text>
                )}
              </Space>
            ),
          },
          {
            key: 'to',
            label: 'To',
            children: (
              <Space size={6}>
                <ArrowRightOutlined />
                <Text strong>{plan?.target?.name}</Text>
              </Space>
            ),
          },
          outcome && {
            key: 'outcome',
            label: 'Old design',
            children: (
              <Space size={6} wrap>
                <Tag color={outcome.color}>{plan.source.outcome}</Tag>
                <Text>{outcome.text}</Text>
              </Space>
            ),
          },
        ].filter(Boolean)}
      />

      <div>
        <Text strong>What changes</Text>
        <Paragraph type="secondary" style={{ margin: '2px 0 6px', fontSize: 12 }}>
          The target design’s details win: moved versions take on its category, tags, industries,
          access level, variants and special events.
        </Paragraph>
        {changes.length ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        ) : (
          <Text type="secondary">Nothing else changes.</Text>
        )}
      </div>

      <Text type="secondary" style={{ fontSize: 12 }}>
        Version links don’t change, so users’ projects keep working.
      </Text>
    </Space>
  );
}

const conflictsOf = (planOrErr) => {
  if (Array.isArray(planOrErr?.conflicts)) return planOrErr.conflicts;
  if (Array.isArray(planOrErr?.details)) return planOrErr.details;
  return [];
};

/**
 * Pick a target → dry-run preview → confirm (the same call without dry_run).
 * `run(targetUid, dryRun)` returns the RTK mutation promise.
 */
function RelocateModal({ open, title, intro, excludeUid, okText, run, onDone, onClose }) {
  const { message } = App.useApp();
  const [target, setTarget] = useState();
  const [plan, setPlan] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [error, setError] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!open) {
      setTarget(undefined);
      setPlan(null);
      setConflicts([]);
      setError(null);
    }
  }, [open]);

  const preview = async (uid) => {
    setTarget(uid);
    setPlan(null);
    setConflicts([]);
    setError(null);
    if (!uid) return;
    const req = ++reqRef.current;
    setPreviewing(true);
    try {
      const res = await run(uid, true).unwrap();
      if (req !== reqRef.current) return; // a newer pick superseded this one
      setPlan(res);
      setConflicts(conflictsOf(res));
    } catch (err) {
      if (req !== reqRef.current) return;
      if (err?.status === 409) setConflicts(conflictsOf(err));
      setError(err?.message || 'Could not preview this change.');
    } finally {
      if (req === reqRef.current) setPreviewing(false);
    }
  };

  const confirm = async () => {
    if (!target || !plan || conflicts.length) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await run(target, false).unwrap();
      onDone?.(target, res);
    } catch (err) {
      // A conflict can appear between preview and confirm (another admin).
      if (err?.status === 409) {
        setConflicts(conflictsOf(err));
        setError(err?.message || 'The target now has a conflicting version.');
      } else {
        setError(err?.message || 'The change failed.');
        message.error(err?.message || 'The change failed.');
      }
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      width={620}
      onCancel={onClose}
      okText={okText}
      onOk={confirm}
      okButtonProps={{ disabled: !plan || conflicts.length > 0 || previewing }}
      confirmLoading={confirming}
      destroyOnClose
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        {intro}
        <FamilyPicker
          excludeUid={excludeUid}
          value={target}
          onChange={preview}
          disabled={confirming}
        />
        {previewing && (
          <Space>
            <Spin size="small" /> <Text type="secondary">Checking what would change…</Text>
          </Space>
        )}
        {error && !plan && <Alert type="error" showIcon message={error} />}
        {!plan && !previewing && conflicts.length > 0 && (
          <PlanPreview plan={{}} conflicts={conflicts} />
        )}
        {plan && <PlanPreview plan={plan} conflicts={conflicts} />}
        {error && plan && <Alert type="error" showIcon message={error} />}
      </Space>
    </Modal>
  );
}

/** "Move to another design…" for one version. */
export function MoveVersionModal({ open, version, familyUid, onClose, onMoved }) {
  const { message } = App.useApp();
  const [move] = adminApi.endpoints.templateVersionMove.useMutation();
  return (
    <RelocateModal
      open={open}
      title="Move version to another design"
      okText="Move version"
      excludeUid={familyUid}
      intro={
        <Text type="secondary">
          Pick the design this version really belongs to. You’ll see what changes before anything
          is moved.
        </Text>
      }
      run={(target, dryRun) =>
        move({ uid: version?.uid, family_uid: target, familyUid, dryRun })
      }
      onDone={(target, res) => {
        message.success(`Moved to “${res?.target?.name || 'the other design'}”`);
        onMoved?.(target, res);
      }}
      onClose={onClose}
    />
  );
}

/** "Merge into another design…" for a whole family. */
export function MergeFamilyModal({ open, family, onClose, onMerged }) {
  const { message } = App.useApp();
  const [merge] = adminApi.endpoints.templateFamilyMerge.useMutation();
  return (
    <RelocateModal
      open={open}
      title={`Merge “${family?.name || ''}” into another design`}
      okText="Merge"
      excludeUid={family?.uid}
      intro={
        <Paragraph type="secondary" style={{ margin: 0 }}>
          Every version of this design moves into the one you pick, and this design becomes
          inactive. It’s all or nothing: if any version clashes with one the target already has
          (same language and size), nothing is merged.
        </Paragraph>
      }
      run={(target, dryRun) => merge({ uid: family?.uid, into_family_uid: target, dryRun })}
      onDone={(target, res) => {
        message.success(`Merged into “${res?.target?.name || 'the other design'}”`);
        onMerged?.(target, res);
      }}
      onClose={onClose}
    />
  );
}
