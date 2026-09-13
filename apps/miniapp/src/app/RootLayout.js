import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
const TABS = [
    { to: '/learning', label: 'Обучение', icon: '🎓' },
    { to: '/workspace', label: 'Мастерская', icon: '🔧' },
    { to: '/profile', label: 'Профиль', icon: '👤' },
];
export function RootLayout() {
    return (_jsxs("div", { className: "app-shell", children: [_jsx("main", { className: "app-content pdr-page", children: _jsx(Outlet, {}) }), _jsx("nav", { className: "pdr-tabbar", children: TABS.map((tab) => (_jsxs(NavLink, { to: tab.to, className: ({ isActive }) => clsx('pdr-tabbar__item', isActive && 'pdr-tabbar__item--active'), children: [_jsx("span", { style: { fontSize: 18 }, "aria-hidden": true, children: tab.icon }), tab.label] }, tab.to))) })] }));
}
//# sourceMappingURL=RootLayout.js.map