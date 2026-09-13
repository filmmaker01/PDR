import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { Button, Card, EmptyState, Field, Input, Spinner } from '@pdr/ui';
import { api } from '@/shared/api';
import { haptic } from '@/shared/telegram';
import { useAuth } from '../auth/AuthProvider';

interface Preview {
  workspaceName: string;
  role: 'owner' | 'employee';
  requiresPhone: boolean;
}

export function InviteScreen() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { me, reload, clearStartAction } = useAuth();
  const [phone, setPhone] = useState(me?.user.phone ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => clearStartAction, [clearStartAction]);

  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.get<Preview>('/invitations/preview', { query: { token } }),
    retry: false,
  });

  const savePhone = useMutation({
    mutationFn: () => api.patch('/me', { phone }),
    onSuccess: () => reload(),
  });

  const accept = useMutation({
    mutationFn: () => api.post<{ workspaceId: string }>('/invitations/accept', { token }),
    onSuccess: async (result) => {
      haptic('success');
      await reload();
      await queryClient.invalidateQueries();
      navigate(`/workspace/${result.workspaceId}`, { replace: true });
    },
    onError: (e) => {
      haptic('error');
      setError(e instanceof ApiError ? e.message : 'Не удалось принять приглашение');
    },
  });

  if (preview.isLoading) {
    return (
      <div className="app-splash">
        <Spinner />
      </div>
    );
  }

  if (preview.isError) {
    return (
      <EmptyState
        title="Приглашение недоступно"
        description={
          preview.error instanceof ApiError
            ? preview.error.message
            : 'Ссылка устарела или уже использована'
        }
        action={<Button onClick={() => navigate('/profile', { replace: true })}>В профиль</Button>}
      />
    );
  }

  const data = preview.data!;
  const needsPhone = data.requiresPhone && !me?.user.phone;

  return (
    <div className="pdr-stack">
      <h1 className="pdr-title">Приглашение в мастерскую</h1>

      <Card>
        <div className="pdr-stack">
          <div>
            <div style={{ fontSize: 17, fontWeight: 600 }}>{data.workspaceName}</div>
            <div className="pdr-hint">Роль: {data.role === 'owner' ? 'владелец' : 'сотрудник'}</div>
          </div>
          <div className="pdr-hint">
            Вы получите доступ к заказам мастерской, календарю и клиентам. Данные других мастерских
            останутся недоступны.
          </div>
        </div>
      </Card>

      {needsPhone ? (
        <Card>
          <div className="pdr-stack">
            <Field label="Телефон" hint="Приглашение выдано на конкретный номер — подтвердите его">
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+7 999 123-45-67"
                inputMode="tel"
              />
            </Field>
            <Button
              onClick={() => savePhone.mutate()}
              loading={savePhone.isPending}
              disabled={phone.trim().length < 5}
              block
            >
              Сохранить телефон
            </Button>
          </div>
        </Card>
      ) : null}

      {error ? (
        <Card>
          <span style={{ color: 'var(--pdr-destructive)' }}>{error}</span>
        </Card>
      ) : null}

      <Button
        onClick={() => accept.mutate()}
        loading={accept.isPending}
        disabled={needsPhone}
        block
      >
        Принять приглашение
      </Button>
      <Button variant="secondary" onClick={() => navigate('/profile', { replace: true })} block>
        Не сейчас
      </Button>
    </div>
  );
}
