import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card } from '@pdr/ui';
import { api } from '@/shared/api';
import { haptic } from '@/shared/telegram';
import { useAuth, useMe } from '../auth/AuthProvider';

const TOGGLES: { key: string; label: string; hint: string }[] = [
  {
    key: 'reviewResults',
    label: 'Результаты проверок',
    hint: 'Работа принята или возвращена, комментарии куратора, оценка экзамена',
  },
  { key: 'stageUnlocked', label: 'Открытие этапов', hint: 'Когда становится доступен новый этап' },
  {
    key: 'appointmentReminders',
    label: 'Напоминания о записях',
    hint: 'За указанное время до начала работы',
  },
  { key: 'orderAssigned', label: 'Назначенные заказы', hint: 'Когда вам назначают заказ' },
  { key: 'accessExpiring', label: 'Окончание доступа', hint: 'За 7 и за 1 день до окончания' },
  { key: 'reviewQueueDigest', label: 'Сводка очереди проверок', hint: 'Для кураторов, раз в день' },
];

const LEAD_OPTIONS = [15, 30, 60, 120, 180];

export function NotificationsScreen() {
  const me = useMe();
  const { reload } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const update = useMutation({
    mutationFn: (changes: Record<string, boolean | number>) =>
      api.patch('/me/notifications', changes),
    onSuccess: async () => {
      haptic('select');
      await reload();
      await queryClient.invalidateQueries();
    },
  });

  const prefs = me.notifications as Record<string, boolean | number>;
  const lead = typeof prefs.reminderLeadMinutes === 'number' ? prefs.reminderLeadMinutes : 60;

  return (
    <div className="pdr-stack">
      <h1 className="pdr-title">Уведомления</h1>

      {!me.user.botWriteAllowed ? (
        <Card>
          <div className="pdr-hint">
            Бот пока не может писать вам. Включите уведомления в профиле — иначе эти настройки ни на
            что не влияют.
          </div>
        </Card>
      ) : null}

      <Card flat>
        <div className="pdr-list">
          {TOGGLES.map((toggle) => {
            const enabled = prefs[toggle.key] !== false;
            return (
              <label key={toggle.key} className="pdr-list__item pdr-list__item--static">
                <span className="pdr-grow">
                  <span style={{ display: 'block', fontWeight: 500 }}>{toggle.label}</span>
                  <span className="pdr-hint">{toggle.hint}</span>
                </span>
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={update.isPending}
                  onChange={(e) => update.mutate({ [toggle.key]: e.target.checked })}
                  style={{ width: 22, height: 22 }}
                />
              </label>
            );
          })}
        </div>
      </Card>

      <Card>
        <div className="pdr-stack">
          <div>
            <div style={{ fontWeight: 500 }}>За сколько напоминать о записи</div>
            <div className="pdr-hint">Применяется к напоминаниям исполнителю</div>
          </div>
          <div className="pdr-chips">
            {LEAD_OPTIONS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                className={`pdr-chip${lead === minutes ? ' pdr-chip--active' : ''}`}
                onClick={() => update.mutate({ reminderLeadMinutes: minutes })}
              >
                {minutes < 60 ? `${minutes} мин` : `${minutes / 60} ч`}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Button variant="secondary" block onClick={() => navigate('/profile')}>
        Назад
      </Button>
    </div>
  );
}
