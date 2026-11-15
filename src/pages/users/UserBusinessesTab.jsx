import { Avatar, Card, Descriptions, Empty, Rate, Space, Tag, Typography } from 'antd';
import { ShopOutlined } from '@ant-design/icons';
import { useUserBusinessesQuery } from '../../features/api/adminApi';
import { formatDate } from '../../lib/ai';
import { imageUrl, useCdnBaseUrl } from '../../lib/cdn';
import { isTruthyFlag, sectionState } from '../../lib/users';

const { Text, Paragraph } = Typography;

const link = (href, text) =>
  href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {text || href}
    </a>
  ) : (
    '—'
  );

function BusinessCard({ b, cdnBase }) {
  const logo = imageUrl(cdnBase, b.logo_s3_key);
  const location = [b.address, b.city, b.state].filter(Boolean).join(', ');
  const website = b.website && !/^https?:\/\//i.test(b.website) ? `https://${b.website}` : b.website;
  return (
    <Card
      size="small"
      title={
        <Space>
          <Avatar shape="square" size={40} src={logo} icon={!logo && <ShopOutlined />} />
          <Space direction="vertical" size={0}>
            <Text strong>{b.name}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {b.BusinessCategory?.name || 'No industry'}
            </Text>
          </Space>
        </Space>
      }
      extra={
        isTruthyFlag(b.is_active) ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>
      }
    >
      {b.description && <Paragraph type="secondary">{b.description}</Paragraph>}
      <Descriptions size="small" bordered column={{ xs: 1, md: 2 }}>
        <Descriptions.Item label="Address" span={2}>
          {location || '—'}
        </Descriptions.Item>
        <Descriptions.Item label="Phone">{b.phone || '—'}</Descriptions.Item>
        <Descriptions.Item label="WhatsApp">{b.whatsapp || '—'}</Descriptions.Item>
        <Descriptions.Item label="Email">{b.email ? link(`mailto:${b.email}`, b.email) : '—'}</Descriptions.Item>
        <Descriptions.Item label="Website">{link(website, b.website)}</Descriptions.Item>
        <Descriptions.Item label="Rating">
          {Number(b.rating_count) > 0 ? (
            <Space size={4}>
              <Rate disabled allowHalf value={Number(b.rating_avg) || 0} style={{ fontSize: 14 }} />
              <Text type="secondary">
                {b.rating_avg} ({b.rating_count})
              </Text>
            </Space>
          ) : (
            'No ratings'
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Watermark">
          {isTruthyFlag(b.watermark_enabled) ? 'On' : 'Off'}
        </Descriptions.Item>
        <Descriptions.Item label="Active frame">{b.activeFrame?.name || '—'}</Descriptions.Item>
        <Descriptions.Item label="Created">{formatDate(b.created_at)}</Descriptions.Item>
        <Descriptions.Item label="Variants in use" span={2}>
          {b.variants?.length ? (
            <Space size={[4, 4]} wrap>
              {b.variants.map((v) => (
                <Tag key={v.uid}>{v.name}</Tag>
              ))}
            </Space>
          ) : (
            '—'
          )}
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

export default function UserBusinessesTab({ uid, accountType }) {
  const cdnBase = useCdnBaseUrl();
  const { data, isLoading, error } = useUserBusinessesQuery(uid);
  const state = sectionState({ isLoading, error });
  if (state) return state;

  const list = Array.isArray(data) ? data : [];
  if (!list.length) {
    return (
      <Empty
        description={
          accountType === 'personal' ? 'Personal account — no business' : 'No business set up yet'
        }
      />
    );
  }
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {list.map((b) => (
        <BusinessCard key={b.uid} b={b} cdnBase={cdnBase} />
      ))}
    </Space>
  );
}
