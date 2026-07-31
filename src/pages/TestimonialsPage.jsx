import { useMemo, useState } from 'react';
import {
  Typography,
  Space,
  Button,
  Card,
  Row,
  Col,
  Avatar,
  Rate,
  Tag,
  Popconfirm,
  Empty,
  Spin,
  Alert,
  App,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useAppDispatch } from '../app/hooks';
import {
  adminApi,
  useTestimonialReorderMutation,
  useTestimonialDeleteMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import { useCdnBaseUrl, imageUrl } from '../lib/cdn';
import TestimonialEditorDrawer from './TestimonialEditorDrawer';

const { Title, Text, Paragraph } = Typography;

const orderCmp = (a, b) =>
  (a.display_order ?? 0) - (b.display_order ?? 0) ||
  String(a.name || '').localeCompare(String(b.name || ''));

function initials(name) {
  if (!name) return '';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');
}

export default function TestimonialsPage() {
  const dispatch = useAppDispatch();
  const perms = usePermissions();
  const { message } = App.useApp();
  const cdnBase = useCdnBaseUrl();

  const canCreate = perms.can('testimonials', 'create');
  const canUpdate = perms.can('testimonials', 'update');
  const canDelete = perms.can('testimonials', 'delete');

  const {
    data: testimonials = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = adminApi.endpoints.testimonialsList.useQuery();

  const [reorder] = useTestimonialReorderMutation();
  const [deleteTestimonial] = useTestimonialDeleteMutation();

  const [editor, setEditor] = useState({ open: false, testimonial: null });

  const rows = useMemo(() => [...testimonials].sort(orderCmp), [testimonials]);

  const handleReorder = async (index, dir) => {
    const target = dir === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];

    const changed = [];
    next.forEach((item, i) => {
      if ((item.display_order ?? 0) !== i) changed.push({ uid: item.uid, display_order: i });
    });
    if (!changed.length) return;

    const patch = dispatch(
      adminApi.util.updateQueryData('testimonialsList', undefined, (draft) => {
        for (const ch of changed) {
          const row = draft.find((r) => r.uid === ch.uid);
          if (row) row.display_order = ch.display_order;
        }
      }),
    );
    try {
      await Promise.all(
        changed.map((ch) =>
          reorder({ uid: ch.uid, body: { display_order: ch.display_order } }).unwrap(),
        ),
      );
    } catch (err) {
      patch.undo();
      message.error(err?.message || 'Failed to reorder — reverted.');
      refetch();
    }
  };

  const handleDelete = async (record) => {
    try {
      await deleteTestimonial(record.uid).unwrap();
      message.success('Testimonial deleted');
    } catch (err) {
      if (err?.status === 404) refetch();
      message.error(err?.message || 'Failed to delete testimonial.');
    }
  };

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
          Testimonials
        </Title>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching}>
            Reload
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setEditor({ open: true, testimonial: null })}
            >
              New Testimonial
            </Button>
          )}
        </Space>
      </div>

      {error ? (
        <Alert
          type="error"
          showIcon
          message="Failed to load testimonials"
          description="Please reload and try again."
        />
      ) : isLoading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
        </div>
      ) : rows.length === 0 ? (
        <Empty description="No testimonials yet" />
      ) : (
        <Row gutter={[16, 16]}>
          {rows.map((t, index) => {
            const photo = imageUrl(cdnBase, t.photo_s3_key);
            const actions = [];
            if (canUpdate) {
              actions.push(
                <ArrowUpOutlined
                  key="up"
                  style={index === 0 ? { color: '#ccc', cursor: 'not-allowed' } : undefined}
                  onClick={() => index !== 0 && handleReorder(index, 'up')}
                />,
                <ArrowDownOutlined
                  key="down"
                  style={
                    index === rows.length - 1
                      ? { color: '#ccc', cursor: 'not-allowed' }
                      : undefined
                  }
                  onClick={() => index !== rows.length - 1 && handleReorder(index, 'down')}
                />,
                <EditOutlined
                  key="edit"
                  onClick={() => setEditor({ open: true, testimonial: t })}
                />,
              );
            }
            if (canDelete) {
              actions.push(
                <Popconfirm
                  key="del"
                  title="Delete this testimonial?"
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => handleDelete(t)}
                >
                  <DeleteOutlined />
                </Popconfirm>,
              );
            }

            return (
              <Col key={t.uid} xs={24} sm={12} lg={8} xxl={6}>
                <Card size="small" actions={actions.length ? actions : undefined}>
                  <Space align="start" size={12} style={{ width: '100%' }}>
                    <Avatar
                      size={56}
                      src={photo || undefined}
                      icon={!photo && !t.name ? <UserOutlined /> : undefined}
                    >
                      {!photo ? initials(t.name) : null}
                    </Avatar>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Space size={8} wrap>
                        <Text strong>{t.name || '—'}</Text>
                        <Tag color={t.status === 'active' ? 'green' : 'default'}>
                          {t.status || 'inactive'}
                        </Tag>
                      </Space>
                      {t.designation && (
                        <div>
                          <Text strong type="secondary">
                            {t.designation}
                          </Text>
                        </div>
                      )}
                      {t.rating ? (
                        <div>
                          <Rate disabled value={t.rating} style={{ fontSize: 14 }} />
                        </div>
                      ) : null}
                    </div>
                  </Space>
                  <Paragraph
                    style={{ marginTop: 12, marginBottom: 0 }}
                    ellipsis={{ rows: 4, tooltip: t.content }}
                    type="secondary"
                  >
                    “{t.content}”
                  </Paragraph>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      <TestimonialEditorDrawer
        open={editor.open}
        testimonial={editor.testimonial}
        onClose={() => setEditor({ open: false, testimonial: null })}
        onSaved={refetch}
      />
    </div>
  );
}
