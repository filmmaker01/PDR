import { createBrowserRouter } from 'react-router-dom';
import { RootLayout } from './RootLayout';
import { PlaceholderScreen } from './PlaceholderScreen';
import { ProfileScreen } from '@/features/profile/ProfileScreen';
import { NotificationsScreen } from '@/features/profile/NotificationsScreen';
import { InviteScreen } from '@/features/invite/InviteScreen';
import { ClubScreen } from '@/features/club/ClubScreen';
import { WorkspacePicker } from '@/features/workspace/WorkspacePicker';
import { WorkspaceLayout } from '@/features/crm/WorkspaceLayout';
import { TodayScreen } from '@/features/crm/TodayScreen';
import { CalendarScreen } from '@/features/crm/CalendarScreen';
import { OrdersScreen } from '@/features/crm/OrdersScreen';
import { OrderScreen } from '@/features/crm/OrderScreen';
import { NewOrderScreen } from '@/features/crm/NewOrderScreen';
import { ClientScreen, ClientsScreen, VehicleScreen } from '@/features/crm/ClientsScreen';
import { DebtsScreen } from '@/features/crm/DebtsScreen';
import { WorkspaceSettingsScreen } from '@/features/crm/WorkspaceSettingsScreen';
import { PriceListScreen } from '@/features/crm/PriceListScreen';
import { PaymentJournalScreen } from '@/features/crm/PaymentJournalScreen';
import { AnalyticsScreen } from '@/features/crm/AnalyticsScreen';
import { EmployeesScreen } from '@/features/crm/EmployeesScreen';
import { WorkspaceAuditScreen } from '@/features/crm/WorkspaceAuditScreen';
import { EstimateEditorScreen } from '@/features/crm/EstimateEditorScreen';
import { StartActionRedirect } from './StartActionRedirect';
import { CourseMapRoute, LearningEntryScreen } from '@/features/learning/CourseMapScreen';
import { StageScreen } from '@/features/learning/StageScreen';
import { LessonScreen } from '@/features/learning/LessonScreen';
import { AssignmentScreen } from '@/features/learning/AssignmentScreen';
import { SubmissionEditorScreen } from '@/features/learning/SubmissionEditorScreen';
import { ExamScreen } from '@/features/learning/ExamScreen';
import { AttemptScreen } from '@/features/learning/AttemptScreen';
import { AttemptResultScreen } from '@/features/learning/AttemptResultScreen';
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
      { path: 'learning/:enrollmentId/exams/:examKey', element: <ExamScreen /> },
      { path: 'learning/:enrollmentId/attempts/:attemptId', element: <AttemptScreen /> },
      {
        path: 'learning/:enrollmentId/attempts/:attemptId/result',
        element: <AttemptResultScreen />,
      },
      { path: 'workspace', element: <WorkspacePicker /> },
      {
        path: 'workspace/:workspaceId',
        element: <WorkspaceLayout />,
        children: [
          { index: true, element: <TodayScreen /> },
          { path: 'today', element: <TodayScreen /> },
          { path: 'calendar', element: <CalendarScreen /> },
          { path: 'orders', element: <OrdersScreen /> },
          { path: 'clients', element: <ClientsScreen /> },
          { path: 'settings', element: <WorkspaceSettingsScreen /> },
        ],
      },
      { path: 'workspace/:workspaceId/orders/new', element: <NewOrderScreen /> },
      { path: 'workspace/:workspaceId/orders/:orderId', element: <OrderScreen /> },
      { path: 'workspace/:workspaceId/clients/:clientId', element: <ClientScreen /> },
      { path: 'workspace/:workspaceId/vehicles/:vehicleId', element: <VehicleScreen /> },
      { path: 'workspace/:workspaceId/debts', element: <DebtsScreen /> },
      { path: 'workspace/:workspaceId/price-list', element: <PriceListScreen /> },
      { path: 'workspace/:workspaceId/payments', element: <PaymentJournalScreen /> },
      { path: 'workspace/:workspaceId/analytics', element: <AnalyticsScreen /> },
      { path: 'workspace/:workspaceId/members', element: <EmployeesScreen /> },
      { path: 'workspace/:workspaceId/audit', element: <WorkspaceAuditScreen /> },
      { path: 'workspace/:workspaceId/estimates/:estimateId', element: <EstimateEditorScreen /> },
      { path: 'club', element: <ClubScreen /> },
      { path: 'profile', element: <ProfileScreen /> },
      { path: 'profile/notifications', element: <NotificationsScreen /> },
      { path: 'invite/:token', element: <InviteScreen /> },
      { path: '*', element: <PlaceholderScreen title="Страница не найдена" /> },
    ],
  },
]);
