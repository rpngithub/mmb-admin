import { useMemo } from 'react';
import { Layout, Menu, Button, Dropdown, Avatar, Typography, Grid, theme as antdTheme } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LogoutOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { selectSiderCollapsed, setSiderCollapsed, toggleSider } from '../features/ui/uiSlice';
import { logout, selectIdentity } from '../features/auth/authSlice';
import { usePermissions } from '../features/auth/usePermissions';
import { useLogoutMutation } from '../features/api/adminApi';
import { buildMenu } from '../navigation';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;
const { useBreakpoint } = Grid;

export default function AppLayout() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const screens = useBreakpoint();
  const collapsed = useAppSelector(selectSiderCollapsed);
  const identity = useAppSelector(selectIdentity);
  const perms = usePermissions();
  const [logoutApi] = useLogoutMutation();
  const {
    token: { colorBgContainer, colorBorderSecondary },
  } = antdTheme.useToken();

  const menuItems = useMemo(() => buildMenu(perms.canRead), [perms]);

  // Highlight the deepest matching key; open the group that contains it.
  const selectedKey = location.pathname;
  const openKeys = useMemo(() => {
    const match = menuItems
      .filter((i) => i.children)
      .find((g) => g.children.some((c) => c.key === selectedKey));
    return match ? [match.key] : [];
  }, [menuItems, selectedKey]);

  const handleMenuClick = ({ key }) => {
    if (key.startsWith('group:')) return;
    navigate(key);
  };

  const handleLogout = async () => {
    try {
      await logoutApi().unwrap();
    } catch {
      /* revoke best-effort — clear locally regardless */
    }
    dispatch(logout());
    navigate('/login', { replace: true });
  };

  const userMenu = {
    items: [
      { key: 'email', label: identity.email || identity.name, disabled: true },
      { type: 'divider' },
      { key: 'logout', icon: <LogoutOutlined />, label: 'Log out' },
    ],
    onClick: ({ key }) => key === 'logout' && handleLogout(),
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={(value) => dispatch(setSiderCollapsed(value))}
        breakpoint="lg"
        collapsedWidth={screens.xs ? 0 : 80}
        trigger={null}
        theme="dark"
        width={230}
        style={{ overflow: 'auto', height: '100vh', position: 'sticky', top: 0, left: 0 }}
      >
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: collapsed ? '0 16px' : '0 20px',
          }}
        >
          <img
            src={collapsed ? '/favicon-32x32.png' : '/mmb-logo-white.svg'}
            alt="MakeMyBrand"
            style={{
              height: collapsed ? 28 : 32,
              width: 'auto',
              maxWidth: '100%',
              display: 'block',
            }}
          />
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={openKeys}
          items={menuItems}
          onClick={handleMenuClick}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            padding: '0 16px',
            background: colorBgContainer,
            borderBottom: `1px solid ${colorBorderSecondary}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => dispatch(toggleSider())}
            style={{ fontSize: 18 }}
          />
          <Dropdown menu={userMenu} trigger={['click']}>
            <Button type="text" style={{ height: 48 }}>
              <Avatar size="small" icon={<UserOutlined />} />
              <Text strong style={{ marginLeft: 8 }}>
                {identity.name}
              </Text>
            </Button>
          </Dropdown>
        </Header>

        <Content style={{ margin: 16 }}>
          <div
            style={{
              padding: 24,
              minHeight: 'calc(100vh - 88px)',
              background: colorBgContainer,
              borderRadius: 8,
            }}
          >
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
