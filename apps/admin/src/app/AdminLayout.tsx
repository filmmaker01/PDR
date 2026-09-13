import {
  AppShell,
  Avatar,
  Badge,
  Burger,
  Group,
  Menu,
  NavLink,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AuthGate, type NavItem } from './nav';
import { useAuth } from '@/features/auth/AuthProvider';

export function AdminLayout() {
  return (
    <AuthGate>
      <AdminShell />
    </AuthGate>
  );
}

function AdminShell() {
  const [opened, { toggle }] = useDisclosure();
  const navigate = useNavigate();
  const location = useLocation();
  const { me, isAdmin, isCurator, logout } = useAuth();

  const items: NavItem[] = [{ to: '/dashboard', label: 'Дашборд', roles: ['admin'] }];
  const visible = items.filter(
    (item) =>
      (item.roles.includes('admin') && isAdmin) || (item.roles.includes('curator') && isCurator),
  );

  const name = me ? [me.user.firstName, me.user.lastName].filter(Boolean).join(' ') : '';

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={700}>PDR — панель администратора</Text>
          </Group>
          <Menu position="bottom-end">
            <Menu.Target>
              <UnstyledButton>
                <Group gap="xs">
                  <Avatar size="sm" radius="xl">
                    {name.slice(0, 1)}
                  </Avatar>
                  <div>
                    <Text size="sm">{name}</Text>
                    <Group gap={4}>
                      {isAdmin ? <Badge size="xs">админ</Badge> : null}
                      {isCurator ? (
                        <Badge size="xs" color="teal">
                          куратор
                        </Badge>
                      ) : null}
                    </Group>
                  </div>
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => void logout()}>Выйти</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        {visible.map((item) => (
          <NavLink
            key={item.to}
            label={item.label}
            active={location.pathname.startsWith(item.to)}
            onClick={() => navigate(item.to)}
          />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
