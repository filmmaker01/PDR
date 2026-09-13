import { createBrowserRouter } from 'react-router-dom';
import { RootLayout } from './RootLayout';
import { PlaceholderScreen } from './PlaceholderScreen';
import { ProfileScreen } from '@/features/profile/ProfileScreen';
import { InviteScreen } from '@/features/invite/InviteScreen';
import { WorkspacePicker } from '@/features/workspace/WorkspacePicker';
import { WorkspaceScreen } from '@/features/workspace/WorkspaceScreen';
import { StartActionRedirect } from './StartActionRedirect';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <StartActionRedirect /> },
      {
        path: 'learning',
        element: <PlaceholderScreen title="Обучение" hint="Раздел появится на этапе 6" />,
      },
      { path: 'workspace', element: <WorkspacePicker /> },
      { path: 'workspace/:workspaceId', element: <WorkspaceScreen /> },
      { path: 'profile', element: <ProfileScreen /> },
      { path: 'invite/:token', element: <InviteScreen /> },
      { path: '*', element: <PlaceholderScreen title="Страница не найдена" /> },
    ],
  },
]);
