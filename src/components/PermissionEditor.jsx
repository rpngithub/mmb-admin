import { useMemo } from 'react';
import { Switch, Checkbox, Typography, Alert } from 'antd';
import { PERMISSION_CATALOG, ACTIONS } from '../resources/permissionCatalog';
import { useGetDashboardManifestQuery } from '../features/api/adminApi';
import { mergeWidgetCatalog } from '../lib/dashboard';

const { Text } = Typography;

const GRID = {
  display: 'grid',
  gridTemplateColumns: '1.7fr repeat(4, 60px) 72px',
  alignItems: 'center',
  columnGap: 4,
  rowGap: 4,
};

const CENTER = { textAlign: 'center' };

/**
 * Controlled RBAC permission editor.
 *
 *   value:    string[]  — e.g. ["*"] or ["templates.*", "users.read"]
 *   onChange: (string[]) => void
 *
 * Semantics:
 *   - Superuser switch → emits ["*"] and disables the matrix.
 *   - Per domain: ticking all available actions collapses to "<domain>.*";
 *     a partial selection emits the explicit "<domain>.<action>" strings.
 *   - On load, a stored "<domain>.*" ticks all of that domain's boxes, and "*"
 *     lights the superuser switch.
 */
export default function PermissionEditor({ value, onChange }) {
  const perms = Array.isArray(value) ? value : [];
  const superuser = perms.includes('*');

  const emit = (next) => onChange?.(next);

  const selectedFor = (domain, actions) => {
    if (perms.includes(`${domain}.*`)) return new Set(actions);
    return new Set(actions.filter((a) => perms.includes(`${domain}.${a}`)));
  };

  // Rebuild the permission list for one domain from a selected-action set,
  // preserving every token that belongs to other domains.
  const setDomain = (domain, actions, set) => {
    const next = perms.filter((p) => !p.startsWith(`${domain}.`));
    if (set.size > 0 && set.size === actions.length) {
      next.push(`${domain}.*`); // collapse full domain
    } else {
      for (const a of actions) if (set.has(a)) next.push(`${domain}.${a}`);
    }
    emit(next);
  };

  const toggleAction = (domain, actions, action, checked) => {
    const set = selectedFor(domain, actions);
    if (checked) set.add(action);
    else set.delete(action);
    setDomain(domain, actions, set);
  };

  const toggleFull = (domain, actions, checked) =>
    setDomain(domain, actions, checked ? new Set(actions) : new Set());

  const toggleSuperuser = (checked) => emit(checked ? ['*'] : []);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Switch checked={superuser} onChange={toggleSuperuser} />
        <Text strong>Superuser</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Grants every permission (<code>*</code>) and disables the matrix.
        </Text>
      </div>

      {superuser ? (
        <Alert
          type="warning"
          showIcon
          message="Superuser role"
          description="This role has full access to every section. Turn off Superuser to pick specific permissions."
        />
      ) : (
        <div>
          <div style={{ ...GRID, fontSize: 12, fontWeight: 600, paddingBottom: 6 }}>
            <span>Domain</span>
            <span style={CENTER}>Read</span>
            <span style={CENTER}>Create</span>
            <span style={CENTER}>Update</span>
            <span style={CENTER}>Delete</span>
            <span style={CENTER}>Full</span>
          </div>

          {PERMISSION_CATALOG.map((entry) => {
            const set = selectedFor(entry.domain, entry.actions);
            const full = set.size === entry.actions.length;
            const partial = set.size > 0 && !full;
            return (
              <div
                key={entry.domain}
                style={{ ...GRID, borderTop: '1px solid rgba(5,5,5,0.06)', padding: '6px 0' }}
              >
                <span>
                  <Text>{entry.label}</Text>
                  {entry.hint && (
                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                      {entry.hint}
                    </Text>
                  )}
                </span>
                {ACTIONS.map((action) => (
                  <span key={action} style={CENTER}>
                    {entry.actions.includes(action) ? (
                      <Checkbox
                        checked={set.has(action)}
                        onChange={(e) =>
                          toggleAction(entry.domain, entry.actions, action, e.target.checked)
                        }
                      />
                    ) : null}
                  </span>
                ))}
                <span style={CENTER}>
                  <Checkbox
                    checked={full}
                    indeterminate={partial}
                    onChange={(e) => toggleFull(entry.domain, entry.actions, e.target.checked)}
                  />
                </span>
              </div>
            );
          })}

          <DashboardWidgetsPicker perms={perms} emit={emit} />
        </div>
      )}
    </div>
  );
}

/**
 * One checkbox per dashboard widget (`dashboard.<widget_key>`), labelled with
 * the manifest's titles. Widgets are always granted individually — this never
 * emits `dashboard.*`; a role that already holds it shows every box ticked, and
 * the first change rewrites it as the explicit list.
 */
function DashboardWidgetsPicker({ perms, emit }) {
  // The manifest is trimmed to the editing admin's own grants; the static
  // catalog fills in the rest so every widget is always offered.
  const { data } = useGetDashboardManifestQuery();
  const widgets = useMemo(() => mergeWidgetCatalog(data?.widgets), [data]);

  const wildcard = perms.includes('dashboard.*');
  const selected = wildcard
    ? widgets.map((w) => w.permission)
    : perms.filter((p) => p.startsWith('dashboard.'));

  const onChange = (next) => {
    const rest = perms.filter((p) => !p.startsWith('dashboard.'));
    // Keep the catalog order so saved lists read the same as the dashboard.
    const ordered = widgets.map((w) => w.permission).filter((p) => next.includes(p));
    emit([...rest, ...ordered]);
  };

  return (
    <div style={{ borderTop: '1px solid rgba(5,5,5,0.06)', paddingTop: 10, marginTop: 4 }}>
      <Text strong>Dashboard widgets</Text>
      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
        Each widget is its own permission — grant them individually.
      </Text>
      {wildcard && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 8 }}
          message={
            <>
              This role holds <code>dashboard.*</code> (every widget). Changing a box replaces it
              with the explicit list.
            </>
          }
        />
      )}
      <Checkbox.Group value={selected} onChange={onChange} style={{ width: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
          {widgets.map((w) => (
            <Checkbox key={w.permission} value={w.permission}>
              {w.title}
            </Checkbox>
          ))}
        </div>
      </Checkbox.Group>
    </div>
  );
}
