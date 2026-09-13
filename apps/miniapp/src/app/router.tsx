import { createBrowserRouter } from 'react-router-dom';
import { RootLayout } from './RootLayout';
import { PlaceholderScreen } from './PlaceholderScreen';
import { ProfileScreen } from '@/features/profile/ProfileScreen';
import { NotificationsScreen } from '@/features/profile/NotificationsScreen';
import { InviteScreen } from '@/features/invite/InviteScreen';
import { WorkspacePicker } from '@/features/workspace/WorkspacePicker';
import { WorkspaceScreen } from '@/features/workspace/WorkspaceScreen';
import { StartActionRedirect } from './StartActionRedirect';
import { CourseMapRoute, LearningEntryScreen } from '@/features/learning/CourseMapScreen';
import { StageScreen } from '@/features/learning/StageScreen';
import { LessonScreen } from '@/features/learning/LessonScreen';
import { AssignmentScreen } from '@/features/learning/AssignmentScreen';
import { SubmissionEditorScreen } from '@/features/learning/SubmissionEditorScreen';
import { ReviewQueueScreen } from '@/features/curator/ReviewQueueScreen';
import { ReviewScreen } from '@/features/curator/ReviewScreen';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <StartActionRedirect /> },
      { path: 'learning', element: <LearningEntryScreen /> },
      { path: 'learning/:enrollmentId', element: <CourseMapRoute /> },
      { path: 'learning/:enrollmentId/stages/:stageKey', element: <StageScreen /> },
      { path: 'learning/:enrollmentId/lessons/:lessonKey', element: <LessonScreen /> },
      {
        path: 'learning/:enrollmentId/assignments/:assignmentKey',
        element: <AssignmentScreen />,
      },
      {
        path: 'learning/:enrollmentId/submissions/:submissionId/edit',
        element: <SubmissionEditorScreen />,
      },
      { path: 'curator', element: <ReviewQueueScreen /> },
      { path: 'curator/submissions/:submissionId', element: <ReviewScreen /> },
      {
        path: 'learning/:enrollmentId/exams/:examKey',
        element: <PlaceholderScreen title="Экзамен" hint="Появится на этапе 8" />,
      },
      { path: 'workspace', element: <WorkspacePicker /> },
      { path: 'workspace/:workspaceId', element: <WorkspaceScreen /> },
      { path: 'profile', element: <ProfileScreen /> },
      { path: 'profile/notifications', element: <NotificationsScreen /> },
      { path: 'invite/:token', element: <InviteScreen /> },
      { path: '*', element: <PlaceholderScreen title="Страница не найдена" /> },
    ],
  },
]);
