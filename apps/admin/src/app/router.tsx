import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AdminLayout } from './AdminLayout';
import { PlaceholderPage } from './PlaceholderPage';
import { UsersPage } from '@/features/users/UsersPage';
import { AccessPage } from '@/features/access/AccessPage';
import { WorkspacesPage } from '@/features/workspaces/WorkspacesPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { AuditPage } from '@/features/audit/AuditPage';
import { CoursesPage } from '@/features/course/CoursesPage';
import { CourseEditorPage } from '@/features/course/CourseEditorPage';
import { VideosPage } from '@/features/course/VideosPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AdminLayout />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'courses', element: <CoursesPage /> },
      { path: 'course/:versionId', element: <CourseEditorPage /> },
      { path: 'videos', element: <VideosPage /> },
      { path: 'users', element: <UsersPage /> },
      { path: 'access', element: <AccessPage /> },
      { path: 'workspaces', element: <WorkspacesPage /> },
      { path: '*', element: <PlaceholderPage title="Страница не найдена" /> },
    ],
  },
]);
