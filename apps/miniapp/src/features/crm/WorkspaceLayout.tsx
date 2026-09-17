import { NavLink, Outlet, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { Card, SkeletonList } from '@pdr/ui';
import { useMe } from '@/features/auth/AuthProvider';
import { rememberWorkspace } from '@/features/workspace/lastWorkspace';
import { useEffect } from 'react';
import { useWorkspace } from './api';

const TABS = [
  { to: 'today', label: 'Сегодня' },
  { to: 'calendar', label: 'Календарь' },
  { to: 'leads', label: 'Обращения' },
  { to: 'orders', label: 'Заказы' },
  { to: 'clients', label: 'Клиенты' },
  { to: 'settings', label: 'Ещё' },
];

/** Общий каркас раздела «Мастерская»: подвкладки и проверка доступа. */
export function WorkspaceLayout() {
  const { workspaceId = '' } = useParams();
  const me = useMe();
  const workspace = useWorkspace(workspaceId);

  useEffect(() => {
    if (workspace.data) rememberWorkspace(workspaceId);
  }, [workspace.data, workspaceId]);

  const membership = me.workspaces.find((w) => w.id === workspaceId);

  if (!membership) {
    return (
      <Card>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Мастерская недоступна</div>
        <div className="pdr-hint">
          Возможно, вас исключили из мастерской или ссылка ведёт на чужую.
        </div>
      </Card>
    );
  }

  if (workspace.isLoading) return <SkeletonList rows={4} />;

  return (
    <div className="pdr-stack">
      <div className="pdr-row">
        <span className="pdr-grow">
          <h1 className="pdr-title" style={{ marginBottom: 0 }}>
            {workspace.data?.name ?? membership.name}
          </h1>
          <span className="pdr-hint">
            {membership.role === 'owner' ? 'Владелец' : 'Сотрудник'}
            {workspace.data && !workspace.data.access.active ? ' · доступ завершён' : ''}
          </span>
        </span>
      </div>

      {workspace.data && !workspace.data.access.active ? (
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Доступ к CRM завершён</div>
          <div className="pdr-hint">
            Данные сохранены и доступны для просмотра. Чтобы снова вести заказы, продлите доступ у
            администратора.
          </div>
        </Card>
      ) : null}

      <nav className="pdr-tabs">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={`/workspace/${workspaceId}/${tab.to}`}
            className={({ isActive }) => clsx('pdr-tab', isActive && 'pdr-tab--active')}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
