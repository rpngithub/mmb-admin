import { useMemo } from 'react';
import { Alert, Spin, Tag, Typography } from 'antd';
import OrderedMultiSelect from './OrderedMultiSelect';

const { Text } = Typography;
const isTrue = (v) => v === true || v === 1 || v === '1';

/**
 * Full ancestor path for an industry — "Food & Beverage › Cafe". Leaf names on
 * their own ("Cafe", "Studio") repeat across branches, so the path is what makes
 * an option identifiable in the picker. `seen` guards a cyclic parent_id.
 */
function pathLabel(row, byId) {
  const parts = [];
  const seen = new Set();
  let cur = row;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift(cur.name);
    cur = cur.parent_id != null ? byId.get(cur.parent_id) : null;
  }
  return parts.join(' › ');
}

function Row({ option, fallback, id }) {
  // No option and no fallback: the industry vanished from the list (someone else
  // deleted it). Show it rather than a bare id so the editor can drop it.
  if (!option && !fallback) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <Text type="secondary">#{id}</Text>
        <Tag color="warning">Not found</Tag>
      </span>
    );
  }
  const label = option?.path || fallback?.name;
  const slug = option?.slug ?? fallback?.slug;
  const active = option ? option.isActive : isTrue(fallback?.is_active);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {slug && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          <code>{slug}</code>
        </Text>
      )}
      {!active && <Tag>Inactive</Tag>}
    </span>
  );
}

/**
 * The curated "Related industries" block for an industry's public SEO landing
 * page: pick industries in the Select, drag the rows below into the order they
 * should render in.
 *
 * The links are ONE-WAY (adding Cafe here does not add this industry to Cafe's
 * block) and ORDERED, which is why this is a drag list and not a plain
 * multi-select. `value` is the ordered array of numeric ids and IS the
 * `related_industry_ids` payload — the caller just re-sends it.
 *
 * `rows` is the full industry list (the same query the table uses); `selfId` is
 * excluded from the options because the server 400s a self-link. `fallbackRows`
 * are the RelatedIndustries the GET returned, used to label a selected id that
 * is no longer in `rows`.
 */
export default function RelatedIndustriesField({
  value = [],
  onChange,
  rows = [],
  selfId,
  fallbackRows = [],
  disabled,
  loading,
  error,
}) {
  const options = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    return rows
      .filter((r) => r.id !== selfId)
      .map((r) => {
        const path = pathLabel(r, byId);
        const isActive = isTrue(r.is_active);
        return {
          value: r.id,
          // Kept a plain string: the Select filters on `label`. The "(inactive)"
          // suffix is how an inactive option is marked in the dropdown — the
          // public site drops those from the block entirely.
          label: isActive ? path : `${path} (inactive)`,
          path,
          slug: r.slug,
          isActive,
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
    // The API returns industries newest-first, which is useless in a picker.
  }, [rows, selfId]);

  const fallbackById = useMemo(
    () => new Map((fallbackRows || []).map((r) => [r.id, r])),
    [fallbackRows],
  );

  return (
    <Spin spinning={Boolean(loading)}>
      <OrderedMultiSelect
        value={value}
        onChange={onChange}
        options={options}
        disabled={disabled}
        placeholder="Select industries to link to"
        emptyText="No related industries — the block is hidden on the public page."
        renderLabel={(option, id) => (
          <Row option={option} fallback={fallbackById.get(id)} id={id} />
        )}
      />

      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 8 }}
          message={error.message}
          description={
            error.details?.length ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {error.details.map((d, i) => (
                  <li key={`${d.field || 'error'}-${i}`}>
                    {d.field ? `${d.field}: ` : ''}
                    {d.message}
                  </li>
                ))}
              </ul>
            ) : undefined
          }
        />
      )}
    </Spin>
  );
}
