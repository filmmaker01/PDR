import type { ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet } from '@pdr/ui';
import { haptic } from '@/shared/telegram';
import { IconCalendar, IconCamera, IconCar, IconChat, IconChevron, IconUser } from './Icons';

interface CreateAction {
  key: string;
  title: string;
  hint: string;
  color: string;
  Icon: ComponentType<{ size?: number }>;
  /** Право, без которого пункт не показывается. */
  permission: string;
  path: (workspaceId: string) => string;
}

/**
 * Всё, что создаётся в мастерской, — из одной кнопки.
 *
 * Каждый пункт ведёт в уже существующую форму: новый заказ и обращение —
 * их экраны, запись и клиент — окна календаря и списка клиентов, быстрая
 * оценка — обращение, которое сразу после сохранения открывает оценку по фото.
 * Своей логики создания здесь нет.
 */
const ACTIONS: CreateAction[] = [
  {
    key: 'order',
    title: 'Заказ',
    hint: 'Новый ремонт автомобиля',
    color: '#2f7cf6',
    Icon: IconCar,
    permission: 'orders.create',
    path: (ws) => `/workspace/${ws}/orders/new`,
  },
  {
    key: 'lead',
    title: 'Обращение',
    hint: 'Заявка или вопрос клиента',
    color: '#ff9500',
    Icon: IconChat,
    permission: 'leads.write',
    path: (ws) => `/workspace/${ws}/leads/new`,
  },
  {
    key: 'appointment',
    title: 'Запись в календарь',
    hint: 'Предварительная запись',
    color: '#34c759',
    Icon: IconCalendar,
    permission: 'appointments.write_own',
    path: (ws) => `/workspace/${ws}/calendar?new=1`,
  },
  {
    key: 'assessment',
    title: 'Быстрая оценка',
    hint: 'Оценить вмятину по фото',
    color: '#af52de',
    Icon: IconCamera,
    permission: 'leads.write',
    path: (ws) => `/workspace/${ws}/leads/new?assess=1`,
  },
  {
    key: 'client',
    title: 'Клиент',
    hint: 'Добавить нового клиента',
    color: '#8e8e93',
    Icon: IconUser,
    permission: 'clients.write',
    path: (ws) => `/workspace/${ws}/clients?new=1`,
  },
];

/** Пункты, доступные с такими правами: меню не обещает то, что сервер запретит. */
export function availableCreateActions(permissions: readonly string[]): CreateAction[] {
  return ACTIONS.filter((action) => permissions.includes(action.permission));
}

export function CreateSheet({
  open,
  onClose,
  workspaceId,
  permissions,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  permissions: readonly string[];
}) {
  const navigate = useNavigate();

  return (
    <Sheet open={open} onClose={onClose} title="Создать">
      <div className="ws-actions">
        {availableCreateActions(permissions).map(({ key, title, hint, color, Icon, path }) => (
          <button
            key={key}
            type="button"
            className="ws-action"
            onClick={() => {
              haptic('select');
              onClose();
              navigate(path(workspaceId));
            }}
          >
            <span className="ws-action__icon" style={{ background: color }}>
              <Icon size={22} />
            </span>
            <span className="ws-action__text">
              <span className="ws-action__title">{title}</span>
              <span className="ws-action__hint">{hint}</span>
            </span>
            <IconChevron className="ws-chevron" size={18} />
          </button>
        ))}
      </div>
    </Sheet>
  );
}
