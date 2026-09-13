import { Navigate } from 'react-router-dom';
import { Card, EmptyState, ListItem } from '@pdr/ui';
import { useMe } from '../auth/AuthProvider';
import { useNavigate } from 'react-router-dom';
import { LAST_WORKSPACE_KEY, readLastWorkspace } from './lastWorkspace';

/**
 * Если мастерская одна — сразу открываем её.
 * Если несколько — показываем выбор, запоминая последнюю.
 */
export function WorkspacePicker() {
  const me = useMe();
  const navigate = useNavigate();

  if (me.workspaces.length === 0) {
    return (
      <div className="pdr-stack">
        <h1 className="pdr-title">Мастерская</h1>
        <EmptyState
          title="У вас пока нет мастерской"
          description="Доступ к CRM выдаёт администратор платформы, а сотрудника приглашает владелец мастерской по ссылке."
        />
      </div>
    );
  }

  const remembered = readLastWorkspace();
  const target =
    me.workspaces.find((w) => w.id === remembered)?.id ??
    (me.workspaces.length === 1 ? me.workspaces[0]!.id : null);

  if (target) return <Navigate to={`/workspace/${target}`} replace />;

  return (
    <div className="pdr-stack">
      <h1 className="pdr-title">Выберите мастерскую</h1>
      <Card flat>
        <div className="pdr-list">
          {me.workspaces.map((w) => (
            <ListItem
              key={w.id}
              title={w.name}
              subtitle={`${w.role === 'owner' ? 'Владелец' : 'Сотрудник'}${
                w.hasActiveAccess ? '' : ' · доступ завершён'
              }`}
              onClick={() => {
                try {
                  localStorage.setItem(LAST_WORKSPACE_KEY, w.id);
                } catch {
                  /* приватный режим */
                }
                navigate(`/workspace/${w.id}`);
              }}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
