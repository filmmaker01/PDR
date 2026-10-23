import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import clsx from 'clsx';
import type { ComponentType } from 'react';
import { Card, SkeletonList } from '@pdr/ui';
import { useMe } from '@/features/auth/AuthProvider';
import { rememberWorkspace } from '@/features/workspace/lastWorkspace';
import { useEffect } from 'react';
import { useWorkspace } from './api';
import {
  IconBell,
  IconCalendar,
  IconCar,
  IconClients,
  IconGear,
  IconMore,
  IconToday,
} from './Icons';

/**
 * Разделы мастерской: пять самых частых. Остальное — обращения, прайс,
 * оплаты, аналитика, сотрудники, журналы — живёт в «Ещё», ничего не удалено.
 * `also` — разделы, при которых подсвечивается эта вкладка.
 */
const TABS: {
  to: string;
  label: string;
  Icon: ComponentType<{ size?: number }>;
  also?: string[];
}[] = [
  { to: 'today', label: 'Сегодня', Icon: IconToday, also: [''] },
  { to: 'orders', label: 'Заказы', Icon: IconCar },
  { to: 'calendar', label: 'Календарь', Icon: IconCalendar },
  { to: 'clients', label: 'Клиенты', Icon: IconClients },
  { to: 'settings', label: 'Ещё', Icon: IconMore, also: ['leads'] },
];

/** Общий каркас раздела «Мастерская»: подвкладки и проверка доступа. */
export function WorkspaceLayout() {
  const { workspaceId = '' } = useParams();
  const me = useMe();
  const workspace = useWorkspace(workspaceId);
  const location = useLocation();
  // Раздел после /workspace/:id — для подсветки вкладки, которой нет в URL.
  const section = location.pathname.split('/')[3] ?? '';

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
    <div className="pdr-stack ws-stack">
      {/* Шапка в одну строку: название, роль и два значка — без лишней высоты,
          чтобы записи и заказы были видны уже на первом экране. */}
      <header className="ws-header">
        <span className="ws-header__title">
          <h1 className="ws-header__name">{workspace.data?.name ?? membership.name}</h1>
          <span className="pdr-hint">
            {membership.role === 'owner' ? 'Владелец' : 'Сотрудник'}
            {workspace.data && !workspace.data.access.active ? ' · доступ завершён' : ''}
          </span>
        </span>
        <Link to="/profile/notifications" className="ws-icon-btn" aria-label="Уведомления">
          <IconBell />
        </Link>
        <Link
          to={`/workspace/${workspaceId}/settings`}
          className="ws-icon-btn"
          aria-label="Настройки мастерской"
        >
          <IconGear />
        </Link>
      </header>

      {workspace.data && !workspace.data.access.active ? (
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Доступ к CRM завершён</div>
          <div className="pdr-hint">
            Данные сохранены и доступны для просмотра. Чтобы снова вести заказы, продлите доступ у
            администратора.
          </div>
        </Card>
      ) : null}

      <nav className="ws-nav" aria-label="Разделы мастерской">
        {TABS.map(({ to, label, Icon, also }) => (
          <NavLink
            key={to}
            to={`/workspace/${workspaceId}/${to}`}
            className={({ isActive }) =>
              clsx('ws-nav__item', (isActive || also?.includes(section)) && 'ws-nav__item--active')
            }
          >
            <Icon size={22} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
