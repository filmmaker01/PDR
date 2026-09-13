import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  ListItem,
  Sheet,
  SkeletonList,
} from '@pdr/ui';
import { api } from '@/shared/api';
import { formatDate } from '@/shared/format';
import { alertDialog, confirmDialog, haptic } from '@/shared/telegram';
import { useInvitations, useMembers, useWorkspace } from './api';
import type { MemberInfo } from './types';

const COLORS = ['#2f80ed', '#27ae60', '#eb5757', '#f2994a', '#9b51e0', '#00bcd4'];

/** Сотрудники мастерской: имя в календаре, цвет, приглашения, передача владения. */
export function EmployeesScreen() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const workspace = useWorkspace(workspaceId);
  const members = useMembers(workspaceId);
  const canManage = workspace.data?.permissions.includes('members.manage') ?? false;
  const invitations = useInvitations(workspaceId, canManage);

  const [edited, setEdited] = useState<MemberInfo | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['crm'] });
  };

  const saveMember = useMutation({
    mutationFn: (input: { memberId: string; body: Record<string, unknown> }) =>
      api.patch(`/workspaces/${workspaceId}/members/${input.memberId}`, input.body),
    onSuccess: async () => {
      haptic('success');
      setEdited(null);
      await invalidate();
    },
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось сохранить сотрудника'),
  });

  const createInvite = useMutation({
    mutationFn: () =>
      api.post<{ deepLink: string; botLink: string; expiresAt: string }>(
        `/workspaces/${workspaceId}/invitations`,
        { role: 'employee', expiresInDays: 7 },
      ),
    onSuccess: async (result) => {
      haptic('success');
      // Ссылку показываем один раз: она содержит токен приглашения.
      setInviteLink(result.deepLink);
      await invalidate();
    },
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось создать приглашение'),
  });

  const revokeInvite = useMutation({
    mutationFn: (invitationId: string) =>
      api.delete(`/workspaces/${workspaceId}/invitations/${invitationId}`),
    onSuccess: invalidate,
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось отозвать приглашение'),
  });

  const transfer = useMutation({
    mutationFn: (memberId: string) =>
      api.post(`/workspaces/${workspaceId}/members/transfer-ownership`, { memberId }),
    onSuccess: async () => {
      haptic('success');
      await invalidate();
      await alertDialog('Владение передано. Теперь вы сотрудник этой мастерской.');
    },
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось передать владение'),
  });

  if (members.isLoading) return <SkeletonList rows={3} />;

  const openEdit = (member: MemberInfo): void => {
    setEdited(member);
    setDisplayName(member.name);
    setColor(member.color);
  };

  return (
    <div className="pdr-stack">
      <h1 className="pdr-title">Сотрудники</h1>

      <Card flat>
        <div className="pdr-list">
          {(members.data ?? []).map((member) => (
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
              onClick={canManage ? () => openEdit(member) : undefined}
            />
          ))}
        </div>
      </Card>

      {canManage ? (
        <>
          <Button block loading={createInvite.isPending} onClick={() => createInvite.mutate()}>
            + Пригласить сотрудника
          </Button>

          {inviteLink ? (
            <Card>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Ссылка приглашения</div>
              <div className="pdr-hint" style={{ wordBreak: 'break-all' }}>
                {inviteLink}
              </div>
              <div className="pdr-hint" style={{ marginTop: 6 }}>
                Отправьте её сотруднику в Telegram. Ссылка показывается один раз и действует 7 дней.
              </div>
              <Button
                variant="secondary"
                block
                style={{ marginTop: 10 }}
                onClick={() => {
                  void navigator.clipboard?.writeText(inviteLink);
                  setInviteLink(null);
                }}
              >
                Скопировать и закрыть
              </Button>
            </Card>
          ) : null}

          {(invitations.data?.length ?? 0) > 0 ? (
            <>
              <h2 className="pdr-subtitle">Активные приглашения</h2>
              <Card flat>
                <div className="pdr-list">
                  {invitations.data!.map((invitation) => (
                    <ListItem
                      key={invitation.id}
                      title={`Приглашение до ${formatDate(invitation.expiresAt)}`}
                      subtitle={invitation.note ?? invitation.invitedPhone ?? 'для сотрудника'}
                      right={
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            if (await confirmDialog('Отозвать приглашение?')) {
                              revokeInvite.mutate(invitation.id);
                            }
                          }}
                        >
                          ✕
                        </Button>
                      }
                    />
                  ))}
                </div>
              </Card>
            </>
          ) : null}
        </>
      ) : (
        <EmptyState
          title="Управление сотрудниками у владельца"
          description="Вы видите состав мастерской, но менять его может только владелец."
        />
      )}

      <Button
        variant="secondary"
        block
        onClick={() => navigate(`/workspace/${workspaceId}/settings`)}
      >
        Назад
      </Button>

      <Sheet open={Boolean(edited)} onClose={() => setEdited(null)} title={edited?.name}>
        {edited ? (
          <div className="pdr-stack">
            <Field label="Имя в календаре и заказах">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>

            <Field label="Цвет в календаре">
              <div className="pdr-chips">
                {COLORS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`pdr-chip${color === value ? ' pdr-chip--active' : ''}`}
                    onClick={() => setColor(color === value ? null : value)}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 6,
                        background: value,
                        display: 'inline-block',
                      }}
                    />
                  </button>
                ))}
              </div>
            </Field>

            <Button
              block
              loading={saveMember.isPending}
              onClick={() =>
                saveMember.mutate({
                  memberId: edited.id,
                  body: { displayName: displayName.trim() || null, color },
                })
              }
            >
              Сохранить
            </Button>

            {edited.role === 'employee' ? (
              <>
                <Button
                  variant={edited.isActive ? 'danger' : 'secondary'}
                  block
                  onClick={async () => {
                    const message = edited.isActive
                      ? 'Деактивировать сотрудника? Он потеряет доступ к мастерской, но данные заказов останутся.'
                      : 'Вернуть сотруднику доступ к мастерской?';
                    if (await confirmDialog(message)) {
                      saveMember.mutate({
                        memberId: edited.id,
                        body: { isActive: !edited.isActive },
                      });
                    }
                  }}
                >
                  {edited.isActive ? 'Деактивировать' : 'Вернуть доступ'}
                </Button>

                <Button
                  variant="secondary"
                  block
                  onClick={async () => {
                    if (
                      await confirmDialog(
                        `Передать владение мастерской сотруднику «${edited.name}»? Вы станете обычным сотрудником.`,
                      )
                    ) {
                      transfer.mutate(edited.id);
                      setEdited(null);
                    }
                  }}
                >
                  Передать владение
                </Button>
              </>
            ) : (
              <Badge tone="info">Владелец мастерской</Badge>
            )}

            <Button variant="ghost" block onClick={() => setEdited(null)}>
              Закрыть
            </Button>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
