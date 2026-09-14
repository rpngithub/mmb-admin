import { useEffect, useMemo, useState } from 'react';
import {
  Typography,
  Space,
  Button,
  Select,
  Alert,
  Spin,
  Empty,
  Card,
  Row,
  Col,
  Drawer,
  Grid,
  Divider,
  App,
} from 'antd';
import { ReloadOutlined, PlusOutlined, CopyOutlined, EyeOutlined } from '@ant-design/icons';
import { useAppDispatch } from '../app/hooks';
import {
  adminApi,
  useBusinessCategoriesFilteredQuery,
  usePageSectionsListQuery,
  usePageSectionsPreviewQuery,
  usePageSectionCreateMutation,
  usePageSectionUpdateMutation,
  usePageSectionRemoveMutation,
  usePageSectionsReorderMutation,
  usePageSectionsCloneMutation,
  usePageSectionItemRemoveMutation,
  usePageSectionItemsReorderMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import SortableList from '../components/SortableList';
import PageSectionCard from '../components/PageSectionCard';
import PageContentPreview from '../components/PageContentPreview';
import PageSectionEditorModal from '../components/PageSectionEditorModal';
import PageSectionItemEditorModal from '../components/PageSectionItemEditorModal';
import {
  PAGE_KEY,
  isTrue,
  orderCmp,
  sectionItems,
  previewSections,
  isBlankOverride,
  errorText,
} from '../lib/pageContent';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

const DEFAULT_SCOPE = 'default';

// Query args, spelled out once so the optimistic cache patches hit the same
// cache entries the hooks read from.
const defaultsArgs = () => ({ page_key: PAGE_KEY, business_category_id: 'null' });
const overridesArgs = (industryId) => ({ page_key: PAGE_KEY, industry_id: industryId });
const previewArgs = (industryId) => ({ page_key: PAGE_KEY, industry_id: industryId });

/**
 * Page Content — the marketing copy BELOW the template grid on each industry's
 * website page. One screen, an industry picker at the top:
 *
 *   Mode A  "Default (all industries)"  the shared defaults; every industry
 *           that hasn't made its own copy of a block shows what is written here.
 *   Mode B  an industry                 the page as the website resolves it —
 *           inherited blocks read-only, custom blocks editable, hidden blocks
 *           listed at the bottom.
 *
 * Resolution is per block. The four operations that are not plain CRUD —
 * customise (clone), revert (delete the override), hide an inherited block
 * (create a switched-off override), show again (delete a hide-only override,
 * or re-enable a real copy) — live here; the cards only raise them.
 */
export default function PageContentPage() {
  const dispatch = useAppDispatch();
  const perms = usePermissions();
  const { message, modal } = App.useApp();
  const screens = useBreakpoint();
  const wide = screens.lg;

  const canCreate = perms.can('page_content', 'create');
  const canUpdate = perms.can('page_content', 'update');
  const canDelete = perms.can('page_content', 'delete');

  const [scope, setScope] = useState(DEFAULT_SCOPE);
  const isDefaultMode = scope === DEFAULT_SCOPE;
  const industryId = isDefaultMode ? null : scope;

  const [previewIndustryId, setPreviewIndustryId] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sectionEditor, setSectionEditor] = useState({ open: false, record: null });
  const [itemEditor, setItemEditor] = useState({ open: false, record: null, section: null });
  const [busyUid, setBusyUid] = useState(null);
  const [reordering, setReordering] = useState(false);
  const [cloningAll, setCloningAll] = useState(false);

  // ---- data -------------------------------------------------------------
  const { data: industriesRaw = [], isLoading: industriesLoading } =
    useBusinessCategoriesFilteredQuery({ is_active: 1 });
  const industries = useMemo(
    () =>
      [...industriesRaw].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [industriesRaw],
  );
  const industry = industries.find((i) => i.id === industryId) || null;
  const industryName = industry?.name || 'this industry';

  // Every row, unscoped — only for the "N custom" hints in the picker.
  const { data: allRows = [] } = usePageSectionsListQuery({ page_key: PAGE_KEY });
  const customCounts = useMemo(() => {
    const m = new Map();
    for (const r of allRows) {
      if (r.business_category_id == null) continue;
      m.set(r.business_category_id, (m.get(r.business_category_id) || 0) + 1);
    }
    return m;
  }, [allRows]);

  // Mode A
  const {
    data: defaultsRaw = [],
    isLoading: defaultsLoading,
    isFetching: defaultsFetching,
    error: defaultsError,
  } = usePageSectionsListQuery(defaultsArgs(), { skip: !isDefaultMode });
  const defaults = useMemo(() => [...defaultsRaw].sort(orderCmp), [defaultsRaw]);

  // Mode B: the resolved page (drives the card states) + the raw overrides (the
  // custom cards' editable text, and the hidden rows the preview drops).
  const {
    data: previewData,
    isLoading: previewLoading,
    isFetching: previewFetching,
    error: previewError,
  } = usePageSectionsPreviewQuery(previewArgs(industryId), { skip: isDefaultMode });
  const { data: overridesRaw = [], isFetching: overridesFetching } = usePageSectionsListQuery(
    overridesArgs(industryId),
    { skip: isDefaultMode },
  );

  const { cards, hiddenRows } = useMemo(() => {
    if (isDefaultMode) return { cards: [], hiddenRows: [] };
    const resolved = previewSections(previewData);
    const overrideByKey = new Map(overridesRaw.map((r) => [r.section_key, r]));
    const cards = resolved.map((p) =>
      p.inherited
        ? { state: 'inherited', section: p, key: `inherited:${p.section_key}` }
        : // Raw row for the editable copy (tokens intact); the preview row is
          // only a fallback until the overrides list has caught up.
          {
            state: 'custom',
            section: overrideByKey.get(p.section_key) || p,
            key: `custom:${p.section_key}`,
          },
    );
    const shown = new Set(resolved.map((p) => p.section_key));
    const hiddenRows = overridesRaw
      .filter((r) => !isTrue(r.is_active) && !shown.has(r.section_key))
      .sort(orderCmp);
    return { cards, hiddenRows };
  }, [isDefaultMode, previewData, overridesRaw]);

  const inheritedKeys = cards.filter((c) => c.state === 'inherited').map((c) => c.section.section_key);

  // The Mode A preview defaults to the first industry.
  useEffect(() => {
    if (previewIndustryId == null && industries.length > 0) setPreviewIndustryId(industries[0].id);
  }, [industries, previewIndustryId]);

  // ---- mutations --------------------------------------------------------
  const [createSection] = usePageSectionCreateMutation();
  const [updateSection] = usePageSectionUpdateMutation();
  const [removeSection] = usePageSectionRemoveMutation();
  const [reorderSections] = usePageSectionsReorderMutation();
  const [cloneSections] = usePageSectionsCloneMutation();
  const [removeItem] = usePageSectionItemRemoveMutation();
  const [reorderItems] = usePageSectionItemsReorderMutation();

  const refetchAll = () =>
    dispatch(adminApi.util.invalidateTags([{ type: 'PageSections', id: 'LIST' }]));

  // A 409 only happens on a stale view — say so and refresh.
  const fail = (err, fallback) => {
    if (err?.status === 409) {
      message.warning(`${errorText(err, fallback)} — the view was out of date and has been refreshed.`);
      refetchAll();
    } else {
      message.error(errorText(err, fallback));
    }
  };

  const run = async (uid, fn, fallback) => {
    setBusyUid(uid);
    try {
      await fn();
    } catch (err) {
      fail(err, fallback);
    } finally {
      setBusyUid(null);
    }
  };

  // ---- reorder (sections) -------------------------------------------------
  const handleSectionsReorder = async (nextRows) => {
    let ids;
    let patch;
    if (isDefaultMode) {
      ids = nextRows.map((r) => r.uid);
      patch = dispatch(
        adminApi.util.updateQueryData('pageSectionsList', defaultsArgs(), (draft) => {
          nextRows.forEach((r, i) => {
            const row = draft.find((d) => d.uid === r.uid);
            if (row) row.display_order = i;
          });
        }),
      );
    } else {
      // ONLY the custom sections' uids; inherited blocks keep the default's order.
      ids = nextRows.filter((c) => c.state === 'custom').map((c) => c.section.uid);
      if (ids.length === 0) return;
      const keys = nextRows.map((c) => c.section.section_key);
      patch = dispatch(
        adminApi.util.updateQueryData('pageSectionsPreview', previewArgs(industryId), (draft) => {
          const arr = Array.isArray(draft) ? draft : draft?.sections;
          if (!Array.isArray(arr)) return;
          const ordered = keys.map((k) => arr.find((s) => s.section_key === k)).filter(Boolean);
          if (ordered.length === arr.length) arr.splice(0, arr.length, ...ordered);
        }),
      );
    }
    setReordering(true);
    try {
      await reorderSections(ids).unwrap();
    } catch (err) {
      patch?.undo();
      message.error(errorText(err, 'Failed to save the new order — reverted.'));
      refetchAll();
    } finally {
      setReordering(false);
    }
  };

  // ---- reorder (items within one editable section) -------------------------
  const handleItemsReorder = async (section, nextItems) => {
    const ids = nextItems.map((it) => it.uid);
    const args = isDefaultMode ? defaultsArgs() : overridesArgs(industryId);
    const patch = dispatch(
      adminApi.util.updateQueryData('pageSectionsList', args, (draft) => {
        const row = draft.find((d) => d.uid === section.uid);
        if (!row || !Array.isArray(row.items)) return;
        nextItems.forEach((it, i) => {
          const item = row.items.find((x) => x.uid === it.uid);
          if (item) item.display_order = i;
        });
      }),
    );
    setReordering(true);
    try {
      await reorderItems(ids).unwrap();
    } catch (err) {
      patch.undo();
      message.error(errorText(err, 'Failed to save the new item order — reverted.'));
      refetchAll();
    } finally {
      setReordering(false);
    }
  };

  // ---- Mode A actions -------------------------------------------------------
  const hideDefault = (section) => {
    modal.confirm({
      title: `Hide “${section.heading || section.section_key}”?`,
      content:
        "This block will stop showing on every industry page that hasn't customised it. Industries with their own copy are unaffected.",
      okText: 'Hide',
      onOk: () =>
        run(
          section.uid,
          async () => {
            await updateSection({ uid: section.uid, body: { is_active: 0 } }).unwrap();
            message.success('Block hidden on every inheriting page');
          },
          'Could not hide the block.',
        ),
    });
  };

  const showDefault = (section) =>
    run(
      section.uid,
      async () => {
        await updateSection({ uid: section.uid, body: { is_active: 1 } }).unwrap();
        message.success('Block is showing again');
      },
      'Could not show the block.',
    );

  const deleteDefault = (section) => {
    const n = sectionItems(section).length;
    modal.confirm({
      title: `Delete “${section.heading || section.section_key}” from the shared defaults?`,
      content: `Every industry that inherits this block loses it; industries with their own copy are unaffected. Its ${n} item${n === 1 ? '' : 's'} will be deleted too. This cannot be undone.`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () =>
        run(
          section.uid,
          async () => {
            await removeSection(section.uid).unwrap();
            message.success('Block deleted');
          },
          'Could not delete the block.',
        ),
    });
  };

  // ---- Mode B actions -------------------------------------------------------
  const customise = (section) =>
    run(
      section.uid,
      async () => {
        await cloneSections({
          page_key: PAGE_KEY,
          business_category_id: industryId,
          section_keys: [section.section_key],
        }).unwrap();
        message.success(`${industryName} now has its own copy of this block`);
      },
      'Could not customise the block.',
    );

  const customiseAll = async () => {
    setCloningAll(true);
    try {
      await cloneSections({ page_key: PAGE_KEY, business_category_id: industryId }).unwrap();
      message.success(`${industryName} now has its own copy of every block`);
    } catch (err) {
      fail(err, 'Could not customise the blocks.');
    } finally {
      setCloningAll(false);
    }
  };

  const hideInherited = (section) => {
    modal.confirm({
      title: `Hide “${section.heading || section.section_key}” on ${industryName}?`,
      content: `This block will stop showing on ${industryName} only. Every other industry is unaffected.`,
      okText: 'Hide on this page',
      onOk: () =>
        run(
          section.uid,
          async () => {
            // No hide endpoint: an override that is switched off tells the
            // resolver "suppress the default here" — key + is_active 0, nothing else.
            await createSection({
              page_key: PAGE_KEY,
              business_category_id: industryId,
              section_key: section.section_key,
              is_active: 0,
            }).unwrap();
            message.success(`Hidden on ${industryName}`);
          },
          'Could not hide the block.',
        ),
    });
  };

  const hideCustom = (section) =>
    run(
      section.uid,
      async () => {
        await updateSection({ uid: section.uid, body: { is_active: 0 } }).unwrap();
        message.success(`Hidden on ${industryName}`);
      },
      'Could not hide the block.',
    );

  const revert = (section) => {
    const n = sectionItems(section).length;
    modal.confirm({
      title: `Revert “${section.heading || section.section_key}” to the default?`,
      content: `${industryName} will go back to showing the shared default for this block. Its ${n} custom item${n === 1 ? '' : 's'} will be deleted. This cannot be undone.`,
      okText: 'Revert to default',
      okButtonProps: { danger: true },
      onOk: () =>
        run(
          section.uid,
          async () => {
            await removeSection(section.uid).unwrap();
            message.success('Reverted to the shared default');
          },
          'Could not revert the block.',
        ),
    });
  };

  // A hide-only row is DELETED so inheritance resumes (PATCHing it live would
  // publish an empty block); a switched-off real copy comes back with a PATCH.
  const showAgain = (row) =>
    run(
      row.uid,
      async () => {
        if (isBlankOverride(row)) await removeSection(row.uid).unwrap();
        else await updateSection({ uid: row.uid, body: { is_active: 1 } }).unwrap();
        message.success(`Showing again on ${industryName}`);
      },
      'Could not show the block.',
    );

  const deleteItem = (section, item) =>
    run(
      section.uid,
      async () => {
        await removeItem(item.uid).unwrap();
        message.success('Item deleted');
      },
      'Could not delete the item.',
    );

  // ---- picker options -------------------------------------------------------
  const scopeOptions = useMemo(
    () => [
      { value: DEFAULT_SCOPE, name: 'Default (all industries)', label: <Text strong>Default (all industries)</Text> },
      ...industries.map((i) => {
        const n = customCounts.get(i.id) || 0;
        return {
          value: i.id,
          name: i.name,
          label: (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span>{i.name}</span>
              {n > 0 && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {n} custom
                </Text>
              )}
            </div>
          ),
        };
      }),
    ],
    [industries, customCounts],
  );

  const cardPerms = { canCreate, canUpdate, canDelete };
  const loading = isDefaultMode ? defaultsLoading : previewLoading;
  const fetching = isDefaultMode ? defaultsFetching : previewFetching || overridesFetching;
  const loadError = isDefaultMode ? defaultsError : previewError;

  // ---- render helpers -------------------------------------------------------
  const openSectionEditor = (record) => setSectionEditor({ open: true, record });
  const openItemEditor = (section, record) => setItemEditor({ open: true, record, section });

  const cardCommon = (section, extra) => ({
    industryName,
    perms: cardPerms,
    busy: busyUid === section.uid,
    itemsBusy: reordering,
    onEdit: () => openSectionEditor(section),
    onAddItem: () => openItemEditor(section, null),
    onEditItem: (item) => openItemEditor(section, item),
    onDeleteItem: (item) => deleteItem(section, item),
    onReorderItems: (next) => handleItemsReorder(section, next),
    ...extra,
  });

  const previewPane = (
    <PageContentPreview
      industryId={isDefaultMode ? previewIndustryId : industryId}
      industries={industries}
      locked={!isDefaultMode}
      onChange={setPreviewIndustryId}
    />
  );

  let body;
  if (loadError) {
    body = (
      <Alert
        type="error"
        showIcon
        message="Failed to load the page content"
        description="Please reload and try again."
      />
    );
  } else if (loading || industriesLoading) {
    body = (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin />
      </div>
    );
  } else if (isDefaultMode) {
    body =
      defaults.length === 0 ? (
        <Empty
          description={
            <Space direction="vertical" size={4}>
              <Text>No default blocks yet.</Text>
              <Text type="secondary">
                Create <Text code>why_choose</Text>, <Text code>content_ideas</Text> and{' '}
                <Text code>business_growth</Text> and fill their items. Until then every industry
                page shows nothing below the template grid.
              </Text>
            </Space>
          }
        >
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openSectionEditor(null)}>
              Add section
            </Button>
          )}
        </Empty>
      ) : (
        <SortableList
          items={defaults}
          disabled={!canUpdate || reordering}
          onReorder={handleSectionsReorder}
          gap={12}
          renderRow={(section, { handle }) => (
            <PageSectionCard
              section={section}
              state="default"
              handle={handle}
              {...cardCommon(section, {
                onHide: () => hideDefault(section),
                onShow: () => showDefault(section),
                onDelete: () => deleteDefault(section),
              })}
            />
          )}
        />
      );
  } else {
    body =
      cards.length === 0 && hiddenRows.length === 0 ? (
        <Empty
          description={
            <Space direction="vertical" size={4}>
              <Text>Nothing has been authored for this page yet.</Text>
              <Text type="secondary">
                The shared defaults are empty — add them under “Default (all industries)” and
                they will show here.
              </Text>
            </Space>
          }
        />
      ) : (
        <>
          <SortableList
            items={cards}
            rowKey={(c) => c.key}
            disabled={!canUpdate || reordering}
            canDrag={(c) => c.state === 'custom'}
            onReorder={handleSectionsReorder}
            gap={12}
            renderRow={(c, { handle }) => (
              <PageSectionCard
                section={c.section}
                state={c.state}
                handle={handle}
                {...cardCommon(c.section, {
                  onCustomise: () => customise(c.section),
                  onHide: () =>
                    c.state === 'inherited' ? hideInherited(c.section) : hideCustom(c.section),
                  onRevert: () => revert(c.section),
                })}
              />
            )}
          />
          {hiddenRows.length > 0 && (
            <>
              <Divider plain style={{ margin: '20px 0 12px' }}>
                <Text type="secondary">Hidden on this page</Text>
              </Divider>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {hiddenRows.map((row) => (
                  <PageSectionCard
                    key={row.uid}
                    section={row}
                    state="hidden"
                    industryName={industryName}
                    perms={{
                      ...cardPerms,
                      canShowAgain: isBlankOverride(row) ? canDelete : canUpdate,
                    }}
                    busy={busyUid === row.uid}
                    onShow={() => showAgain(row)}
                  />
                ))}
              </Space>
            </>
          )}
        </>
      );
  }

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
          Page Content
        </Title>
        <Space wrap>
          {!wide && (
            <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>
              Preview
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={refetchAll} loading={fetching || reordering}>
            Reload
          </Button>
          {!isDefaultMode && canCreate && (
            <Button
              icon={<CopyOutlined />}
              onClick={customiseAll}
              loading={cloningAll}
              disabled={inheritedKeys.length === 0}
              title={
                inheritedKeys.length === 0
                  ? 'Every block on this page is already customised'
                  : undefined
              }
            >
              Customise all blocks
            </Button>
          )}
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openSectionEditor(null)}>
              Add section
            </Button>
          )}
        </Space>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Text strong>Industry:</Text>
        <Select
          showSearch
          style={{ width: 'min(100%, 440px)' }}
          value={scope}
          onChange={setScope}
          options={scopeOptions}
          optionLabelProp="name"
          loading={industriesLoading}
          filterOption={(input, option) =>
            String(option?.name || '')
              .toLowerCase()
              .includes((input || '').toLowerCase())
          }
        />
      </div>

      <Row gutter={16}>
        <Col xs={24} lg={15}>
          {isDefaultMode ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="You are editing the shared defaults."
              description="Every industry that hasn't made its own copy of a block shows what you write here."
            />
          ) : (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={`You are editing ${industryName}’s page.`}
              description="Grey blocks are inherited from the shared defaults and shown as the website renders them. Customise one to give this industry its own copy, or hide it on this page only."
            />
          )}
          {body}
        </Col>
        {wide && (
          <Col lg={9}>
            <Card
              size="small"
              title="Preview"
              extra={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  as the website renders it
                </Text>
              }
              style={{ position: 'sticky', top: 80 }}
              styles={{ body: { maxHeight: 'calc(100vh - 160px)', overflow: 'auto' } }}
            >
              {previewPane}
            </Card>
          </Col>
        )}
      </Row>

      {!wide && (
        <Drawer
          title="Preview"
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          width={Math.min(window.innerWidth, 480)}
        >
          {previewPane}
        </Drawer>
      )}

      <PageSectionEditorModal
        open={sectionEditor.open}
        record={sectionEditor.record}
        scope={{ businessCategoryId: industryId, industryName }}
        onClose={() => setSectionEditor({ open: false, record: null })}
      />
      <PageSectionItemEditorModal
        open={itemEditor.open}
        record={itemEditor.record}
        sectionId={itemEditor.section?.id}
        sectionLabel={itemEditor.section?.heading || itemEditor.section?.section_key}
        onClose={() => setItemEditor({ open: false, record: null, section: null })}
      />
    </div>
  );
}
