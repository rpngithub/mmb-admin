import { useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  KeyOutlined,
  SafetyCertificateOutlined,
  CheckCircleOutlined,
  StopOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import { adminApi } from '../../features/api/adminApi';
import { usePermissions } from '../../features/auth/usePermissions';
import { useStepUp, isStepUpCancel, stashSecret, discardSecret } from '../../features/auth/stepUp';
import {
  CREDENTIAL_KINDS,
  CREDENTIAL_STATUS_COLORS,
  errorText,
  formatDateTime,
} from '../../lib/ai';

const { Text, Paragraph } = Typography;

const kindLabel = (k) => CREDENTIAL_KINDS.find((c) => c.value === k)?.label || k;
const VERIFY_HINT =
  'Calls the provider with this key. For a real provider this is a real — possibly billed — request.';

function VerifyResult({ result }) {
  if (!result) return null;
  const good = result.ok && result.verified;
  return (
    <Alert
      style={{ marginTop: 12 }}
      type={good ? 'success' : result.ok ? 'warning' : 'error'}
      showIcon
      message={
        good
          ? 'Verified — the provider accepted this key.'
          : result.ok
            ? 'The call went through, but the key could not be confirmed.'
            : 'Verification failed.'
      }
      description={
        result.code || result.detail ? (
          <Space direction="vertical" size={0}>
            {result.code && <Text code>{result.code}</Text>}
            {result.detail && <Text>{String(result.detail)}</Text>}
          </Space>
        ) : undefined
      }
    />
  );
}

/**
 * Credentials of one provider. WRITE-ONLY by design: the API never returns a
 * key, only its last 4 characters. Rotation is Add → Verify → Activate.
 */
export default function AiCredentialsPanel({ provider }) {
  const { message, modal } = App.useApp();
  const perms = usePermissions();
  const stepUp = useStepUp();
  const canCreate = perms.can('ai_providers', 'create');
  const canUpdate = perms.can('ai_providers', 'update');

  const providerUid = provider.uid;
  const { data: creds = [], isFetching, refetch } =
    adminApi.endpoints.aiCredentialsList.useQuery(providerUid);
  const [createCred, { isLoading: adding }] = adminApi.endpoints.aiCredentialCreate.useMutation();
  const [verifyCred] = adminApi.endpoints.aiCredentialVerify.useMutation();
  const [activateCred] = adminApi.endpoints.aiCredentialActivate.useMutation();
  const [retireCred] = adminApi.endpoints.aiCredentialRetire.useMutation();

  // Rotation wizard. Only the NEW credential's uid is kept — never its value.
  const valueRef = useRef(null);
  const [kind, setKind] = useState('api_key');
  const [newUid, setNewUid] = useState(null);
  const [step, setStep] = useState(0);
  const [verifyResults, setVerifyResults] = useState({}); // credUid → result
  const [busy, setBusy] = useState(null); // `${action}:${credUid}`
  const [masterKeyMissing, setMasterKeyMissing] = useState(false);

  const resetWizard = () => {
    setNewUid(null);
    setStep(0);
  };

  const add = async () => {
    const el = valueRef.current?.input;
    const value = el?.value?.trim() || '';
    // Clear the field right away — whatever the result, it is never kept.
    if (el) el.value = '';
    if (!value) {
      message.warning('Paste the key value first.');
      return;
    }
    try {
      const created = await stepUp.run(
        async (stepUpToken) => {
          // A fresh one-shot per attempt: a wrong password retries with the
          // same value without it ever entering React or Redux state.
          const secret = stashSecret({ kind, value });
          try {
            return await createCred({ providerUid, secret, stepUp: stepUpToken }).unwrap();
          } finally {
            discardSecret(secret);
          }
        },
        {
          title: `Add ${kindLabel(kind).toLowerCase()}`,
          description: 'Re-type your admin password to store a new key for this provider.',
        },
      );
      setMasterKeyMissing(false);
      message.success('Added as pending — verify it next.');
      if (created?.uid) {
        setNewUid(created.uid);
        setStep(1);
      }
    } catch (err) {
      if (isStepUpCancel(err)) return;
      if (err?.code === 'AI_MASTER_KEY_MISSING') {
        setMasterKeyMissing(true);
        return;
      }
      message.error(errorText(err, 'Could not add the key.'));
    }
  };

  const verify = async (credUid) => {
    setBusy(`verify:${credUid}`);
    try {
      const result = await verifyCred({ providerUid, credUid }).unwrap();
      setVerifyResults((r) => ({ ...r, [credUid]: result || {} }));
      if (credUid === newUid && result?.ok && result?.verified) setStep(2);
    } catch (err) {
      setVerifyResults((r) => ({
        ...r,
        [credUid]: { ok: false, verified: false, code: err?.code, detail: err?.message },
      }));
    } finally {
      setBusy(null);
    }
  };

  const doActivate = async (cred) => {
    setBusy(`activate:${cred.uid}`);
    try {
      await stepUp.run(
        (stepUpToken) =>
          activateCred({ providerUid, credUid: cred.uid, stepUp: stepUpToken }).unwrap(),
        { title: 'Activate key' },
      );
      message.success('Activated — all servers pick it up within a minute.');
      if (cred.uid === newUid) setStep(3);
    } catch (err) {
      if (!isStepUpCancel(err)) message.error(errorText(err, 'Could not activate the key.'));
    } finally {
      setBusy(null);
    }
  };

  const activate = (cred) => {
    modal.confirm({
      title: `Activate ••••${cred.last4 || ''}?`,
      content: (
        <div>
          <Paragraph>Takes effect on all servers within a minute.</Paragraph>
          <Paragraph style={{ marginBottom: 0 }}>
            The current active {kindLabel(cred.kind).toLowerCase()} becomes <b>retired</b>.
          </Paragraph>
        </div>
      ),
      okText: 'Activate',
      onOk: () => {
        doActivate(cred);
      },
    });
  };

  const retire = (cred) => {
    const stopsJobs = cred.status === 'active' && cred.kind === 'api_key';
    modal.confirm({
      title: `Retire ••••${cred.last4 || ''}?`,
      content: stopsJobs ? (
        <Alert
          type="error"
          showIcon
          message="This is the ACTIVE API key."
          description="Retiring it stops the provider taking new AI jobs — users get AI_UNAVAILABLE (nothing is charged) until another key is activated."
        />
      ) : (
        'A retired key cannot be used again.'
      ),
      okText: 'Retire',
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(`retire:${cred.uid}`);
        try {
          await stepUp.run(
            (stepUpToken) =>
              retireCred({ providerUid, credUid: cred.uid, stepUp: stepUpToken }).unwrap(),
            { title: 'Retire key' },
          );
          message.success('Key retired');
        } catch (err) {
          if (!isStepUpCancel(err)) message.error(errorText(err, 'Could not retire the key.'));
        } finally {
          setBusy(null);
        }
      },
    });
  };

  const newCred = creds.find((c) => c.uid === newUid);

  const columns = [
    { title: 'Kind', dataIndex: 'kind', key: 'kind', render: (v) => kindLabel(v) },
    {
      title: 'Value',
      dataIndex: 'last4',
      key: 'last4',
      render: (v) => <Text code>••••{v || '????'}</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (v) => <Tag color={CREDENTIAL_STATUS_COLORS[v] || 'default'}>{v}</Tag>,
    },
    { title: 'Added', dataIndex: 'created_at', key: 'created_at', render: formatDateTime },
    { title: 'Activated', dataIndex: 'activated_at', key: 'activated_at', render: formatDateTime },
    { title: 'Retired', dataIndex: 'retired_at', key: 'retired_at', render: formatDateTime },
  ];
  if (canUpdate) {
    columns.push({
      title: 'Actions',
      key: 'actions',
      render: (_v, c) =>
        c.status === 'retired' ? null : (
          <Space size="small">
            <Tooltip title={VERIFY_HINT}>
              <Button
                size="small"
                icon={<ApiOutlined />}
                loading={busy === `verify:${c.uid}`}
                onClick={() => verify(c.uid)}
              >
                Verify
              </Button>
            </Tooltip>
            {c.status === 'pending' && (
              <Button
                size="small"
                type="primary"
                ghost
                icon={<CheckCircleOutlined />}
                loading={busy === `activate:${c.uid}`}
                onClick={() => activate(c)}
              >
                Activate
              </Button>
            )}
            <Button
              size="small"
              danger
              icon={<StopOutlined />}
              loading={busy === `retire:${c.uid}`}
              onClick={() => retire(c)}
            >
              Retire
            </Button>
          </Space>
        ),
    });
  }

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Keys are write-only."
        description="Once saved there is no way to read a key back — only its last 4 characters are shown. To change one, add a new key, verify it, then activate it."
      />

      {provider.credential_source === 'env' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="This provider reads its credentials from the server environment (credential source: env)."
          description="Keys stored here are only used when the credential source is db."
        />
      )}

      {masterKeyMissing && (
        <Alert
          type="error"
          showIcon
          closable
          onClose={() => setMasterKeyMissing(false)}
          style={{ marginBottom: 16 }}
          message="AI_SECRETS_MASTER_KEY is not set on this server — keys cannot be stored"
          description="Set it on the server and restart, then add the key again."
        />
      )}

      {canCreate && (
        <Card
          size="small"
          title={
            <Space>
              <KeyOutlined />
              Rotate / add a key
            </Space>
          }
          extra={
            step > 0 && (
              <Button size="small" type="link" onClick={resetWizard}>
                Start over
              </Button>
            )
          }
          style={{ marginBottom: 16 }}
        >
          <Steps
            size="small"
            current={step}
            style={{ marginBottom: 16 }}
            items={[{ title: 'Add' }, { title: 'Verify' }, { title: 'Activate' }]}
          />

          {step === 0 && (
            <Space.Compact style={{ width: '100%' }}>
              <Select
                value={kind}
                onChange={setKind}
                options={CREDENTIAL_KINDS}
                style={{ width: 170 }}
              />
              {/* Uncontrolled on purpose: the value never enters React state. */}
              <Input.Password
                ref={valueRef}
                placeholder="Paste the key value"
                autoComplete="new-password"
                visibilityToggle={false}
                onPressEnter={add}
              />
              <Button type="primary" loading={adding} onClick={add}>
                Add
              </Button>
            </Space.Compact>
          )}

          {step === 1 && (
            <div>
              <Paragraph>
                New {kindLabel(newCred?.kind || kind).toLowerCase()}{' '}
                <Text code>••••{newCred?.last4 || '????'}</Text> is <Tag color="gold">pending</Tag>
                — nothing uses it yet.
              </Paragraph>
              <Space>
                <Tooltip title={VERIFY_HINT}>
                  <Button
                    type="primary"
                    icon={<ApiOutlined />}
                    loading={busy === `verify:${newUid}`}
                    onClick={() => verify(newUid)}
                  >
                    Verify with the provider
                  </Button>
                </Tooltip>
                <Button onClick={() => setStep(2)}>Skip</Button>
              </Space>
              <VerifyResult result={verifyResults[newUid]} />
            </div>
          )}

          {step === 2 && (
            <div>
              <VerifyResult result={verifyResults[newUid]} />
              <Paragraph style={{ marginTop: 12 }}>
                Activating retires the current active key of this kind. Takes effect on all
                servers within a minute.
              </Paragraph>
              <Button
                type="primary"
                icon={<SafetyCertificateOutlined />}
                loading={busy === `activate:${newUid}`}
                onClick={() => activate(newCred || { uid: newUid, kind })}
              >
                Activate
              </Button>
            </div>
          )}

          {step === 3 && (
            <Alert
              type="success"
              showIcon
              message="Rotation complete — the new key is active."
              action={
                <Button size="small" onClick={resetWizard}>
                  Add another
                </Button>
              }
            />
          )}
        </Card>
      )}

      {Object.entries(verifyResults)
        .filter(([uid]) => uid !== newUid)
        .map(([uid, result]) => {
          const c = creds.find((x) => x.uid === uid);
          return (
            <div key={uid} style={{ marginBottom: 12 }}>
              <Text type="secondary">
                Verify ••••{c?.last4 || '????'} ({kindLabel(c?.kind)}):
              </Text>
              <VerifyResult result={result} />
            </div>
          );
        })}

      <Table
        rowKey="uid"
        size="small"
        columns={columns}
        dataSource={creds}
        loading={isFetching}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: 'No keys stored for this provider.' }}
        footer={() => (
          <Button size="small" type="link" onClick={refetch} style={{ padding: 0 }}>
            Reload
          </Button>
        )}
      />
    </div>
  );
}
