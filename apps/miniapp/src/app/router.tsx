import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RootLayout } from './RootLayout';
import { PlaceholderScreen } from './PlaceholderScreen';
import { ProfileScreen } from '@/features/profile/ProfileScreen';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <Navigate to="/profile" replace /> },
      {
        path: 'learning',
        element: <PlaceholderScreen title="Обучение" hint="Раздел появится на этапе 6" />,
      },
      {
        path: 'workspace',
        element: <PlaceholderScreen title="Мастерская" hint="Раздел появится на этапе 9" />,
      },
      { path: 'profile', element: <ProfileScreen /> },
      { path: '*', element: <PlaceholderScreen title="Страница не найдена" /> },
    ],
  },
]);
