import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AdminLayout } from './AdminLayout';
import { PlaceholderPage } from './PlaceholderPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AdminLayout />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <PlaceholderPage title="Дашборд" stage="этап 4" /> },
      { path: '*', element: <PlaceholderPage title="Страница не найдена" /> },
    ],
  },
]);
