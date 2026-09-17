/**
 * Обращение — единый входящий лид клиента: приехал лично, написал в
 * мессенджер, прислал фотографии или получил дистанционную оценку.
 *
 * Названия статусов и переходы общие для backend и Mini App: расхождение
 * означало бы, что интерфейс предлагает кнопку, которую сервер отклонит.
 */

import type { LeadChannel, LeadSource, LeadStatus } from './enums/index.js';

export const LEAD_STATUS_LABELS: Readonly<Record<LeadStatus, string>> = {
  new: 'Новое',
  estimated: 'Оценено',
  awaiting_decision: 'Ждёт решения',
  callback: 'Перезвонить',
  scheduled: 'Записан',
  rejected: 'Отказ',
};

export const LEAD_SOURCE_LABELS: Readonly<Record<LeadSource, string>> = {
  online: 'Онлайн',
  offline: 'Лично',
};

export const LEAD_CHANNEL_LABELS: Readonly<Record<LeadChannel, string>> = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  vk: 'VK',
  call: 'Звонок',
  in_person: 'Лично',
  other: 'Другое',
};

/** Канал по умолчанию подсказывает источник: из VK лично не приходят. */
export const LEAD_CHANNEL_SOURCES: Readonly<Record<LeadChannel, LeadSource>> = {
  telegram: 'online',
  whatsapp: 'online',
  vk: 'online',
  call: 'online',
  in_person: 'offline',
  other: 'offline',
};

/**
 * Переходы статусов.
 *
 * Порядок из брифа — Новое → Оценено → Ждёт решения → Перезвонить → Записан →
 * Отказ — это типичный путь, а не единственный: клиент может записаться сразу
 * после первого звонка, а отказаться — на любом шаге. Поэтому граф допускает
 * возвраты, но не оживляет отказ и не трогает превращённое в заказ обращение.
 */
export const LEAD_TRANSITIONS: Readonly<Record<LeadStatus, readonly LeadStatus[]>> = {
  new: ['estimated', 'awaiting_decision', 'callback', 'scheduled', 'rejected'],
  estimated: ['awaiting_decision', 'callback', 'scheduled', 'rejected'],
  awaiting_decision: ['callback', 'estimated', 'scheduled', 'rejected'],
  callback: ['awaiting_decision', 'estimated', 'scheduled', 'rejected'],
  scheduled: ['callback', 'awaiting_decision', 'rejected'],
  // Отказ — конец пути. Новое обращение того же клиента заводится заново,
  // иначе история «почему не срослось» затирается.
  rejected: [],
};

export function canTransitionLead(from: LeadStatus, to: LeadStatus): boolean {
  return LEAD_TRANSITIONS[from].includes(to);
}

export function allowedLeadTransitions(from: LeadStatus): readonly LeadStatus[] {
  return LEAD_TRANSITIONS[from];
}

/** Статусы, в которых обращение ещё в работе и должно попадать в счётчик на главной. */
export const OPEN_LEAD_STATUSES: readonly LeadStatus[] = [
  'new',
  'estimated',
  'awaiting_decision',
  'callback',
  'scheduled',
];

export function isOpenLeadStatus(status: LeadStatus): boolean {
  return OPEN_LEAD_STATUSES.includes(status);
}

/** Статусы, которым нужна дата следующего контакта, иначе обращение потеряется. */
export function requiresNextContact(status: LeadStatus): boolean {
  return status === 'callback';
}

export function leadStatusLabel(status: LeadStatus): string {
  return LEAD_STATUS_LABELS[status];
}

/** Подпись обращения в списке: «Иван Петров · Toyota Camry». */
export function leadTitle(lead: {
  contactName?: string | null;
  clientName?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
}): string {
  const who = lead.clientName?.trim() || lead.contactName?.trim() || 'Без имени';
  const car = [lead.vehicleMake, lead.vehicleModel].filter(Boolean).join(' ').trim();
  return car ? `${who} · ${car}` : who;
}
