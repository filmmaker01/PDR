import { Navigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';
import { readLastWorkspace } from '@/features/workspace/lastWorkspace';

/**
 * Начальный экран: сначала действие из deep-link, затем последний
 * использованный раздел, иначе — доступный пользователю.
 */
export function StartActionRedirect() {
  const { startAction, me } = useAuth();

  if (startAction?.startsWith('inv_')) {
    return <Navigate to={`/invite/${startAction.slice('inv_'.length)}`} replace />;
  }

  const remembered = readLastWorkspace();
  if (remembered && me?.workspaces.some((w) => w.id === remembered)) {
    return <Navigate to={`/workspace/${remembered}`} replace />;
  }
  if (me && me.enrollments.length > 0) return <Navigate to="/learning" replace />;
  if (me && me.workspaces.length > 0) return <Navigate to="/workspace" replace />;
  return <Navigate to="/profile" replace />;
}
