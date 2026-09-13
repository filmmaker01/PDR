import { Navigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';

/** Куратор без прав администратора начинает с очереди проверок. */
export function HomeRedirect() {
  const { isAdmin } = useAuth();
  return <Navigate to={isAdmin ? '/dashboard' : '/reviews'} replace />;
}
