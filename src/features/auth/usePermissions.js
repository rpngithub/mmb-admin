import { useMemo } from 'react';
import { useAppSelector } from '../../app/hooks';
import { selectPermissions } from './authSlice';
import { hasPermission, canRead } from './permissions';

/**
 * Hook exposing permission checks bound to the current admin's JWT claims.
 */
export function usePermissions() {
  const permissions = useAppSelector(selectPermissions);
  return useMemo(
    () => ({
      permissions,
      can: (domain, action) => hasPermission(permissions, domain, action),
      canRead: (domain) => canRead(permissions, domain),
    }),
    [permissions],
  );
}
