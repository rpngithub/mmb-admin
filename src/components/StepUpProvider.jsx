import { useCallback, useMemo, useRef, useState } from 'react';
import { Modal, Input, Alert, Typography, Space } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import {
  StepUpContext,
  STEP_UP_CANCELLED,
  REAUTH_FAILED,
  REAUTH_LOCKED,
  REAUTH_REQUIRED,
  stashSecret,
  discardSecret,
} from '../features/auth/stepUp';

const { Text } = Typography;

const CLOSED = {
  open: false,
  title: '',
  description: null,
  error: null,
  locked: false,
  loading: false,
};

/**
 * The ONE "Confirm your password" modal for every step-up call in the app.
 * Mounted once at the root; screens reach it through `useStepUp()`.
 *
 * The password input is UNCONTROLLED: its value is read off the DOM node on
 * submit, wiped from the node straight away, parked in the one-shot stash for
 * the single request, and dropped afterwards. It is never in React state.
 *
 * Re-auth failures keep the modal open with the reason; any other error closes
 * it and goes back to the caller, which knows how to explain it.
 */
export default function StepUpProvider({ children }) {
  const [ui, setUi] = useState(CLOSED);
  const callRef = useRef(null); // { fn, resolve, reject }
  const inputRef = useRef(null);

  const close = useCallback(() => {
    const call = callRef.current;
    callRef.current = null;
    const el = inputRef.current?.input;
    if (el) el.value = '';
    setUi(CLOSED);
    return call;
  }, []);

  const run = useCallback(
    async (fn, options = {}) => {
      const {
        upfront = true,
        title = 'Confirm your password',
        description = 'This change is sensitive. Re-type your admin password to continue.',
      } = options;

      if (!upfront) {
        try {
          return await fn(undefined);
        } catch (err) {
          if (err?.code !== REAUTH_REQUIRED) throw err;
          // fall through: the server wants the password after all
        }
      }

      // A second step-up while one is open cancels the first.
      const previous = callRef.current;
      if (previous) previous.reject(STEP_UP_CANCELLED);

      return new Promise((resolve, reject) => {
        callRef.current = { fn, resolve, reject };
        setUi({ ...CLOSED, open: true, title, description });
      });
    },
    [],
  );

  const submit = async () => {
    const call = callRef.current;
    if (!call || ui.loading || ui.locked) return;
    const el = inputRef.current?.input;
    const password = el?.value || '';
    if (!password) {
      setUi((u) => ({ ...u, error: 'Enter your password.' }));
      return;
    }
    if (el) el.value = ''; // wipe the field at once, whatever happens next

    setUi((u) => ({ ...u, loading: true, error: null }));
    const token = stashSecret(password);
    try {
      const result = await call.fn(token);
      if (callRef.current === call) close();
      call.resolve(result);
    } catch (err) {
      if (callRef.current !== call) return; // superseded meanwhile
      if (err?.code === REAUTH_FAILED) {
        setUi((u) => ({ ...u, loading: false, error: 'Incorrect password.' }));
        el?.focus();
      } else if (err?.code === REAUTH_LOCKED || err?.status === 429) {
        setUi((u) => ({
          ...u,
          loading: false,
          locked: true,
          error: 'Too many wrong passwords (5 in 15 minutes). Try again later.',
        }));
      } else if (err?.code === REAUTH_REQUIRED) {
        setUi((u) => ({ ...u, loading: false, error: 'Your password is required for this action.' }));
      } else {
        close();
        call.reject(err);
      }
    } finally {
      discardSecret(token); // normally already taken by the request
    }
  };

  const cancel = () => {
    if (ui.loading) return;
    const call = close();
    if (call) call.reject(STEP_UP_CANCELLED);
  };

  const value = useMemo(() => ({ run }), [run]);

  return (
    <StepUpContext.Provider value={value}>
      {children}
      <Modal
        open={ui.open}
        title={
          <Space>
            <LockOutlined />
            {ui.title}
          </Space>
        }
        okText="Confirm"
        onOk={submit}
        onCancel={cancel}
        confirmLoading={ui.loading}
        okButtonProps={{ disabled: ui.locked }}
        cancelButtonProps={{ disabled: ui.loading }}
        maskClosable={false}
        destroyOnClose
        // Above drawers and confirm dialogs that may have opened it.
        zIndex={2000}
      >
        {ui.description && (
          <div style={{ marginBottom: 12 }}>
            {typeof ui.description === 'string' ? <Text>{ui.description}</Text> : ui.description}
          </div>
        )}
        <Input.Password
          ref={inputRef}
          autoFocus
          autoComplete="current-password"
          placeholder="Your admin password"
          disabled={ui.locked || ui.loading}
          onPressEnter={submit}
        />
        {ui.error && (
          <Alert
            style={{ marginTop: 12 }}
            type="error"
            showIcon
            message={ui.error}
          />
        )}
        <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
          Used for this one request only — it is not saved anywhere.
        </Text>
      </Modal>
    </StepUpContext.Provider>
  );
}
