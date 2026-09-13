import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, SkeletonList } from '@pdr/ui';
import { api } from '@/shared/api';
import { formatDate } from '@/shared/format';
import { openLink } from '@/shared/telegram';

type ClubStatus =
  'none' | 'invited' | 'join_requested' | 'approved' | 'member' | 'left' | 'removed' | 'declined';

interface ClubStatusView {
  hasAccess: boolean;
  validUntil: string | null;
  status: ClubStatus;
  joinedAt: string | null;
  inviteLink: string | null;
  lastError: string | null;
}

const STATUS_TEXT: Record<ClubStatus, string> = {
  none: 'Вы ещё не вступили',
  invited: 'Приглашение отправлено',
  join_requested: 'Заявка отправлена, ожидает обработки',
  approved: 'Заявка одобрена',
  member: 'Вы в клубе',
  left: 'Вы вышли из группы',
  removed: 'Вы были исключены',
  declined: 'Заявка отклонена',
};

/** Закрытый клуб: состояние доступа и ссылка на вступление. */
export function ClubScreen() {
  const navigate = useNavigate();
  const club = useQuery({
    queryKey: ['club', 'status'],
    queryFn: () => api.get<ClubStatusView>('/club/status'),
  });

  if (club.isLoading) return <SkeletonList rows={3} />;
  const data = club.data;

  if (!data) {
    return <EmptyState title="Не удалось загрузить состояние клуба" />;
  }

  return (
    <div className="pdr-stack">
      <h1 className="pdr-title">Закрытый клуб</h1>

      <Card>
        <div className="pdr-row">
          <span className="pdr-grow">
            <span style={{ display: 'block', fontWeight: 600 }}>{STATUS_TEXT[data.status]}</span>
            {data.joinedAt ? (
              <span className="pdr-hint">в клубе с {formatDate(data.joinedAt)}</span>
            ) : null}
          </span>
          <Badge tone={data.status === 'member' ? 'success' : 'muted'}>
            {data.status === 'member' ? 'участник' : 'не в клубе'}
          </Badge>
        </div>
      </Card>

      <Card>
        <div className="pdr-row">
          <span className="pdr-grow pdr-hint">Доступ к клубу</span>
          <Badge tone={data.hasAccess ? 'success' : 'danger'}>
            {data.hasAccess ? 'действует' : 'нет'}
          </Badge>
        </div>
        {data.validUntil ? (
          <div className="pdr-hint" style={{ marginTop: 6 }}>
            действует до {formatDate(data.validUntil)}
          </div>
        ) : null}
      </Card>

      {/* Три разных случая. Раньше последние два сливались в один, и человек
          с действующим доступом читал, что доступа у него нет. */}
      {!data.hasAccess ? (
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Доступ к клубу не действует</div>
          <div className="pdr-hint">
            Вступить в группу можно только с действующим доступом. Продлите его у администратора —
            после продления вернуться можно по той же ссылке.
          </div>
        </Card>
      ) : !data.inviteLink ? (
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Ссылка на группу пока не настроена</div>
          <div className="pdr-hint">
            Доступ у вас есть. Как только администратор укажет ссылку на группу, здесь появится
            кнопка вступления.
          </div>
        </Card>
      ) : (
        <>
          <Button block onClick={() => openLink(data.inviteLink!)}>
            {data.status === 'member' ? 'Открыть группу' : 'Вступить в клуб'}
          </Button>
          <div className="pdr-hint">
            По ссылке отправляется заявка. Бот одобрит её автоматически, пока действует доступ.
          </div>
        </>
      )}

      <Button variant="secondary" block onClick={() => navigate('/profile')}>
        В профиль
      </Button>
    </div>
  );
}
