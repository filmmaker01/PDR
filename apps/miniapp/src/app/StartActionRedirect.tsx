import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';
import { readLastWorkspace } from '@/features/workspace/lastWorkspace';

/**
 * Приглашение из ссылки — с любого экрана, а не только с корня.
 *
 * Telegram открывает Mini App по-разному: по ссылке `t.me/<бот>/app` — с
 * корня, а как «главное» приложение бота или из кнопки меню — по адресу,
 * который прописан у бота. Раньше приглашение подхватывал только корневой
 * маршрут, и человек, открывший ссылку не тем путём, попадал в «У вас пока
 * нет мастерской», хотя код приглашения пришёл.
 */
export function PendingInviteRedirect() {
  const { startAction } = useAuth();
  const { pathname } = useLocation();
  if (!startAction?.startsWith('inv_') || pathname.startsWith('/invite/')) return null;
  return <Navigate to={`/invite/${startAction.slice('inv_'.length)}`} replace />;
}

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
