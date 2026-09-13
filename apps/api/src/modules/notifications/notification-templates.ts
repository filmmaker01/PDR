import type { InlineButton } from '@/infra/telegram/telegram.types';

export type NotificationType =
  | 'review_result'
  | 'submission_comment'
  | 'exam_graded'
  | 'stage_unlocked'
  | 'access_expiring'
  | 'access_revoked'
  | 'club_removed'
  | 'appointment_reminder'
  | 'order_assigned'
  | 'invitation_accepted'
  | 'export_ready'
  | 'review_queue_digest';

/** Какой переключатель в настройках управляет типом уведомления. */
export const PREFERENCE_BY_TYPE: Record<NotificationType, string | null> = {
  review_result: 'reviewResults',
  submission_comment: 'reviewResults',
  exam_graded: 'reviewResults',
  stage_unlocked: 'stageUnlocked',
  access_expiring: 'accessExpiring',
  // Отзыв доступа и исключение из клуба — существенные события,
  // о них сообщаем независимо от настроек.
  access_revoked: null,
  club_removed: null,
  appointment_reminder: 'appointmentReminders',
  order_assigned: 'orderAssigned',
  invitation_accepted: null,
  export_ready: null,
  review_queue_digest: 'reviewQueueDigest',
};

export interface RenderedNotification {
  text: string;
  /** Куда ведёт кнопка внутри Mini App. */
  deepLinkPath?: string;
  buttonText?: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type Payload = Record<string, unknown>;

function str(payload: Payload, key: string, fallback = ''): string {
  const value = payload[key];
  return typeof value === 'string' ? escapeHtml(value) : fallback;
}

function num(payload: Payload, key: string, fallback = 0): number {
  const value = payload[key];
  return typeof value === 'number' ? value : fallback;
}

/**
 * Тексты уведомлений. Все на русском, без служебных идентификаторов:
 * получатель должен понять событие, не открывая приложение.
 */
export function renderNotification(type: NotificationType, payload: Payload): RenderedNotification {
  switch (type) {
    case 'review_result': {
      const accepted = payload.decision === 'accepted';
      const title = str(payload, 'assignmentTitle', 'задание');
      const comment = str(payload, 'comment');
      return {
        text: accepted
          ? `✅ <b>Работа принята</b>\n${title}${comment ? `\n\n${comment}` : ''}`
          : `🔄 <b>Работа на доработке</b>\n${title}${comment ? `\n\n${comment}` : ''}`,
        deepLinkPath: `/learning/submissions/${str(payload, 'submissionId')}`,
        buttonText: accepted ? 'Открыть курс' : 'Посмотреть замечания',
      };
    }
    case 'submission_comment':
      return {
        text: `💬 <b>Комментарий по работе</b>\n${str(payload, 'assignmentTitle')}\n\n${str(payload, 'comment')}`,
        deepLinkPath: `/learning/submissions/${str(payload, 'submissionId')}`,
        buttonText: 'Ответить',
      };
    case 'exam_graded': {
      const passed = payload.passed === true;
      return {
        text: passed
          ? `✅ <b>Экзамен сдан</b>\n${str(payload, 'examTitle')} — ${num(payload, 'percent')}%`
          : `❌ <b>Экзамен не сдан</b>\n${str(payload, 'examTitle')} — ${num(payload, 'percent')}%, нужно ${num(payload, 'passingScore')}%`,
        deepLinkPath: `/learning/attempts/${str(payload, 'attemptId')}/result`,
        buttonText: 'Посмотреть результат',
      };
    }
    case 'stage_unlocked':
      return {
        text: `🎉 <b>Открыт новый этап</b>\n${str(payload, 'stageTitle')}`,
        deepLinkPath: `/learning/${str(payload, 'enrollmentId')}/stages/${str(payload, 'stageKey')}`,
        buttonText: 'Начать',
      };
    case 'access_expiring': {
      const days = num(payload, 'daysLeft');
      const product = str(payload, 'productLabel', 'доступ');
      return {
        text:
          days <= 1
            ? `⏰ <b>Доступ заканчивается завтра</b>\n${product}`
            : `⏰ <b>Доступ заканчивается через ${days} дн.</b>\n${product}`,
        deepLinkPath: '/profile',
        buttonText: 'Открыть профиль',
      };
    }
    case 'access_revoked':
      return {
        text: `<b>Доступ завершён</b>\n${str(payload, 'productLabel')}${
          payload.reason ? `\n\nПричина: ${str(payload, 'reason')}` : ''
        }`,
        deepLinkPath: '/profile',
      };
    case 'club_removed':
      return {
        text: '<b>Доступ к закрытому клубу завершён</b>\nВы исключены из группы. После продления доступа сможете вступить снова.',
        deepLinkPath: '/club',
      };
    case 'appointment_reminder':
      return {
        text: `🔔 <b>Запись через ${num(payload, 'minutes', 60)} мин</b>\n${str(payload, 'time')} — ${str(payload, 'clientName')}${
          payload.vehicle ? `, ${str(payload, 'vehicle')}` : ''
        }`,
        deepLinkPath: str(payload, 'orderId')
          ? `/workspace/${str(payload, 'workspaceId')}/orders/${str(payload, 'orderId')}`
          : `/workspace/${str(payload, 'workspaceId')}/calendar`,
        buttonText: 'Открыть',
      };
    case 'order_assigned':
      return {
        text: `🔧 <b>Вам назначен заказ №${num(payload, 'orderNumber')}</b>\n${str(payload, 'title')}`,
        deepLinkPath: `/workspace/${str(payload, 'workspaceId')}/orders/${str(payload, 'orderId')}`,
        buttonText: 'Открыть заказ',
      };
    case 'invitation_accepted':
      return {
        text: `👤 <b>${str(payload, 'name')} принял приглашение</b>\nМастерская «${str(payload, 'workspaceName')}»`,
        deepLinkPath: `/workspace/${str(payload, 'workspaceId')}/members`,
        buttonText: 'Сотрудники',
      };
    case 'export_ready':
      return {
        text: '📦 <b>Выгрузка готова</b>\nСсылка действует 24 часа.',
        deepLinkPath: '/profile',
        buttonText: 'Скачать',
      };
    case 'review_queue_digest': {
      const count = num(payload, 'count');
      return {
        text: `📋 <b>Работ на проверке: ${count}</b>\nСамая старая ждёт ${num(payload, 'oldestDays')} дн.`,
        deepLinkPath: '/profile/curator',
        buttonText: 'Открыть очередь',
      };
    }
    default:
      return { text: 'Уведомление' };
  }
}

export function buildButtons(
  rendered: RenderedNotification,
  miniAppUrl: string,
): InlineButton[][] | undefined {
  if (!rendered.deepLinkPath) return undefined;
  return [
    [
      {
        text: rendered.buttonText ?? 'Открыть',
        webAppUrl: `${miniAppUrl}${rendered.deepLinkPath}`,
      },
    ],
  ];
}
