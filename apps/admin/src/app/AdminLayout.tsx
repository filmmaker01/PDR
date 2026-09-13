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
import { Link, Outlet, useLocation } from 'react-router-dom';
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
  const [opened, { toggle, close }] = useDisclosure();
  const location = useLocation();
  const { me, isAdmin, isCurator, logout } = useAuth();

  // Полный список разделов панели: маршруты существуют, и до каждого
  // должен быть один клик, а не набранный вручную адрес.
  const items: NavItem[] = [
    { to: '/dashboard', label: 'Дашборд', roles: ['admin'] },
    { to: '/reviews', label: 'Проверка работ', roles: ['admin', 'curator'] },
    { to: '/exam-reviews', label: 'Экзамены', roles: ['admin', 'curator'] },
    { to: '/students', label: 'Ученики', roles: ['admin', 'curator'] },
    { to: '/cohorts', label: 'Группы', roles: ['admin'] },
    { to: '/courses', label: 'Курсы', roles: ['admin'] },
    { to: '/videos', label: 'Видео', roles: ['admin'] },
    { to: '/users', label: 'Пользователи', roles: ['admin'] },
    { to: '/access', label: 'Доступы', roles: ['admin'] },
    { to: '/workspaces', label: 'Мастерские', roles: ['admin'] },
    { to: '/club', label: 'Клуб', roles: ['admin'] },
    { to: '/exports', label: 'Выгрузки', roles: ['admin'] },
    { to: '/audit', label: 'Журнал действий', roles: ['admin'] },
  ];
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
        {/* Пункт меню — настоящая ссылка с href: работает средняя кнопка,
            «открыть в новой вкладке» и адрес виден в строке состояния. */}
        {visible.map((item) => (
          <NavLink
            key={item.to}
            component={Link}
            to={item.to}
            label={item.label}
            active={location.pathname.startsWith(item.to)}
            onClick={() => close()}
          />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
