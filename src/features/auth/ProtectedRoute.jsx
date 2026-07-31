import { Navigate, useLocation } from 'react-router-dom';
import { useAppSelector } from '../../app/hooks';
import { selectIsAuthenticated } from './authSlice';

/**
 * Route guard — bounces unauthenticated users to /login, preserving the
 * attempted location so they return there after signing in.
 */
export default function ProtectedRoute({ children }) {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}
