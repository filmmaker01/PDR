import { NavLink, Outlet, ScrollRestoration, useMatches } from 'react-router-dom';
import clsx from 'clsx';
import { AuthGate } from '@/features/auth/AuthGate';
import { BackBar, isBackHandle } from '@/shared/navigation';

const TABS = [
  { to: '/learning', label: 'Обучение', icon: '🎓' },
  { to: '/workspace', label: 'Мастерская', icon: '🔧' },
  { to: '/profile', label: 'Профиль', icon: '👤' },
];

export function RootLayout() {
  // Самый глубокий маршрут с обработчиком «назад» — текущий внутренний экран.
  const matches = useMatches();
  const inner = [...matches].reverse().find((match) => isBackHandle(match.handle));
  const fallback = inner && isBackHandle(inner.handle) ? inner.handle.back(inner.params) : null;

  return (
    <AuthGate>
      <div className="app-shell">
        <main className="app-content pdr-page">
          {fallback ? <BackBar fallback={fallback} /> : null}
          <Outlet />
        </main>
        <nav className="pdr-tabbar">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                clsx('pdr-tabbar__item', isActive && 'pdr-tabbar__item--active')
              }
            >
              <span style={{ fontSize: 18 }} aria-hidden>
                {tab.icon}
              </span>
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
      {/* Вернувшись «Назад» в список, мастер оказывается там же, где был. */}
      <ScrollRestoration />
    </AuthGate>
  );
}
