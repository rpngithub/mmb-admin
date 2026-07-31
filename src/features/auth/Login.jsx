import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Form, Input, Button, Card, Typography, Alert } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { setCredentials, selectIsAuthenticated } from './authSlice';
import { useLoginMutation } from '../../features/api/adminApi';

const { Text } = Typography;

export default function Login() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const [login, { isLoading }] = useLoginMutation();
  const [errorMsg, setErrorMsg] = useState('');

  const from = location.state?.from?.pathname || '/';

  if (isAuthenticated) return <Navigate to={from} replace />;

  const onFinish = async (values) => {
    setErrorMsg('');
    try {
      const data = await login(values).unwrap();
      dispatch(
        setCredentials({ access_token: data.access_token, refresh_token: data.refresh_token }),
      );
      navigate(from, { replace: true });
    } catch (err) {
      setErrorMsg(err?.message || 'Login failed. Check your credentials and try again.');
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #e90000 0%, #a30000 100%)',
        padding: 16,
      }}
    >
      <Card style={{ width: 400, maxWidth: '100%' }} variant="borderless">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img
            src="/mmb-logo.svg"
            alt="MakeMyBrand"
            style={{ height: 44, width: 'auto', maxWidth: '80%', marginBottom: 12 }}
          />
          <Text type="secondary" style={{ display: 'block' }}>
            Sign in to your admin account
          </Text>
        </div>

        {errorMsg && (
          <Alert
            type="error"
            message={errorMsg}
            showIcon
            style={{ marginBottom: 16 }}
            closable
            onClose={() => setErrorMsg('')}
          />
        )}

        <Form layout="vertical" onFinish={onFinish} requiredMark={false} disabled={isLoading}>
          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Email is required' },
              { type: 'email', message: 'Enter a valid email' },
            ]}
          >
            <Input prefix={<UserOutlined />} placeholder="admin@example.com" size="large" />
          </Form.Item>
          <Form.Item
            name="password"
            label="Password"
            rules={[{ required: true, message: 'Password is required' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="••••••••" size="large" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block size="large" loading={isLoading}>
              Sign in
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
