import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, EmptyState, ListItem, SkeletonList } from '@pdr/ui';
import { formatDateTime } from '@/shared/format';
import { useMembers, useWorkspaceAudit } from './api';

const ENTITY_LABELS: Record<string, string> = {
  order: 'Заказ',
  appointment: 'Запись',
  estimate: 'Смета',
  payment_entry: 'Оплата',
  order_photo: 'Фотография',
  price_list_item: 'Прайс',
  client: 'Клиент',
  vehicle: 'Автомобиль',
  workspace: 'Мастерская',
  workspace_member: 'Сотрудник',
  invitation: 'Приглашение',
};

const ACTION_LABELS: Record<string, string> = {
  create: 'создание',
  update: 'изменение',
  delete: 'удаление',
  status: 'смена статуса',
  status_change: 'смена статуса',
  send: 'отправка',
  agree: 'согласование',
  reject: 'отклонение',
  new_version: 'новая версия',
  items: 'правка позиций',
  archive: 'архивирование',
  transfer_ownership: 'передача владения',
  revoke: 'отзыв',
};

/** Журнал действий мастерской: кто и что менял. */
export function WorkspaceAuditScreen() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const audit = useWorkspaceAudit(workspaceId);
  const members = useMembers(workspaceId);

  const nameOf = (userId: string | null): string => {
    if (!userId) return 'система';
    const member = members.data?.find((m) => m.userId === userId);
    return member?.name ?? 'участник мастерской';
  };

  return (
    <div className="pdr-stack">
      <h1 className="pdr-title">Журнал действий</h1>
      <div className="pdr-hint">
        Последние изменения в мастерской: заказы, сметы, оплаты, сотрудники.
      </div>

      {audit.isLoading ? (
        <SkeletonList rows={5} />
      ) : (audit.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="Записей нет" />
      ) : (
        <Card flat>
          <div className="pdr-list">
            {audit.data!.items.map((entry) => (
              <ListItem
                key={entry.id}
                title={`${ENTITY_LABELS[entry.entityType] ?? entry.entityType} · ${
                  ACTION_LABELS[entry.action] ?? entry.action
                }`}
                subtitle={`${nameOf(entry.actorUserId)}, ${formatDateTime(entry.createdAt)}`}
              />
            ))}
          </div>
        </Card>
      )}

      <Button
        variant="secondary"
        block
        onClick={() => navigate(`/workspace/${workspaceId}/settings`)}
      >
        Назад
      </Button>
    </div>
  );
}
