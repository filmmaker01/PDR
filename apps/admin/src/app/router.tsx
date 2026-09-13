import { createBrowserRouter } from 'react-router-dom';
import { AdminLayout } from './AdminLayout';
import { HomeRedirect } from './HomeRedirect';
import { PlaceholderPage } from './PlaceholderPage';
import { UsersPage } from '@/features/users/UsersPage';
import { AccessPage } from '@/features/access/AccessPage';
import { WorkspacesPage } from '@/features/workspaces/WorkspacesPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { AuditPage } from '@/features/audit/AuditPage';
import { CoursesPage } from '@/features/course/CoursesPage';
import { CourseEditorPage } from '@/features/course/CourseEditorPage';
import { VideosPage } from '@/features/course/VideosPage';
import { CohortsPage } from '@/features/students/CohortsPage';
import { CohortPage } from '@/features/students/CohortPage';
import { StudentsPage } from '@/features/students/StudentsPage';
import { StudentCardPage } from '@/features/students/StudentCardPage';
import { ReviewQueuePage } from '@/features/reviews/ReviewQueuePage';
import { ReviewPage } from '@/features/reviews/ReviewPage';
import { ExamGradingPage, ExamQueuePage } from '@/features/reviews/ExamQueuePage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AdminLayout />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'courses', element: <CoursesPage /> },
      { path: 'course/:versionId', element: <CourseEditorPage /> },
      { path: 'videos', element: <VideosPage /> },
      { path: 'cohorts', element: <CohortsPage /> },
      { path: 'cohorts/:cohortId', element: <CohortPage /> },
      { path: 'reviews', element: <ReviewQueuePage /> },
      { path: 'reviews/:submissionId', element: <ReviewPage /> },
      { path: 'exam-reviews', element: <ExamQueuePage /> },
      { path: 'exam-reviews/:attemptId', element: <ExamGradingPage /> },
      { path: 'students', element: <StudentsPage /> },
      { path: 'students/:enrollmentId', element: <StudentCardPage /> },
      { path: 'users', element: <UsersPage /> },
      { path: 'access', element: <AccessPage /> },
      { path: 'workspaces', element: <WorkspacesPage /> },
      { path: '*', element: <PlaceholderPage title="Страница не найдена" /> },
    ],
  },
]);
