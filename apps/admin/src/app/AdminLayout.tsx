import { AppShell, Burger, Group, NavLink, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const NAV = [{ to: '/dashboard', label: 'Дашборд' }];

export function AdminLayout() {
  const [opened, { toggle }] = useDisclosure();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
          <Text fw={700}>PDR — панель администратора</Text>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        {NAV.map((item) => (
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
