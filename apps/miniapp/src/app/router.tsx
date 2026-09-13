import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RootLayout } from './RootLayout';
import { PlaceholderScreen } from './PlaceholderScreen';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <Navigate to="/learning" replace /> },
      {
        path: 'learning',
        element: <PlaceholderScreen title="Обучение" hint="Раздел появится на этапе 6" />,
      },
      {
        path: 'workspace',
        element: <PlaceholderScreen title="Мастерская" hint="Раздел появится на этапе 9" />,
      },
      {
        path: 'profile',
        element: <PlaceholderScreen title="Профиль" hint="Раздел появится на этапе 1" />,
      },
      { path: '*', element: <PlaceholderScreen title="Страница не найдена" /> },
    ],
  },
]);
