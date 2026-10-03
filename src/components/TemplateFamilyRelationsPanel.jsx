import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Select, Input, Button, Space, Spin, Tag, Typography, App } from 'antd';
import { LoadingOutlined, CheckOutlined, PlusOutlined } from '@ant-design/icons';
import { adminApi } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';

const { Text, Paragraph } = Typography;

// Local picker key → the request key it maps to. The PUT is a per-key full
// replace, so each picker saves on its own without touching the others. Sizes
// are gone: they belong to each version now (sending size_ids is a 400).
const RELATION_KEYS = {
  tags: 'tag_ids',
  variants: 'variant_ids',
  industries: 'industry_ids',
};
const SAVE_DEBOUNCE_MS = 600;
const EMPTY = { tags: [], variants: [], industries: [] };

/**
 * Every selected industry plus its ancestor chain, in selection order.
 *
 * Users pick an industry and, from that industry's tags, their tags at signup —
 * and the app serves designs by that pair. So a tag that isn't on the design's
 * industries can never match anyone, which is why the Tags picker is scoped to
 * these rows rather than to the whole tag table. A child industry inherits its
 * parents' tags, so the walk goes all the way to the root.
 */
function industryScope(ids, byId) {
  const out = [];
  const seen = new Set();
  ids.forEach((id) => {
    let node = byId.get(id);
    // parent_id is admin-editable, so a cycle is possible — guard against it.
    const guard = new Set();
    while (node && !guard.has(node.id)) {
      guard.add(node.id);
      if (!seen.has(node.id)) {
        seen.add(node.id);
        out.push(node);
      }
      node = node.parent_id != null ? byId.get(node.parent_id) : null;
    }
  });
  return out;
}

const relationsToValue = (relations) => ({
  tags: (relations?.Tags || []).map((t) => t.id),
  variants: (relations?.Variants || []).map((t) => t.id),
  // `Industries`; `BusinessCategories` is a deprecated duplicate.
  industries: (relations?.Industries || relations?.BusinessCategories || []).map((b) => b.id),
});

/**
 * The design's shared relations — Industries, Tags, Variants — each picker
 * auto-saved (debounced) as a per-key full replace, rolled back on failure.
 * Every version of the design inherits these.
 */
export default function TemplateFamilyRelationsPanel({ uid, disabled }) {
  const { message } = App.useApp();
  const perms = usePermissions();
  const { data: relations, isFetching } = adminApi.endpoints.templateFamilyRelations.useQuery(uid, {
    skip: !uid,
  });
  const { data: tags } = adminApi.endpoints.tagsList.useQuery();
  const { data: variants } = adminApi.endpoints.variantsList.useQuery();
  const { data: industries } = adminApi.endpoints.businessCategoriesList.useQuery();
  const [setRelations] = adminApi.endpoints.templateFamilySetRelations.useMutation();
  const [createTag] = adminApi.endpoints.tagsCreate.useMutation();
  const [setIndustryTags] = adminApi.endpoints.businessCategorySetTags.useMutation();
  const [fetchIndustries] = adminApi.endpoints.businessCategoriesList.useLazyQuery();

  const [value, setValue] = useState(EMPTY);
  const [saveState, setSaveState] = useState({}); // key → 'saving' | 'saved'
  const [newTagName, setNewTagName] = useState('');
  const [newTagIndustry, setNewTagIndustry] = useState(null);
  const [addingTag, setAddingTag] = useState(false);

  const serverRef = useRef(EMPTY); // last known-good
  const pendingRef = useRef({}); // key → ids awaiting (or mid-) save
  const timersRef = useRef({});
  const savedTimersRef = useRef({});

  useEffect(() => {
    if (!relations) return;
    const server = relationsToValue(relations);
    serverRef.current = server;
    // A refetch must not clobber a picker the admin is still editing.
    setValue((prev) => {
      const next = { ...server };
      Object.entries(pendingRef.current).forEach(([k, ids]) => {
        if (ids) next[k] = ids;
      });
      return { ...prev, ...next };
    });
  }, [relations]);

  const save = useCallback(
    async (key, ids) => {
      setSaveState((s) => ({ ...s, [key]: 'saving' }));
      try {
        await setRelations({ uid, body: { [RELATION_KEYS[key]]: ids } }).unwrap();
        serverRef.current = { ...serverRef.current, [key]: ids };
        delete pendingRef.current[key];
        setSaveState((s) => ({ ...s, [key]: 'saved' }));
        clearTimeout(savedTimersRef.current[key]);
        savedTimersRef.current[key] = setTimeout(
          () => setSaveState((s) => ({ ...s, [key]: undefined })),
          2000,
        );
      } catch (err) {
        // Silent endpoint — we own the messaging, and roll back to the server.
        delete pendingRef.current[key];
        setValue((v) => ({ ...v, [key]: serverRef.current[key] || [] }));
        setSaveState((s) => ({ ...s, [key]: undefined }));
        message.error(err?.message || 'Could not save — reverted.');
      }
    },
    [setRelations, uid, message],
  );

  const onPick = (key) => (ids) => {
    setValue((v) => ({ ...v, [key]: ids }));
    pendingRef.current[key] = ids;
    clearTimeout(timersRef.current[key]);
    timersRef.current[key] = setTimeout(() => save(key, ids), SAVE_DEBOUNCE_MS);
  };

  // Leaving the screen mid-debounce must not silently drop the edit.
  useEffect(
    () => () => {
      Object.values(timersRef.current).forEach(clearTimeout);
      Object.values(savedTimersRef.current).forEach(clearTimeout);
      Object.entries(pendingRef.current).forEach(([k, ids]) => {
        if (ids) setRelations({ uid, body: { [RELATION_KEYS[k]]: ids } });
      });
      pendingRef.current = {};
    },
    [setRelations, uid],
  );

  const industriesById = useMemo(
    () => new Map((industries || []).map((c) => [c.id, c])),
    [industries],
  );
  const scope = useMemo(
    () => industryScope(value.industries, industriesById),
    [value.industries, industriesById],
  );
  const scopedTags = useMemo(() => {
    const m = new Map();
    scope.forEach((c) =>
      (Array.isArray(c.Tags) ? c.Tags : []).forEach((t) => {
        if (!m.has(t.id)) m.set(t.id, t);
      }),
    );
    return m;
  }, [scope]);
  const tagsById = useMemo(() => new Map((tags || []).map((t) => [t.id, t])), [tags]);
  const hasIndustry = value.industries.length > 0;

  const tagOptions = useMemo(() => {
    // No industry yet → fall back to the full table: tags are required to
    // publish, and a design filed under a Category alone has no industry.
    if (!hasIndustry) return (tags || []).map((x) => ({ label: x.name, value: x.id }));
    const groups = [];
    if (scopedTags.size) {
      groups.push({
        label: `Tags of ${scope.map((c) => c.name).join(', ')}`,
        options: [...scopedTags.values()].map((t) => ({ label: t.name, value: t.id })),
      });
    }
    // Tags already on the design but outside its industries must stay listed —
    // an option-less value renders as a raw id and is dropped on the next edit.
    const strays = value.tags.filter((id) => !scopedTags.has(id));
    if (strays.length) {
      groups.push({
        label: 'On this design, but not on those industries',
        options: strays.map((id) => ({ label: tagsById.get(id)?.name || `#${id}`, value: id })),
      });
    }
    return groups;
  }, [hasIndustry, tags, scope, scopedTags, value.tags, tagsById]);

  const variantOptions = (variants || []).map((x) => ({ label: x.name, value: x.id }));
  const industryOptions = (industries || []).map((x) => ({ label: x.name, value: x.id }));

  // A new tag has to land on an industry to be reachable at signup, so creating
  // one needs write access to both tables — and a target industry.
  const canCreateTags = perms.can('tags', 'create') && perms.can('categories', 'update');
  const targetIndustryId = value.industries.includes(newTagIndustry)
    ? newTagIndustry
    : (value.industries[0] ?? null);
  const targetIndustry = industriesById.get(targetIndustryId);

  /**
   * PUT …/business-categories/:uid/tags is a FULL REPLACE, so the payload is the
   * industry's current tags plus this one — seeded from a fresh read, because
   * any tag missing from the array is deleted. Returns whether it got the tag.
   */
  const attachTagToIndustry = async (industry, tag) => {
    let row = industry;
    try {
      const fresh = await fetchIndustries(undefined, false).unwrap();
      row = (fresh || []).find((c) => c.id === industry.id) || row;
    } catch {
      // Fall back to the cached row — it carries Tags[] too.
    }
    if (!Array.isArray(row?.Tags)) {
      message.warning(
        `“${tag.name}” was not added to ${industry.name} — its current tags could not be read. Add it on the Industries page.`,
      );
      return false;
    }
    const ids = row.Tags.map((t) => t.id);
    if (ids.includes(tag.id)) return true;
    try {
      await setIndustryTags({ uid: row.uid, tag_ids: [...ids, tag.id] }).unwrap();
      return true;
    } catch (err) {
      message.error(
        `Could not add “${tag.name}” to ${industry.name}${err?.message ? `: ${err.message}` : '.'} It is still on this design.`,
      );
      return false;
    }
  };

  const addTag = async () => {
    const name = newTagName.trim();
    if (!name || !targetIndustry || addingTag) return;
    setAddingTag(true);
    try {
      // The picker is scoped, so a tag the admin can't see may still exist —
      // reuse it by name instead of POSTing a certain 409 duplicate.
      let tag = (tags || []).find((t) => t.name?.trim().toLowerCase() === name.toLowerCase());
      if (!tag) tag = await createTag({ name }).unwrap();

      const attached = await attachTagToIndustry(targetIndustry, tag);
      if (!value.tags.includes(tag.id)) onPick('tags')([...value.tags, tag.id]);
      setNewTagName('');
      if (attached) {
        message.success(`“${tag.name}” added to ${targetIndustry.name} and to this design`);
      }
    } catch {
      // Tag creation errors are surfaced by baseQuery.
    } finally {
      setAddingTag(false);
    }
  };

  const field = (label, key, options, { required, hint, footer, notFound } = {}) => (
    <div>
      <Space size={8}>
        <Text type="secondary">{label}</Text>
        {required && value[key].length === 0 && <Tag color="warning">required to publish</Tag>}
        {saveState[key] === 'saving' && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            <LoadingOutlined /> Saving…
          </Text>
        )}
        {saveState[key] === 'saved' && (
          <Text type="success" style={{ fontSize: 12 }}>
            <CheckOutlined /> Saved
          </Text>
        )}
      </Space>
      <Select
        mode="multiple"
        allowClear
        disabled={disabled}
        style={{ width: '100%', marginTop: 4 }}
        value={value[key]}
        onChange={onPick(key)}
        options={options}
        optionFilterProp="label"
        placeholder={`Select ${label.toLowerCase()}`}
        notFoundContent={notFound}
      />
      {hint && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {hint}
        </Text>
      )}
      {footer}
    </div>
  );

  const tagCreator =
    canCreateTags && !disabled ? (
      <div style={{ marginTop: 8 }}>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="New tag name"
            value={newTagName}
            disabled={!targetIndustry}
            onChange={(e) => setNewTagName(e.target.value)}
            onPressEnter={(e) => {
              e.preventDefault();
              addTag();
            }}
          />
          {value.industries.length > 1 && (
            <Select
              style={{ width: 220 }}
              value={targetIndustryId}
              onChange={setNewTagIndustry}
              optionFilterProp="label"
              options={value.industries.map((id) => ({
                label: industriesById.get(id)?.name || `#${id}`,
                value: id,
              }))}
            />
          )}
          <Button
            icon={<PlusOutlined />}
            loading={addingTag}
            disabled={!targetIndustry || !newTagName.trim()}
            onClick={addTag}
          >
            Add tag
          </Button>
        </Space.Compact>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {targetIndustry
            ? `Creates the tag if it is new, adds it to ${targetIndustry.name}’s tags, and puts it on this design.`
            : 'Pick an industry above to add a new tag.'}
        </Text>
      </div>
    ) : null;

  return (
    <Spin spinning={isFetching}>
      <Space direction="vertical" style={{ width: '100%' }} size={14}>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          Each picker saves itself as you select. These are shared by every version of the design.
        </Paragraph>
        {/* Industries first: it is what scopes the Tags picker below it. */}
        {field('Industries', 'industries', industryOptions, {
          hint: 'Category or at least one industry is required to publish. Industries also set which tags can be picked below.',
        })}
        {field('Tags', 'tags', tagOptions, {
          required: true,
          hint: !hasIndustry
            ? 'Showing every tag. Pick an industry above to narrow this to that industry’s tags.'
            : scope.length
              ? `Showing the tags of ${scope.map((c) => c.name).join(', ')} — the same set those users pick from.`
              : 'Loading the selected industries…',
          notFound: hasIndustry ? 'No tags on the selected industries yet' : undefined,
          footer: tagCreator,
        })}
        {field('Variants', 'variants', variantOptions)}
      </Space>
    </Spin>
  );
}
