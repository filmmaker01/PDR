import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Card, EmptyState } from '@pdr/ui';
import { useMe } from '../auth/AuthProvider';
import { rememberWorkspace } from './lastWorkspace';

export function WorkspaceScreen() {
  const { workspaceId = '' } = useParams();
  const me = useMe();
  const workspace = me.workspaces.find((w) => w.id === workspaceId);

  useEffect(() => {
    if (workspace) rememberWorkspace(workspace.id);
  }, [workspace]);

  if (!workspace) {
    return (
      <EmptyState
        title="Мастерская недоступна"
        description="Возможно, вас исключили из мастерской или ссылка ведёт на чужую."
      />
    );
  }

  return (
    <div className="pdr-stack">
      <div>
        <h1 className="pdr-title">{workspace.name}</h1>
        <div className="pdr-row">
          <Badge tone={workspace.role === 'owner' ? 'info' : 'muted'}>
            {workspace.role === 'owner' ? 'Владелец' : 'Сотрудник'}
          </Badge>
          {workspace.hasActiveAccess ? (
            <Badge tone="success">Доступ активен</Badge>
          ) : (
            <Badge tone="danger">Доступ завершён</Badge>
          )}
        </div>
      </div>

      {!workspace.hasActiveAccess ? (
        <Card>
          <div className="pdr-stack">
            <div style={{ fontWeight: 600 }}>Доступ к CRM завершён</div>
            <div className="pdr-hint">
              Данные сохранены: клиенты, заказы и оплаты доступны для просмотра и выгрузки. Чтобы
              снова вести заказы, продлите доступ у администратора.
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="pdr-stack">
          <div style={{ fontWeight: 600 }}>Раздел в разработке</div>
          <div className="pdr-hint">
            Клиенты, заказы и календарь появятся на этапах 9–13. Часовой пояс мастерской:{' '}
            {workspace.timezone}.
          </div>
        </div>
      </Card>
    </div>
  );
}
