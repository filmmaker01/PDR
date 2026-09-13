import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Card, EmptyState, ListItem, SkeletonList } from '@pdr/ui';
import { useMembers, useWorkspace } from './api';

/** Вкладка «Ещё»: сотрудники, настройки и разделы, которые появятся дальше. */
export function WorkspaceSettingsScreen() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const workspace = useWorkspace(workspaceId);
  const members = useMembers(workspaceId);

  if (workspace.isLoading) return <SkeletonList rows={3} />;
  const data = workspace.data!;
  const isOwner = data.role === 'owner';

  return (
    <div className="pdr-stack">
      <Card>
        <div className="pdr-stack" style={{ gap: 6 }}>
          <div className="pdr-row">
            <span className="pdr-grow pdr-hint">Часовой пояс</span>
            <span>{data.timezone}</span>
          </div>
          <div className="pdr-row">
            <span className="pdr-grow pdr-hint">Валюта</span>
            <span>{data.currency}</span>
          </div>
          <div className="pdr-row">
            <span className="pdr-grow pdr-hint">Доступ к CRM</span>
            <Badge tone={data.access.active ? 'success' : 'danger'}>
              {data.access.active ? 'активен' : 'завершён'}
            </Badge>
          </div>
        </div>
      </Card>

      <h2 className="pdr-subtitle">Сотрудники</h2>
      {members.isLoading ? (
        <SkeletonList rows={2} />
      ) : (members.data?.length ?? 0) === 0 ? (
        <EmptyState title="Сотрудников нет" />
      ) : (
        <Card flat>
          <div className="pdr-list">
            {members.data!.map((member) => (
              <ListItem
                key={member.id}
                title={member.name}
                subtitle={[
                  member.role === 'owner' ? 'владелец' : 'сотрудник',
                  member.isActive ? null : 'деактивирован',
                  member.username ? `@${member.username}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  member.color ? (
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 7,
                        background: member.color,
                        display: 'inline-block',
                      }}
                    />
                  ) : null
                }
              />
            ))}
          </div>
        </Card>
      )}

      <Card flat>
        <div className="pdr-list">
          <ListItem
            title="Задолженность"
            subtitle="Заказы, оплаченные не полностью"
            onClick={() => navigate(`/workspace/${workspaceId}/debts`)}
          />
          {isOwner ? (
            <ListItem
              title="Сотрудники и приглашения"
              subtitle="Появится на этапе 13"
              onClick={() => undefined}
            />
          ) : null}
        </div>
      </Card>
    </div>
  );
}
