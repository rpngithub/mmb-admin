import { Switch, Checkbox, Typography, Alert } from 'antd';
import { PERMISSION_CATALOG, ACTIONS } from '../resources/permissionCatalog';

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
        </div>
      )}
    </div>
  );
}
