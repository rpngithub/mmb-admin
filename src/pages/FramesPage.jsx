import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Typography,
  Space,
  Input,
  Button,
  Select,
  Tag,
  Tooltip,
  Popover,
  Alert,
  Checkbox,
  App,
} from 'antd';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PictureOutlined,
  HolderOutlined,
  CloudUploadOutlined,
  EyeInvisibleOutlined,
  MergeCellsOutlined,
} from '@ant-design/icons';
import { useAppDispatch } from '../app/hooks';
import {
  adminApi,
  useFramesListQuery,
  useFrameUpdateMutation,
  useFrameRemoveMutation,
  useFramesReorderMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import {
  FRAME_TYPE_OPTIONS,
  PREMIUM_OPTIONS,
  STATUS_COLORS,
  STATUS_OPTIONS,
  chipText,
  formatPrice,
  isTrue,
  rowReadiness,
  statusLabel,
  toAmount,
} from '../lib/frames';
import { TEXT_FREE_LABEL, languageLabel, num, sizeLabel } from '../lib/templateFamilies';
import ImageThumb from '../components/ImageThumb';
import { MergeFrameModal } from '../components/FrameMoveModals';

const { Title, Text } = Typography;

const SEARCH_DEBOUNCE_MS = 400;
const MAX_CHIPS = 3;

const EMPTY_FILTERS = {
  status: undefined,
  category_id: undefined,
  frame_type: undefined,
  is_premium: undefined,
  single_version: undefined,
};

/** Up to MAX_CHIPS tags, the rest folded into a "+n" with the full list on hover. */
function Chips({ items, color }) {
  if (!items.length) return null;
  const shown = items.slice(0, MAX_CHIPS);
  const rest = items.slice(MAX_CHIPS);
  return (
    <span>
      {shown.map((t) => (
        <Tag key={t} color={color} style={{ marginBottom: 2 }}>
          {t}
        </Tag>
      ))}
      {rest.length > 0 && (
        <Tooltip title={rest.join(', ')}>
          <Tag style={{ marginBottom: 2 }}>+{rest.length}</Tag>
        </Tooltip>
      )}
    </span>
  );
}

/** Language (or Text-free) and size chips + "live of total" versions. */
function CoverageCell({ row }) {
  const languages = (Array.isArray(row.languages) ? row.languages : [])
    .map((l) => chipText(l, languageLabel))
    .filter(Boolean);
  const sizes = (Array.isArray(row.sizes) ? row.sizes : [])
    .map((s) => chipText(s, sizeLabel))
    .filter(Boolean);
  const versions = num(row.version_count);
  const live = num(row.active_version_count);
  if (!versions) return <Text type="warning">No versions</Text>;
  return (
    <div style={{ maxWidth: 320 }}>
      <div>
        {isTrue(row.text_free) ? (
          <Tag color="purple">{TEXT_FREE_LABEL}</Tag>
        ) : (
          <Chips items={languages} color="blue" />
        )}
      </div>
      <div>
        <Chips items={sizes} />
      </div>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {live} of {versions} version{versions === 1 ? '' : 's'} live
      </Text>
    </div>
  );
}

function moveItem(arr, from, to) {
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function MissingThumb() {
  return (
    <Tooltip title="No thumbnail — open the frame and upload a version's bundle">
      <div
        style={{
          width: 40,
          height: 40,
          border: '1px dashed #d9d9d9',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#faad14',
        }}
      >
        <PictureOutlined />
      </div>
    </Tooltip>
  );
}

/**
 * Frames — the branded borders users browse in the Frames Store and keep on
 * their shelf ("My Frames").
 *
 * A frame is bought PER FRAME, for its own price: `is_premium` + `price` are the
 * entire access model, and no subscription plan unlocks one. That is why there
 * is no plan column, picker or filter anywhere on this screen.
 *
 * Drag-reorder is gated hard (see `dragEnabled`): PATCH /reorder rewrites
 * display_order to array position FOR THE SUBMITTED UIDS ONLY, so sending one
 * page — or a filtered view — hands those rows positions that collide with the
 * rows it left out.
 *
 * Each row is a frame FAMILY (versions per language × size). "Single-version
 * only" + Merge is the clean-up path for size copies that were uploaded as
 * separate frames.
 */
export default function FramesPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const perms = usePermissions();
  const { message, modal } = App.useApp();

  const canCreate = perms.can('frames', 'create');
  const canUpdate = perms.can('frames', 'update');
  const canDelete = perms.can('frames', 'delete');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [mergeFor, setMergeFor] = useState(null);
  const [statusUid, setStatusUid] = useState(null);
  const [reordering, setReordering] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  // Debounced name search — one request per pause, not per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data: categories } = adminApi.endpoints.frameCategoriesList.useQuery();

  const queryArg = useMemo(
    () => ({
      search: search || undefined,
      status: filters.status,
      category_id: filters.category_id,
      frame_type: filters.frame_type,
      is_premium: filters.is_premium,
      // 1 or omitted — never 0.
      single_version: filters.single_version ? 1 : undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    [search, filters, page, pageSize],
  );

  const { data, isLoading, isFetching, refetch } = useFramesListQuery(queryArg);
  const [updateFrame] = useFrameUpdateMutation();
  const [removeFrame] = useFrameRemoveMutation();
  const [reorder] = useFramesReorderMutation();

  // Rows arrive ordered by display_order ascending, then newest first — never
  // re-sorted here, so what you drag is what the store shows.
  const rows = data?.items || [];
  const total = data?.total || 0;

  const filtersActive = Boolean(search) || Object.values(filters).some((v) => v !== undefined);
  const showsEveryFrame = rows.length === total;
  const dragEnabled = canUpdate && !reordering && !filtersActive && showsEveryFrame;

  const dragBlockedReason = !canUpdate
    ? 'You need the frames “update” permission to reorder.'
    : filtersActive
      ? 'Clear the search and filters first — reordering rewrites the order of the whole list, so it needs every frame on screen.'
      : !showsEveryFrame
        ? `Showing ${rows.length} of ${total}. Reordering needs every frame on one page — raise the page size (100 is the API maximum).`
        : null;

  const setFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const resetDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const handleDrop = async (index) => {
    if (dragIndex == null || dragIndex === index) {
      resetDrag();
      return;
    }
    const nextRows = moveItem(rows, dragIndex, index);
    resetDrag();

    // Optimistic patch: the server assigns display_order by array position, so
    // mirror both the order and the numbers.
    const patch = dispatch(
      adminApi.util.updateQueryData('framesList', queryArg, (draft) => {
        draft.items = nextRows.map((r, i) => ({
          ...(draft.items.find((d) => d.uid === r.uid) || r),
          display_order: i,
        }));
      }),
    );
    setReordering(true);
    try {
      // uids, not numeric ids — one unknown id rejects the whole batch.
      await reorder(nextRows.map((r) => r.uid)).unwrap();
    } catch (err) {
      patch.undo();
      message.error(err?.message || 'Failed to save the new order — reverted.');
      refetch();
    } finally {
      setReordering(false);
    }
  };

  const changeStatus = (record, next) => {
    const publishing = next === 'active';
    modal.confirm({
      title: publishing ? `Publish "${record.name}"?` : `Retire "${record.name}"?`,
      content: publishing
        ? 'It goes live in the Frames Store straight away.'
        : 'It disappears from the store. Everyone who already added or bought it keeps it — retiring takes nothing away.',
      okText: publishing ? 'Publish' : 'Retire',
      onOk: async () => {
        setStatusUid(record.uid);
        try {
          await updateFrame({ uid: record.uid, body: { status: next } }).unwrap();
          message.success(publishing ? 'Published to the store' : 'Retired from the store');
        } catch (err) {
          // Only the transition INTO active is gated; its 400 names each unmet
          // requirement, so show those rather than a bare "request failed".
          const details = Array.isArray(err?.details) ? err.details : [];
          message.error(
            [err?.message, details.map((d) => d.message).join(' ')].filter(Boolean).join(' — ') ||
              'Could not change the status.',
          );
        } finally {
          setStatusUid(null);
        }
      },
    });
  };

  const onDelete = (record) => {
    modal.confirm({
      title: `Delete "${record.name}"?`,
      content:
        'Hard delete of the frame and every one of its versions — it cannot be undone. If anyone owns this frame the database will refuse — retire it instead.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeFrame(record.uid).unwrap();
          message.success('Frame deleted');
        } catch (err) {
          if (err?.status === 409) {
            modal.info({
              title: 'Someone already owns this frame',
              content:
                'It can’t be deleted — that is deliberate, so nobody loses something they paid for. Retire it instead: set it to Inactive and it leaves the store while existing owners keep it.',
              okText: 'Got it',
            });
            return;
          }
          message.error(err?.message || 'Could not delete the frame.');
        }
      },
    });
  };

  const columns = [
    {
      title: '',
      key: 'drag',
      width: 40,
      render: () => (
        <Tooltip title={dragEnabled ? 'Drag to reorder' : dragBlockedReason}>
          <HolderOutlined
            style={{
              color: dragEnabled ? '#999' : '#d9d9d9',
              cursor: dragEnabled ? 'grab' : 'not-allowed',
            }}
          />
        </Tooltip>
      ),
    },
    {
      title: 'Thumb',
      dataIndex: 'thumbnail_s3_key',
      key: 'thumb',
      width: 70,
      render: (k) => <ImageThumb k={k} size={40} placeholder={<MissingThumb />} />,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (v, r) => (
        <Button type="link" style={{ padding: 0, fontWeight: 600 }} onClick={() => navigate(`/frames/${r.uid}`)}>
          {v}
        </Button>
      ),
    },
    {
      title: 'Category',
      key: 'category',
      width: 150,
      render: (_v, r) =>
        r.FrameCategory?.name ? (
          <Tag>{r.FrameCategory.name}</Tag>
        ) : (
          <Tooltip title="Uncategorised frames are unreachable in the store, which browses by category.">
            <Text type="secondary">—</Text>
          </Tooltip>
        ),
    },
    {
      title: 'Type',
      dataIndex: 'frame_type',
      key: 'frame_type',
      width: 100,
      render: (v) => (v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text>),
    },
    {
      title: 'Price',
      key: 'price',
      width: 160,
      render: (_v, r) => {
        if (!isTrue(r.is_premium)) return <Tag color="green">Free</Tag>;
        const strike = toAmount(r.strike_price);
        return (
          <Space size={6}>
            <Text strong>{formatPrice(r.price)}</Text>
            {strike !== null && strike > 0 && (
              <Tooltip title="Display only — nothing is charged against this figure.">
                <Text type="secondary" delete>
                  {formatPrice(strike)}
                </Text>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Versions',
      key: 'coverage',
      render: (_v, r) => <CoverageCell row={r} />,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (v) => <Tag color={STATUS_COLORS[v] || 'default'}>{statusLabel(v)}</Tag>,
    },
    {
      title: 'Readiness',
      key: 'readiness',
      width: 130,
      render: (_v, record) => {
        const { ready, missing } = rowReadiness(record);
        if (ready) return <Tag color="green">Ready</Tag>;
        return (
          <Popover
            title="Still needed before publishing"
            content={
              <ul style={{ margin: 0, paddingLeft: 18, maxWidth: 320 }}>
                {missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            }
          >
            <Tag color="warning">Incomplete ({missing.length})</Tag>
          </Popover>
        );
      },
    },
  ];

  if (canUpdate || canDelete) {
    columns.push({
      title: 'Actions',
      key: 'actions',
      width: 170,
      fixed: 'right',
      render: (_v, record) => {
        const { ready, missing } = rowReadiness(record);
        return (
          <Space size="small">
            {canUpdate && (
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => navigate(`/frames/${record.uid}`)}
                title="Edit"
              />
            )}
            {canUpdate &&
              (record.status === 'active' ? (
                <Tooltip title="Retire — pull it from the store (owners keep it)">
                  <Button
                    size="small"
                    icon={<EyeInvisibleOutlined />}
                    loading={statusUid === record.uid}
                    onClick={() => changeStatus(record, 'inactive')}
                  />
                </Tooltip>
              ) : (
                <Tooltip
                  title={ready ? 'Publish to the store' : `Incomplete: ${missing.join(' ')}`}
                >
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    icon={<CloudUploadOutlined />}
                    disabled={!ready}
                    loading={statusUid === record.uid}
                    onClick={() => changeStatus(record, 'active')}
                  />
                </Tooltip>
              ))}
            {canUpdate && (
              <Tooltip title="Merge into another frame — e.g. the same design in another size">
                <Button
                  size="small"
                  icon={<MergeCellsOutlined />}
                  onClick={() => setMergeFor(record)}
                />
              </Tooltip>
            )}
            {canDelete && (
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => onDelete(record)}
                title="Delete"
              />
            )}
          </Space>
        );
      },
    });
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
          Frames
        </Title>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching || reordering}>
            Reload
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/frames/new')}
            >
              New Frame
            </Button>
          )}
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Frames are bought one at a time, for their own price — no subscription plan unlocks one."
        description={
          dragEnabled
            ? 'Drag the rows to set the order the store shows them in — each change saves automatically.'
            : dragBlockedReason
        }
      />

      <Alert
        type="warning"
        showIcon
        closable
        style={{ marginBottom: 16 }}
        message="Frames now have versions — one per language and size"
        description="Every existing frame was migrated to ONE text-free version in the default size. If a frame’s text is in a language, open it and use the version’s “Change language / size…”. Size copies uploaded as separate frames: tick “Single-version only” and merge each into its main frame."
      />

      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          placeholder="Search name"
          style={{ width: 220 }}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <Select
          allowClear
          placeholder="Status"
          style={{ width: 140 }}
          value={filters.status}
          onChange={(v) => setFilter('status', v)}
          options={STATUS_OPTIONS}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Category"
          style={{ width: 180 }}
          value={filters.category_id}
          onChange={(v) => setFilter('category_id', v)}
          options={(categories || []).map((c) => ({ label: c.name, value: c.id }))}
        />
        <Select
          allowClear
          placeholder="Type"
          style={{ width: 140 }}
          value={filters.frame_type}
          onChange={(v) => setFilter('frame_type', v)}
          options={FRAME_TYPE_OPTIONS}
        />
        <Select
          allowClear
          placeholder="Pricing"
          style={{ width: 140 }}
          value={filters.is_premium}
          onChange={(v) => setFilter('is_premium', v)}
          options={PREMIUM_OPTIONS}
        />
        <Tooltip title="Frames with exactly one version — size copies to merge are usually here.">
          <Checkbox
            checked={Boolean(filters.single_version)}
            onChange={(e) => setFilter('single_version', e.target.checked || undefined)}
          >
            Single-version only
          </Checkbox>
        </Tooltip>
      </Space>

      <Table
        rowKey="uid"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        scroll={{ x: 'max-content' }}
        size="middle"
        locale={{
          emptyText: filtersActive
            ? 'No frames match.'
            : 'No frames yet — create one, upload an English or text-free version’s bundle, then publish it.',
        }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          // 100 is the API's maximum `limit`.
          pageSizeOptions: [20, 30, 50, 100],
          showTotal: (t) => `${t} total`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
        onRow={(_record, index) => ({
          draggable: dragEnabled,
          onDragStart: (e) => {
            setDragIndex(index);
            e.dataTransfer.effectAllowed = 'move';
            // Firefox requires data to be set for a drag to start.
            e.dataTransfer.setData('text/plain', String(index));
          },
          onDragOver: (e) => {
            if (!dragEnabled || dragIndex == null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (overIndex !== index) setOverIndex(index);
          },
          onDrop: (e) => {
            e.preventDefault();
            handleDrop(index);
          },
          onDragEnd: resetDrag,
          style: {
            cursor: dragEnabled ? 'grab' : 'default',
            opacity: dragIndex === index ? 0.5 : 1,
            boxShadow:
              overIndex === index && dragIndex != null && dragIndex !== index
                ? 'inset 0 2px 0 #1677ff'
                : undefined,
          },
        })}
      />

      <MergeFrameModal
        open={Boolean(mergeFor)}
        frame={mergeFor}
        onClose={() => setMergeFor(null)}
        onMerged={() => setMergeFor(null)}
      />
    </div>
  );
}
