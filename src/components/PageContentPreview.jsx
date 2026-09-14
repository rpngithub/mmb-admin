import { Select, Typography, Space, Tag, Spin, Empty, Alert, Divider } from 'antd';
import { usePageSectionsPreviewQuery } from '../features/api/adminApi';
import ImageThumb from './ImageThumb';
import { PAGE_KEY, previewSections, sectionItems, isTrue } from '../lib/pageContent';

const { Text, Title, Paragraph } = Typography;

/**
 * The resolved page for one industry, from the preview endpoint: defaults and
 * overrides merged, tokens substituted, blocks in their final order. Plain
 * rendering on purpose — it does not try to look like the website; what
 * matters is that an editor sees "videos for your {{industry_lower}} brand"
 * as "videos for your restaurant & food brand" before it goes out.
 *
 * Refetches after every save because it shares the PageSections tag.
 *
 * `locked` (an industry view) fixes the industry; otherwise the pane has its
 * own "Preview as…" select.
 */
export default function PageContentPreview({ industryId, industries, locked, onChange }) {
  const { data, isLoading, isFetching, error } = usePageSectionsPreviewQuery(
    { page_key: PAGE_KEY, industry_id: industryId },
    { skip: industryId == null },
  );
  const sections = previewSections(data);
  const industry = industries.find((i) => i.id === industryId);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          {locked ? 'Previewing' : 'Preview as…'}
        </Text>
        {locked ? (
          <Text strong>{industry?.name || '—'}</Text>
        ) : (
          <Select
            showSearch
            style={{ width: '100%' }}
            value={industryId ?? undefined}
            onChange={onChange}
            placeholder="Pick an industry"
            optionFilterProp="label"
            options={industries.map((i) => ({ value: i.id, label: i.name }))}
          />
        )}
      </div>

      {industryId == null ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No active industries to preview against."
        />
      ) : error ? (
        <Alert type="error" showIcon message="Could not load the preview." />
      ) : isLoading ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin />
        </div>
      ) : sections.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Nothing shows below the grid on this page yet."
        />
      ) : (
        <Spin spinning={isFetching} size="small">
          {sections.map((s, idx) => {
            const items = sectionItems(s).filter((it) => isTrue(it.is_active ?? 1));
            return (
              <div key={s.uid || s.section_key || idx}>
                {idx > 0 && <Divider style={{ margin: '12px 0' }} />}
                <Space size={6} wrap style={{ marginBottom: 4 }}>
                  {s.eyebrow && <Tag color="gold">{s.eyebrow}</Tag>}
                  <Tag color={s.inherited ? 'default' : 'blue'} style={{ marginRight: 0 }}>
                    {s.inherited ? 'default' : 'custom'}
                  </Tag>
                </Space>
                {s.heading && (
                  <Title level={5} style={{ margin: '4px 0' }}>
                    {s.heading}
                  </Title>
                )}
                {s.subheading && (
                  <Paragraph type="secondary" style={{ marginBottom: 6, whiteSpace: 'pre-wrap' }}>
                    {s.subheading}
                  </Paragraph>
                )}
                {s.image_s3_key && (
                  <div style={{ marginBottom: 6 }}>
                    <ImageThumb k={s.image_s3_key} size={80} alt={s.section_key} />
                  </div>
                )}
                {items.length > 0 && (
                  <ol style={{ margin: 0, paddingLeft: 20 }}>
                    {items.map((it, i) => (
                      <li key={it.uid || i} style={{ marginBottom: 4 }}>
                        <Space size={6} align="start">
                          {it.icon_s3_key && (
                            <ImageThumb k={it.icon_s3_key} size={18} alt={it.title || ''} />
                          )}
                          <span>
                            {it.title && <Text strong>{it.title}</Text>}
                            {it.title && it.body ? ' — ' : ''}
                            {it.body && <Text type="secondary">{it.body}</Text>}
                          </span>
                        </Space>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            );
          })}
        </Spin>
      )}
    </div>
  );
}
