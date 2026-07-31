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
} from '@ant-design/icons';
import { RESOURCES } from './resources';

const GROUP_META = {
  People: { icon: <TeamOutlined /> },
  Access: { icon: <SafetyCertificateOutlined /> },
  Catalog: { icon: <AppstoreOutlined /> },
  Content: { icon: <PictureOutlined /> },
  Billing: { icon: <CreditCardOutlined /> },
  System: { icon: <SettingOutlined /> },
  Audit: { icon: <AuditOutlined /> },
};

const GROUP_ORDER = ['People', 'Access', 'Catalog', 'Content', 'Billing', 'System', 'Audit'];

const ICON_BY_KEY = {
  roles: <SafetyCertificateOutlined />,
  tags: <TagsOutlined />,
  faqs: <ReadOutlined />,
  faqCategories: <ReadOutlined />,
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
  {
    key: '/homepage-categories',
    label: 'Homepage Categories',
    permission: 'categories',
    group: 'Catalog',
    icon: <AppstoreOutlined />,
  },
  {
    key: '/bulk-import',
    label: 'Bulk Import',
    // Visible if the admin can read ANY importable entity (categories or themes).
    anyPermission: ['categories', 'themes'],
    group: 'Catalog',
    icon: <ImportOutlined />,
  },
  {
    key: '/activity-logs',
    label: 'Activity Logs',
    permission: 'activity',
    group: 'Audit',
    icon: <AuditOutlined />,
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
