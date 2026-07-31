import { Typography, Card, Col, Row, Empty, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAppSelector } from '../app/hooks';
import { selectIdentity, selectPermissions } from '../features/auth/authSlice';
import { usePermissions } from '../features/auth/usePermissions';
import { getNavItems } from '../navigation';

const { Title, Paragraph, Text } = Typography;

export default function Dashboard() {
  const navigate = useNavigate();
  const identity = useAppSelector(selectIdentity);
  const permissions = useAppSelector(selectPermissions);
  const perms = usePermissions();

  const accessible = getNavItems().filter((i) => perms.canRead(i.permission));

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        Welcome back, {identity.name}
      </Title>
      <Paragraph type="secondary">
        Manage the MakeMyBrand catalog, content, billing and access from one place. Your available
        sections are shown below — they reflect the permissions on your account.
      </Paragraph>

      <Card size="small" style={{ marginBottom: 24 }} title="Your permissions">
        {permissions.length === 0 ? (
          <Text type="secondary">No permissions found on your token.</Text>
        ) : (
          permissions.map((p) => (
            <Tag color={p === '*' ? 'gold' : 'blue'} key={p} style={{ marginBottom: 4 }}>
              {p}
            </Tag>
          ))
        )}
      </Card>

      {accessible.length === 0 ? (
        <Empty description="You don't have read access to any sections yet." />
      ) : (
        <Row gutter={[16, 16]}>
          {accessible.map((item) => (
            <Col key={item.key} xs={24} sm={12} md={8} lg={6}>
              <Card hoverable onClick={() => navigate(item.key)} style={{ height: '100%' }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>{item.icon}</div>
                <Text strong>{item.label}</Text>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {item.permission}
                  </Text>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
