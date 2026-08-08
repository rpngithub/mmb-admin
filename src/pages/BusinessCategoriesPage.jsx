import { useState } from 'react';
import { Tabs, Badge } from 'antd';
import CategoriesManager from '../components/CategoriesManager';
import IndustrySuggestionsQueue from '../components/IndustrySuggestionsQueue';
import { useBusinessCategoriesFilteredQuery } from '../features/api/adminApi';

/**
 * Industries, plus the moderation queue for the ones users suggested at signup.
 * The queue is a tab rather than its own menu item, with the pending count on the
 * label — a queue nobody notices is a queue nobody works.
 */
export default function BusinessCategoriesPage() {
  const [tab, setTab] = useState('industries');

  // Cheap enough to keep live on both tabs: it drives the count badge.
  const { data: pending } = useBusinessCategoriesFilteredQuery({ status: 'pending' });
  const pendingCount = (pending || []).length;

  return (
    <Tabs
      activeKey={tab}
      onChange={setTab}
      destroyInactiveTabPane
      items={[
        {
          key: 'industries',
          label: 'Industries',
          children: (
            <CategoriesManager
              resourceKey="businessCategories"
              singular="Industry"
              plural="Industries"
              permission="categories"
              iconSlot="business_category_icon"
              thumbnailSlot="business_category_thumbnail"
              hasTags
              hasRelated
              hasStatus
              deleteNote="Businesses/products in this industry will have their industry cleared (set to NULL); tag links are removed."
            />
          ),
        },
        {
          key: 'suggestions',
          label: (
            <span>
              Pending suggestions{' '}
              <Badge
                count={pendingCount}
                style={{ marginLeft: 4 }}
                showZero={false}
                overflowCount={99}
              />
            </span>
          ),
          children: <IndustrySuggestionsQueue />,
        },
      ]}
    />
  );
}
