import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Card,
  Form,
  Input,
  Select,
  Switch,
  Button,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  Alert,
  Result,
  Row,
  Col,
  App,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  DeleteOutlined,
  MergeCellsOutlined,
} from '@ant-design/icons';
import { adminApi } from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import {
  STATUS_COLORS,
  TEMPLATE_TYPES,
  FAMILY_REQUIREMENTS,
  isTrue,
  findEnglish,
  computeReadiness,
} from '../lib/templateFamilies';
import TemplateFamilyRelationsPanel from '../components/TemplateFamilyRelationsPanel';
import TemplateVersionGrid from '../components/TemplateVersionGrid';
import { MergeFamilyModal } from '../components/TemplateFamilyMoveModals';
import { useConfirmFamilyDelete } from '../components/templateFamilyDelete';

const { Title, Text, Paragraph } = Typography;

// Family fields the details form owns; a 400 on any of these lands inline.
const FORM_FIELDS = ['name', 'category_id', 'template_type', 'is_premium', 'is_popular'];

/**
 * One DESIGN (template family): shared details + relations on top, the
 * language × size version grid below, and the family publish gate beside it.
 * `/templates/new` shows only the details form; saving it creates a draft and
 * moves to the real screen.
 */
export default function TemplateFamilyPage() {
  const { uid: routeUid } = useParams();
  const isCreate = routeUid === 'new';
  const uid = isCreate ? null : routeUid;
  const navigate = useNavigate();
  const location = useLocation();
  const perms = usePermissions();
  const confirmDelete = useConfirmFamilyDelete();
  const [mergeOpen, setMergeOpen] = useState(false);

  const canUpdate = perms.can('templates', 'update');
  const canDelete = perms.can('templates', 'delete');

  const {
    data: family,
    isLoading,
    isFetching,
    error,
  } = adminApi.endpoints.templateFamilyGet.useQuery(uid, { skip: !uid });
  const { data: versions, isFetching: versionsFetching } =
    adminApi.endpoints.templateVersionsByFamily.useQuery(uid, { skip: !uid });

  // Back returns to the filtered list when we came from it.
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/templates'));

  if (!isCreate && error?.status === 404) {
    return (
      <Result
        status="404"
        title="Design not found"
        subTitle="It may have been deleted, or merged into another design."
        extra={<Button onClick={() => navigate('/templates')}>Back to designs</Button>}
      />
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
        <Space align="center" size={12}>
          <Button icon={<ArrowLeftOutlined />} onClick={goBack} aria-label="Back" />
          <Title level={4} style={{ margin: 0 }}>
            {isCreate ? 'New design' : family?.name || 'Design'}
          </Title>
          {family && <Tag color={STATUS_COLORS[family.status] || 'default'}>{family.status}</Tag>}
        </Space>
        {family && (
          <Space wrap>
            {canUpdate && (
              <Button icon={<MergeCellsOutlined />} onClick={() => setMergeOpen(true)}>
                Merge into another design…
              </Button>
            )}
            {canDelete && (
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={() =>
                  confirmDelete(
                    { ...family, version_count: family.version_count ?? versions?.length },
                    { onDeleted: () => navigate('/templates', { replace: true }) },
                  )
                }
              >
                Delete
              </Button>
            )}
          </Space>
        )}
      </div>

      {isCreate ? (
        <Card title="Details" style={{ maxWidth: 640 }}>
          <FamilyDetailsForm
            onCreated={(created) => navigate(`/templates/${created.uid}`, { replace: true })}
          />
        </Card>
      ) : (
        <Spin spinning={isLoading}>
          {family && (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={14}>
                  <Card title="Details" loading={isLoading}>
                    <FamilyDetailsForm family={family} disabled={!canUpdate} />
                  </Card>
                </Col>
                <Col xs={24} lg={10}>
                  <PublishCard
                    family={family}
                    versions={versions}
                    refreshing={isFetching || versionsFetching}
                    canUpdate={canUpdate}
                  />
                </Col>
              </Row>
              <Card title="Relations">
                <TemplateFamilyRelationsPanel uid={family.uid} disabled={!canUpdate} />
              </Card>
              <Card
                title="Versions"
                extra={
                  <Text type="secondary">
                    {(versions || []).length} version{(versions || []).length === 1 ? '' : 's'}
                  </Text>
                }
              >
                <TemplateVersionGrid
                  family={family}
                  versions={versions}
                  loading={versionsFetching && !versions}
                />
              </Card>
            </Space>
          )}
        </Spin>
      )}

      {family && (
        <MergeFamilyModal
          open={mergeOpen}
          family={family}
          onClose={() => setMergeOpen(false)}
          onMerged={(targetUid) => {
            setMergeOpen(false);
            navigate(`/templates/${targetUid}`, { replace: true });
          }}
        />
      )}
    </div>
  );
}

// ---- Details ------------------------------------------------------------------

function FamilyDetailsForm({ family, disabled, onCreated }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(family);

  const { data: categories } = adminApi.endpoints.templateCategoriesList.useQuery();
  const [createFamily] = adminApi.endpoints.templateFamilyCreate.useMutation();
  const [updateFamily] = adminApi.endpoints.templateFamilyUpdate.useMutation();

  useEffect(() => {
    if (family) {
      form.setFieldsValue({
        name: family.name,
        category_id: family.category_id ?? undefined,
        template_type: family.template_type ?? undefined,
        is_premium: isTrue(family.is_premium),
        is_popular: isTrue(family.is_popular),
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ is_premium: false, is_popular: false });
    }
  }, [family, form]);

  const submit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    // Status is NOT sent from here: new designs are always born drafts (status
    // on create is a 400), and the Publish card owns every status change.
    const body = {
      name: values.name.trim(),
      category_id: values.category_id ?? null,
      // Omitted (not null) when empty — same as the old template editor sent.
      template_type: values.template_type,
      is_premium: values.is_premium ? 1 : 0,
      is_popular: values.is_popular ? 1 : 0,
    };
    setSaving(true);
    try {
      if (isEdit) {
        await updateFamily({ uid: family.uid, body }).unwrap();
        message.success('Details saved');
      } else {
        const created = await createFamily(body).unwrap();
        message.success('Draft design created — now add its versions');
        onCreated?.(created);
      }
    } catch (err) {
      if (err?.status === 409) {
        form.setFields([
          { name: 'name', errors: [err.message || 'A design with this name already exists.'] },
        ]);
        return;
      }
      const details = Array.isArray(err?.details) ? err.details : [];
      const inline = details.filter((d) => FORM_FIELDS.includes(d.field));
      if (inline.length) {
        form.setFields(inline.map((d) => ({ name: d.field, errors: [d.message] })));
      }
      const rest = details.filter((d) => !FORM_FIELDS.includes(d.field));
      if (!inline.length || rest.length) {
        message.error(
          [err?.message || 'Could not save.', ...rest.map((d) => d.message)].join(' — '),
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Form form={form} layout="vertical" disabled={disabled}>
      <Form.Item
        name="name"
        label="Name"
        rules={[{ required: true, whitespace: true, message: 'Name is required' }]}
        extra="Unique across designs. Versions show this name unless they have their own label."
      >
        <Input placeholder="Design name" />
      </Form.Item>
      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item
            name="category_id"
            label="Category"
            extra="Category or at least one industry is required to publish."
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Uncategorized"
              options={(categories || []).map((c) => ({ label: c.name, value: c.id }))}
            />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item name="template_type" label="Type">
            <Select
              allowClear
              placeholder="Select a type"
              options={TEMPLATE_TYPES.map((t) => ({ label: t, value: t }))}
            />
          </Form.Item>
        </Col>
      </Row>
      <Space size="large" align="start" wrap>
        <Form.Item name="is_premium" label="Premium" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item
          name="is_popular"
          label="Popular"
          valuePropName="checked"
          extra="Shown on the Popular shelf in the app — curated by you, not calculated."
        >
          <Switch />
        </Form.Item>
      </Space>
      {!isEdit && (
        <Paragraph type="secondary">
          New designs are created as <Text code>draft</Text>. Add its versions and tags, then
          publish it.
        </Paragraph>
      )}
      {!disabled && (
        <Button type="primary" loading={saving} onClick={submit}>
          {isEdit ? 'Save details' : 'Create design'}
        </Button>
      )}
    </Form>
  );
}

// ---- Publish ------------------------------------------------------------------

function PublishCard({ family, versions, refreshing, canUpdate }) {
  const { message } = App.useApp();
  const perms = usePermissions();
  const [updateFamily, { isLoading }] = adminApi.endpoints.templateFamilyUpdate.useMutation();
  const [serverErrors, setServerErrors] = useState(null); // [{ field, message }] from a 400

  const { data: relations } = adminApi.endpoints.templateFamilyRelations.useQuery(family.uid);
  const { data: languages } = adminApi.endpoints.languagesFiltered.useQuery(
    { is_active: 1 },
    { skip: !perms.canRead('languages') },
  );
  // The server's list of what blocks publishing. Only when the detail response
  // doesn't carry it do we fall back to a client copy of the gate — and then
  // the checklist is advisory: the Publish button stays enabled and the API's
  // 400 details[] have the final say.
  const fromServer = Array.isArray(family.readiness);
  const readiness = useMemo(() => {
    if (fromServer) return family.readiness;
    return computeReadiness({
      family,
      relations,
      versions,
      englishId: findEnglish(languages)?.id,
    });
  }, [fromServer, family, relations, versions, languages]);

  // A fresh family (after any version change) supersedes the last rejection.
  useEffect(() => setServerErrors(null), [family]);

  const blockers = serverErrors?.length ? serverErrors : readiness || [];
  const status = family.status || 'draft';
  const ready = readiness !== null && readiness.length === 0;
  const publishBlocked = fromServer && !ready;

  const setStatus = async (next) => {
    setServerErrors(null);
    try {
      await updateFamily({ uid: family.uid, body: { status: next } }).unwrap();
      message.success(next === 'active' ? 'Design published' : `Design set to ${next}`);
    } catch (err) {
      const details = Array.isArray(err?.details) ? err.details : [];
      if (details.length) setServerErrors(details);
      else message.error(err?.message || 'Could not change the status.');
    }
  };

  const known = new Set(FAMILY_REQUIREMENTS.map((r) => r.field));
  const extra = blockers.filter((b) => !known.has(b.field));

  return (
    <Card title="Publish" extra={refreshing ? <Spin size="small" /> : null}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          {FAMILY_REQUIREMENTS.map((r) => {
            const hits = blockers.filter((b) => b.field === r.field);
            const ok = readiness !== null && hits.length === 0;
            return (
              <div key={r.field} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                {ok ? (
                  <CheckCircleFilled style={{ color: '#52c41a', marginTop: 4 }} />
                ) : (
                  <CloseCircleFilled style={{ color: '#ff4d4f', marginTop: 4 }} />
                )}
                <div>
                  <Text type={ok ? undefined : 'danger'}>{r.label}</Text>
                  {hits.map((h, i) => (
                    <div key={i}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {h.message}
                      </Text>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {extra.map((b, i) => (
            <div key={`x-${i}`} style={{ display: 'flex', gap: 8 }}>
              <CloseCircleFilled style={{ color: '#ff4d4f', marginTop: 4 }} />
              <Text type="danger">{b.message}</Text>
            </div>
          ))}
        </Space>

        {status === 'active' && !ready && readiness !== null && (
          <Alert
            type="warning"
            showIcon
            message="Live, but it wouldn’t pass the publish check today"
            description="It stays live. If it’s unpublished it can’t be republished until the items above are fixed."
          />
        )}

        {canUpdate && (
          <Space wrap>
            <Tooltip title={publishBlocked ? 'Fix the items above first' : undefined}>
              <Button
                type="primary"
                loading={isLoading}
                disabled={status === 'active' || publishBlocked}
                onClick={() => setStatus('active')}
              >
                Publish
              </Button>
            </Tooltip>
            <Button
              loading={isLoading}
              disabled={status === 'inactive'}
              onClick={() => setStatus('inactive')}
            >
              Unpublish (inactive)
            </Button>
            <Button loading={isLoading} disabled={status === 'draft'} onClick={() => setStatus('draft')}>
              Back to draft
            </Button>
          </Space>
        )}
        <Text type="secondary" style={{ fontSize: 12 }}>
          Publishing makes the design’s active versions visible in the app. Any size works — the
          default size is only what cards prefer. If the design loses its last active English (or
          text-free) version, it goes back to draft on its own.
        </Text>
      </Space>
    </Card>
  );
}
