import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { Badge, Button, Card, EmptyState, Field, Input, ListItem, SkeletonList } from '@pdr/ui';
import { api } from '@/shared/api';
import { alertDialog, haptic } from '@/shared/telegram';
import { useMembers, useWorkspace } from './api';

/** Вкладка «Ещё»: сотрудники, настройки и разделы, которые появятся дальше. */
export function WorkspaceSettingsScreen() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const workspace = useWorkspace(workspaceId);
  const members = useMembers(workspaceId);

  const queryClient = useQueryClient();
  const settings = (workspace.data?.settings ?? {}) as Record<string, unknown>;

  const [dayStart, setDayStart] = useState('09:00');
  const [dayEnd, setDayEnd] = useState('20:00');
  const [defaultMinutes, setDefaultMinutes] = useState(60);
  const [reminderMinutes, setReminderMinutes] = useState(60);

  useEffect(() => {
    if (!workspace.data) return;
    setDayStart(String(settings.work_day_start ?? '09:00'));
    setDayEnd(String(settings.work_day_end ?? '20:00'));
    setDefaultMinutes(Number(settings.default_appointment_minutes ?? 60));
    setReminderMinutes(Number(settings.reminder_lead_minutes ?? 60));
    // settings — часть workspace.data, отдельная зависимость не нужна.
  }, [workspace.data, settings]);

  const saveSettings = useMutation({
    mutationFn: () =>
      api.patch(`/workspaces/${workspaceId}`, {
        settings: {
          work_day_start: dayStart,
          work_day_end: dayEnd,
          default_appointment_minutes: defaultMinutes,
          reminder_lead_minutes: reminderMinutes,
        },
      }),
    onSuccess: async () => {
      haptic('success');
      await queryClient.invalidateQueries({ queryKey: ['crm'] });
    },
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось сохранить настройки'),
  });

  if (workspace.isLoading) return <SkeletonList rows={3} />;
  const data = workspace.data!;
  const isOwner = data.role === 'owner';
  const canManage = data.permissions.includes('workspace.manage');

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

      {canManage ? (
        <>
          <h2 className="pdr-subtitle">Календарь</h2>
          <Card>
            <div className="pdr-stack">
              <div className="pdr-row">
                <Field label="Начало дня">
                  <Input
                    type="time"
                    value={dayStart}
                    onChange={(e) => setDayStart(e.target.value)}
                  />
                </Field>
                <Field label="Конец дня">
                  <Input type="time" value={dayEnd} onChange={(e) => setDayEnd(e.target.value)} />
                </Field>
              </div>
              <Field label="Длительность записи по умолчанию, мин">
                <Input
                  type="number"
                  min={15}
                  max={600}
                  step={15}
                  value={defaultMinutes}
                  onChange={(e) => setDefaultMinutes(Number(e.target.value))}
                />
              </Field>
              <Field
                label="Напоминать за, мин"
                hint="0 — не напоминать о записях в Telegram"
              >
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  step={15}
                  value={reminderMinutes}
                  onChange={(e) => setReminderMinutes(Number(e.target.value))}
                />
              </Field>
              <Button block loading={saveSettings.isPending} onClick={() => saveSettings.mutate()}>
                Сохранить
              </Button>
            </div>
          </Card>
        </>
      ) : null}

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
