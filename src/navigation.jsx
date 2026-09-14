import {
  DashboardOutlined,
  TeamOutlined,
  SafetyCertificateOutlined,
  AppstoreOutlined,
  FileImageOutlined,
  TagsOutlined,
  PictureOutlined,
  ReadOutlined,
  CreditCardOutlined,
  SettingOutlined,
  AuditOutlined,
  ImportOutlined,
  BgColorsOutlined,
  BulbOutlined,
  TrophyOutlined,
  SkinOutlined,
  GlobalOutlined,
  FontSizeOutlined,
  SmileOutlined,
  BorderOuterOutlined,
  ThunderboltOutlined,
  BellOutlined,
  NotificationOutlined,
  SendOutlined,
  InboxOutlined,
  LayoutOutlined,
} from '@ant-design/icons';
import { RESOURCES } from './resources';

const GROUP_META = {
  People: { icon: <TeamOutlined /> },
  Access: { icon: <SafetyCertificateOutlined /> },
  Catalog: { icon: <AppstoreOutlined /> },
  Content: { icon: <PictureOutlined /> },
  Notifications: { icon: <BellOutlined /> },
  Billing: { icon: <CreditCardOutlined /> },
  System: { icon: <SettingOutlined /> },
  Audit: { icon: <AuditOutlined /> },
};

const GROUP_ORDER = [
  'People',
  'Access',
  'Catalog',
  'Content',
  'Notifications',
  'Billing',
  'System',
  'Audit',
];

const ICON_BY_KEY = {
  roles: <SafetyCertificateOutlined />,
  tags: <TagsOutlined />,
  faqs: <ReadOutlined />,
  faqCategories: <ReadOutlined />,
  variants: <SkinOutlined />,
  colors: <BgColorsOutlined />,
  stylePersonalities: <BulbOutlined />,
  variantBadges: <TrophyOutlined />,
  languages: <GlobalOutlined />,
  fonts: <FontSizeOutlined />,
};

/**
 * Special (non-generic) sections: route path, permission domain, sidebar group.
 */
const SPECIAL_ITEMS = [
  { key: '/users', label: 'Users', permission: 'users', group: 'People', icon: <TeamOutlined /> },
  {
    key: '/admins',
    label: 'Admins',
    permission: 'admins',
    group: 'People',
    icon: <SafetyCertificateOutlined />,
  },
  {
    key: '/templates',
    label: 'Templates',
    permission: 'templates',
    group: 'Catalog',
    icon: <FileImageOutlined />,
  },
  // Frames (the branded borders users buy one at a time) and the store's
  // category chips — one permission domain, two screens.
  {
    key: '/frames',
    label: 'Frames',
    permission: 'frames',
    group: 'Catalog',
    icon: <BorderOuterOutlined />,
  },
  {
    key: '/frame-categories',
    label: 'Frame Categories',
    permission: 'frames',
    group: 'Catalog',
    icon: <AppstoreOutlined />,
  },
  // Top-up packs sit under Billing, not Catalog: they are priced commerce, and
  // `quota_packs` is a permission a content admin does not hold.
  {
    key: '/quota-packs',
    label: 'Top-up Packs',
    permission: 'quota_packs',
    group: 'Billing',
    icon: <ThunderboltOutlined />,
  },
  {
    key: '/homepage-categories',
    label: 'Homepage Categories',
    permission: 'categories',
    group: 'Catalog',
    icon: <AppstoreOutlined />,
  },
  // The marketing copy under the template grid on every industry's website
  // page: shared defaults plus per-industry overrides, one block at a time.
  {
    key: '/page-content',
    label: 'Page Content',
    permission: 'page_content',
    group: 'Content',
    icon: <LayoutOutlined />,
  },
  {
    key: '/bulk-import',
    label: 'Bulk Import',
    // Visible if the admin can read ANY importable entity (categories or variants).
    anyPermission: ['categories', 'variants'],
    group: 'Catalog',
    icon: <ImportOutlined />,
  },
  // Notifications. The first three run on `notifications` (content_admin holds
  // it); Campaigns runs on `notification_campaigns`, which only super_admin has
  // — so for a content_admin that one item simply isn't there, rather than
  // clicking through to a screen every request 403s on.
  {
    key: '/notification-templates',
    label: 'Notifications',
    permission: 'notifications',
    group: 'Notifications',
    icon: <NotificationOutlined />,
  },
  {
    key: '/notification-categories',
    label: 'Categories',
    permission: 'notifications',
    group: 'Notifications',
    icon: <AppstoreOutlined />,
  },
  {
    key: '/notification-campaigns',
    label: 'Campaigns',
    permission: 'notification_campaigns',
    group: 'Notifications',
    icon: <SendOutlined />,
  },
  {
    key: '/notification-log',
    label: 'Delivery Log',
    permission: 'notifications',
    group: 'Notifications',
    icon: <InboxOutlined />,
  },
  {
    key: '/activity-logs',
    label: 'Activity Logs',
    permission: 'activity',
    group: 'Audit',
    icon: <AuditOutlined />,
  },
  // `feedback` is super_admin-only on the backend because every row carries the
  // submitter's name, phone and email — so for most admins this item simply
  // isn't there.
  {
    key: '/feedback',
    label: 'Feedback',
    permission: 'feedback',
    group: 'People',
    icon: <SmileOutlined />,
  },
];

/**
 * Full list of nav items (special + generic resources), each tagged with its
 * group, permission and route. The router derives its routes from this too.
 */
export function getNavItems() {
  const generic = RESOURCES.filter((r) => !r.hidden).map((r) => ({
    key: `/r/${r.key}`,
    label: r.name,
    permission: r.permission,
    group: r.group || 'System',
    icon: ICON_BY_KEY[r.key] || GROUP_META[r.group]?.icon || <AppstoreOutlined />,
    resourceKey: r.key,
  }));
  return [...SPECIAL_ITEMS, ...generic];
}

/**
 * Build AntD Menu items grouped by section, filtered by readable permission.
 */
export function buildMenu(canRead) {
  const items = getNavItems().filter((i) =>
    i.anyPermission ? i.anyPermission.some((p) => canRead(p)) : canRead(i.permission),
  );

  const top = [{ key: '/', label: 'Dashboard', icon: <DashboardOutlined /> }];

  const groups = GROUP_ORDER.map((group) => {
    const children = items
      .filter((i) => i.group === group)
      .map((i) => ({ key: i.key, label: i.label, icon: i.icon }));
    if (children.length === 0) return null;
    return {
      key: `group:${group}`,
      label: group,
      icon: GROUP_META[group]?.icon,
      children,
    };
  }).filter(Boolean);

  return [...top, ...groups];
}
