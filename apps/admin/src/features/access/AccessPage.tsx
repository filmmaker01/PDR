import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Menu,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import { IconDots } from '@tabler/icons-react';
import { api } from '@/shared/api';
import { useApiMutation, useApiQuery } from '@/shared/query';
import {
  GRANT_STATUS_COLORS,
  GRANT_STATUS_LABELS,
  PRODUCT_LABELS,
  daysLeft,
  formatDate,
} from '@/shared/format';

interface Grant {
  id: string;
  product: string;
  userId: string | null;
  workspaceId: string | null;
  courseId: string | null;
  status: string;
  validFrom: string;
  validUntil: string | null;
  reason: string | null;
  externalRef: string | null;
  createdAt: string;
}

interface UserOption {
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
}

interface WorkspaceOption {
  id: string;
  name: string;
}

const GRANTS_KEY = ['admin', 'grants'];

export function AccessPage() {
  const [product, setProduct] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>('active');
  const [grantModal, grantModalHandlers] = useDisclosure(false);
  const [actionGrant, setActionGrant] = useState<{
    grant: Grant;
    action: 'extend' | 'revoke';
  } | null>(null);

  const grants = useApiQuery<{ items: Grant[]; nextCursor: string | null }>(
    GRANTS_KEY,
    '/admin/access-grants',
    {
      query: { product: product ?? undefined, status: status ?? undefined, limit: 100 },
    },
  );
  const expiring = useApiQuery<{ items: Grant[] }>(
    ['admin', 'grants', 'expiring'],
    '/admin/access-grants',
    { query: { expiringInDays: 7, limit: 100 } },
  );

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Доступы</Title>
        <Button onClick={grantModalHandlers.open}>Выдать доступ</Button>
      </Group>

      {expiring.data && expiring.data.items.length > 0 ? (
        <Alert color="yellow" title="Истекают в ближайшую неделю">
          {expiring.data.items.length} доступ(ов). Продлите их до окончания срока, чтобы не
          прерывать работу мастеров и учеников.
        </Alert>
      ) : null}

      <Card withBorder>
        <Group>
          <Select
            label="Продукт"
            placeholder="Все"
            clearable
            value={product}
            onChange={setProduct}
            data={[
              { value: 'course', label: 'Курс' },
              { value: 'crm', label: 'CRM' },
              { value: 'club', label: 'Клуб' },
            ]}
          />
          <Select
            label="Статус"
            placeholder="Все"
            clearable
            value={status}
            onChange={setStatus}
            data={Object.entries(GRANT_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Group>
      </Card>

      <Card withBorder p={0}>
        {grants.isLoading ? (
          <Group justify="center" p="xl">
            <Loader />
          </Group>
        ) : (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Продукт</Table.Th>
                <Table.Th>Кому</Table.Th>
                <Table.Th>Статус</Table.Th>
                <Table.Th>Действует до</Table.Th>
                <Table.Th>Основание</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(grants.data?.items ?? []).map((g) => {
                const left = daysLeft(g.validUntil);
                return (
                  <Table.Tr key={g.id}>
                    <Table.Td>{PRODUCT_LABELS[g.product] ?? g.product}</Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {g.workspaceId
                          ? `мастерская ${g.workspaceId.slice(0, 8)}`
                          : `пользователь ${g.userId?.slice(0, 8)}`}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={GRANT_STATUS_COLORS[g.status]}>
                        {GRANT_STATUS_LABELS[g.status] ?? g.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {g.validUntil ? (
                        <Group gap={6}>
                          <Text size="sm">{formatDate(g.validUntil)}</Text>
                          {left !== null && left <= 7 && g.status === 'active' ? (
                            <Badge size="sm" color={left <= 1 ? 'red' : 'yellow'}>
                              {left <= 0 ? 'истёк' : `${left} дн.`}
                            </Badge>
                          ) : null}
                        </Group>
                      ) : (
                        <Text size="sm" c="dimmed">
                          бессрочно
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed" lineClamp={1}>
                        {g.reason ?? g.externalRef ?? '—'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Menu position="bottom-end">
                        <Menu.Target>
                          <ActionIcon variant="subtle">
                            <IconDots size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item onClick={() => setActionGrant({ grant: g, action: 'extend' })}>
                            Продлить
                          </Menu.Item>
                          {g.status === 'active' ? (
                            <Menu.Item
                              color="red"
                              onClick={() => setActionGrant({ grant: g, action: 'revoke' })}
                            >
                              Отозвать
                            </Menu.Item>
                          ) : null}
                        </Menu.Dropdown>
                      </Menu>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      <GrantModal opened={grantModal} onClose={grantModalHandlers.close} />
      <GrantActionModal target={actionGrant} onClose={() => setActionGrant(null)} />
    </Stack>
  );
}

function GrantModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [product, setProduct] = useState<string>('crm');
  const [userId, setUserId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [validUntil, setValidUntil] = useState<Date | null>(null);
  const [reason, setReason] = useState('');

  const users = useApiQuery<UserOption[]>(['admin', 'users', 'options'], '/admin/users', {
    query: { limit: 100 },
    enabled: opened,
  });
  const workspaces = useApiQuery<WorkspaceOption[]>(
    ['admin', 'workspaces', 'options'],
    '/admin/workspaces',
    { query: { limit: 100 }, enabled: opened },
  );

  const create = useApiMutation(
    () =>
      api.post('/admin/access-grants', {
        product,
        userId: product === 'crm' ? undefined : userId,
        workspaceId: product === 'crm' ? workspaceId : undefined,
        validUntil: validUntil ? validUntil.toISOString() : null,
        reason: reason || undefined,
      }),
    {
      invalidate: [GRANTS_KEY, ['admin', 'grants', 'expiring']],
      successMessage: 'Доступ выдан',
      onSuccess: () => {
        onClose();
        setReason('');
        setValidUntil(null);
      },
    },
  );

  const ready = product === 'crm' ? Boolean(workspaceId) : Boolean(userId);

  return (
    <Modal opened={opened} onClose={onClose} title="Выдать доступ">
      <Stack>
        <Select
          label="Продукт"
          value={product}
          onChange={(v) => setProduct(v ?? 'crm')}
          data={[
            { value: 'crm', label: 'CRM (мастерской)' },
            { value: 'club', label: 'Клуб (пользователю)' },
            { value: 'course', label: 'Курс (через зачисление в группу)' },
          ]}
        />

        {product === 'course' ? (
          <Alert color="blue">
            Доступ к курсу выдаётся вместе с зачислением в группу — в разделе «Группы».
          </Alert>
        ) : product === 'crm' ? (
          <Select
            label="Мастерская"
            searchable
            value={workspaceId}
            onChange={setWorkspaceId}
            data={(workspaces.data ?? []).map((w) => ({ value: w.id, label: w.name }))}
          />
        ) : (
          <Select
            label="Пользователь"
            searchable
            value={userId}
            onChange={setUserId}
            data={(users.data ?? []).map((u) => ({
              value: u.id,
              label: `${[u.firstName, u.lastName].filter(Boolean).join(' ')}${u.username ? ` (@${u.username})` : ''}`,
            }))}
          />
        )}

        <DateInput
          label="Действует до"
          placeholder="Оставьте пустым для бессрочного"
          clearable
          value={validUntil}
          onChange={setValidUntil}
          minDate={new Date()}
        />
        <TextInput
          label="Основание"
          placeholder="Оплата, договор, номер платежа"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        <Button
          disabled={!ready || product === 'course'}
          loading={create.isPending}
          onClick={() => create.mutate(undefined)}
        >
          Выдать
        </Button>
      </Stack>
    </Modal>
  );
}

function GrantActionModal({
  target,
  onClose,
}: {
  target: { grant: Grant; action: 'extend' | 'revoke' } | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [validUntil, setValidUntil] = useState<Date | null>(null);

  const run = useApiMutation(
    () => {
      if (!target) throw new Error('нет цели');
      return target.action === 'extend'
        ? api.post(`/admin/access-grants/${target.grant.id}/extend`, {
            validUntil: validUntil ? validUntil.toISOString() : null,
            reason,
          })
        : api.post(`/admin/access-grants/${target.grant.id}/revoke`, { reason });
    },
    {
      invalidate: [GRANTS_KEY, ['admin', 'grants', 'expiring']],
      successMessage: target?.action === 'extend' ? 'Доступ продлён' : 'Доступ отозван',
      onSuccess: () => {
        onClose();
        setReason('');
        setValidUntil(null);
      },
    },
  );

  return (
    <Modal
      opened={target !== null}
      onClose={onClose}
      title={target?.action === 'extend' ? 'Продление доступа' : 'Отзыв доступа'}
    >
      <Stack>
        {target?.action === 'extend' ? (
          <DateInput
            label="Действует до"
            placeholder="Пусто — бессрочно"
            clearable
            value={validUntil}
            onChange={setValidUntil}
            minDate={new Date()}
          />
        ) : (
          <Alert color="orange">
            Отзыв действует сразу: сотрудники мастерской потеряют возможность изменять данные, но
            смогут их просматривать и выгрузить.
          </Alert>
        )}
        <TextInput
          label="Причина"
          required
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        <Button
          color={target?.action === 'revoke' ? 'red' : undefined}
          disabled={reason.trim().length === 0}
          loading={run.isPending}
          onClick={() => run.mutate(undefined)}
        >
          {target?.action === 'extend' ? 'Продлить' : 'Отозвать'}
        </Button>
      </Stack>
    </Modal>
  );
}
