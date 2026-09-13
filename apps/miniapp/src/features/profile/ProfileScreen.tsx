import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Field, Input, ListItem } from '@pdr/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { api } from '@/shared/api';
import { formatPhoneRu } from '@/shared/format';
import { alertDialog, confirmDialog, requestWriteAccess } from '@/shared/telegram';
import { useAuth, useMe } from '../auth/AuthProvider';

export function ProfileScreen() {
  const me = useMe();
  const { reload, logout } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [phone, setPhone] = useState(me.user.phone ?? '');
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const savePhone = useMutation({
    mutationFn: () => api.patch('/me', { phone: phone.trim() === '' ? null : phone }),
    onSuccess: async () => {
      setPhoneError(null);
      await reload();
      await queryClient.invalidateQueries();
    },
    onError: (e) => setPhoneError(e instanceof ApiError ? e.message : 'Не удалось сохранить'),
  });

  const enableNotifications = useMutation({
    mutationFn: async () => {
      const granted = await requestWriteAccess();
      if (!granted) throw new Error('denied');
      await api.post('/me/bot-write-allowed');
    },
    onSuccess: () => void reload(),
    onError: () => void alertDialog('Уведомления можно включить позже в профиле.'),
  });

  const fullName = [me.user.firstName, me.user.lastName].filter(Boolean).join(' ');

  return (
    <div className="pdr-stack">
      <h1 className="pdr-title">Профиль</h1>

      <Card>
        <div className="pdr-stack">
          <div>
            <div style={{ fontWeight: 600, fontSize: 17 }}>{fullName}</div>
            {me.user.username ? <div className="pdr-hint">@{me.user.username}</div> : null}
          </div>
          <div className="pdr-row" style={{ flexWrap: 'wrap' }}>
            {me.platformRoles.includes('admin') ? <Badge tone="info">Администратор</Badge> : null}
            {me.platformRoles.includes('curator') ? <Badge tone="info">Куратор</Badge> : null}
            {me.workspaces.map((w) => (
              <Badge key={w.id} tone={w.hasActiveAccess ? 'success' : 'muted'}>
                {w.name} · {w.role === 'owner' ? 'владелец' : 'сотрудник'}
              </Badge>
            ))}
            {me.enrollments.map((e) => (
              <Badge key={e.id} tone={e.hasActiveAccess ? 'success' : 'muted'}>
                {e.courseTitle}
              </Badge>
            ))}
          </div>
        </div>
      </Card>

      {!me.user.botWriteAllowed ? (
        <Card>
          <div className="pdr-stack">
            <div>
              <div style={{ fontWeight: 600 }}>Уведомления выключены</div>
              <div className="pdr-hint">
                Разрешите боту писать вам, чтобы получать результаты проверок, открытие этапов и
                напоминания о записях.
              </div>
            </div>
            <Button
              onClick={() => enableNotifications.mutate()}
              loading={enableNotifications.isPending}
              block
            >
              Разрешить уведомления
            </Button>
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="pdr-stack">
          <Field
            label="Телефон"
            error={phoneError}
            hint={
              me.user.phone
                ? `Сохранён: ${formatPhoneRu(me.user.phone)}`
                : 'Нужен для приглашений и связи. Telegram не передаёт его автоматически.'
            }
          >
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 999 123-45-67"
              inputMode="tel"
              autoComplete="tel"
            />
          </Field>
          <Button
            onClick={() => savePhone.mutate()}
            loading={savePhone.isPending}
            disabled={phone === (me.user.phone ?? '')}
            block
          >
            Сохранить
          </Button>
        </div>
      </Card>

      <Card flat>
        <div className="pdr-list">
          {me.platformRoles.includes('curator') || me.platformRoles.includes('admin') ? (
            <ListItem
              title="Проверка работ"
              subtitle="Очередь работ учеников ваших групп"
              onClick={() => navigate('/curator')}
            />
          ) : null}
          <ListItem
            title="Закрытый клуб"
            subtitle="Состояние доступа и ссылка на группу"
            onClick={() => navigate('/club')}
          />
          <ListItem
            title="Уведомления"
            subtitle="Какие сообщения присылать в Telegram"
            onClick={() => navigate('/profile/notifications')}
          />
        </div>
      </Card>

      <Card>
        <Button
          variant="danger"
          block
          onClick={async () => {
            if (await confirmDialog('Выйти из приложения?')) await logout();
          }}
        >
          Выйти
        </Button>
      </Card>
    </div>
  );
}
