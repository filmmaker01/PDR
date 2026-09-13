import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AdminLayout } from './AdminLayout';
import { PlaceholderPage } from './PlaceholderPage';
import { UsersPage } from '@/features/users/UsersPage';
import { AccessPage } from '@/features/access/AccessPage';
import { WorkspacesPage } from '@/features/workspaces/WorkspacesPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AdminLayout />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <PlaceholderPage title="Дашборд" stage="этап 4" /> },
      { path: 'users', element: <UsersPage /> },
      { path: 'access', element: <AccessPage /> },
      { path: 'workspaces', element: <WorkspacesPage /> },
      { path: '*', element: <PlaceholderPage title="Страница не найдена" /> },
    ],
  },
]);
