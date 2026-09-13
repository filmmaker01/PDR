import type { PlatformRole } from '@pdr/shared';

export interface NavItem {
  to: string;
  label: string;
  roles: PlatformRole[];
}

export { AuthGate } from '@/features/auth/AuthGate';
