import type { ReactNode } from 'react';
import { Center, Loader } from '@mantine/core';
import { useAuth } from './AuthProvider';
import { LoginPage } from './LoginPage';

export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <Center mih="100dvh">
        <Loader />
      </Center>
    );
  }
  if (status === 'anonymous') return <LoginPage />;
  return <>{children}</>;
}
