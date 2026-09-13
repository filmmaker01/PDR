import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import { AuthGate } from '@/features/auth/AuthGate';

const TABS = [
  { to: '/learning', label: 'Обучение', icon: '🎓' },
  { to: '/workspace', label: 'Мастерская', icon: '🔧' },
  { to: '/profile', label: 'Профиль', icon: '👤' },
];

export function RootLayout() {
  return (
    <AuthGate>
      <div className="app-shell">
        <main className="app-content pdr-page">
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
    </AuthGate>
  );
}
