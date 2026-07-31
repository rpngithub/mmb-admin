import { Result, Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import { usePermissions } from './usePermissions';

/**
 * Gate a route by read permission on a domain. Even though the sidebar hides
 * sections the admin can't read, a direct URL still needs guarding.
 */
export default function RequirePermission({ domain, children }) {
  const perms = usePermissions();
  const navigate = useNavigate();

  if (domain && !perms.canRead(domain)) {
    return (
      <Result
        status="403"
        title="403"
        subTitle="You don't have permission to view this section."
        extra={
          <Button type="primary" onClick={() => navigate('/')}>
            Back to dashboard
          </Button>
        }
      />
    );
  }
  return children;
}
