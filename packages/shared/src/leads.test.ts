import { describe, expect, it } from 'vitest';
import { LEAD_CHANNELS, LEAD_STATUSES } from './enums/index';
import {
  LEAD_CHANNEL_LABELS,
  LEAD_CHANNEL_SOURCES,
  LEAD_STATUS_LABELS,
  OPEN_LEAD_STATUSES,
  allowedLeadTransitions,
  canTransitionLead,
  isOpenLeadStatus,
  leadTitle,
  requiresNextContact,
} from './leads';

describe('справочник обращений', () => {
  it('у каждого статуса есть название', () => {
    for (const status of LEAD_STATUSES) {
      expect(LEAD_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it('у каждого канала есть название и источник по умолчанию', () => {
    for (const channel of LEAD_CHANNELS) {
      expect(LEAD_CHANNEL_LABELS[channel]).toBeTruthy();
      expect(['online', 'offline']).toContain(LEAD_CHANNEL_SOURCES[channel]);
    }
  });

  it('личный визит — офлайн, мессенджеры — онлайн', () => {
    expect(LEAD_CHANNEL_SOURCES.in_person).toBe('offline');
    expect(LEAD_CHANNEL_SOURCES.telegram).toBe('online');
    expect(LEAD_CHANNEL_SOURCES.whatsapp).toBe('online');
  });
});

describe('переходы статусов обращения', () => {
  it('проходит типичный путь из брифа', () => {
    expect(canTransitionLead('new', 'estimated')).toBe(true);
    expect(canTransitionLead('estimated', 'awaiting_decision')).toBe(true);
    expect(canTransitionLead('awaiting_decision', 'callback')).toBe(true);
    expect(canTransitionLead('callback', 'scheduled')).toBe(true);
  });

  it('отказаться можно на любом шаге', () => {
    for (const status of LEAD_STATUSES) {
      if (status === 'rejected') continue;
      expect(canTransitionLead(status, 'rejected')).toBe(true);
    }
  });

  it('записать можно сразу, минуя оценку', () => {
    expect(canTransitionLead('new', 'scheduled')).toBe(true);
  });

  it('отказ не оживает', () => {
    expect(allowedLeadTransitions('rejected')).toHaveLength(0);
    expect(canTransitionLead('rejected', 'new')).toBe(false);
  });

  it('вернуться в «Новое» нельзя ниоткуда', () => {
    for (const status of LEAD_STATUSES) {
      expect(canTransitionLead(status, 'new')).toBe(false);
    }
  });

  it('переход в самого себя переходом не считается', () => {
    for (const status of LEAD_STATUSES) {
      expect(canTransitionLead(status, status)).toBe(false);
    }
  });
});

describe('открытые обращения', () => {
  it('в счётчик попадает всё, кроме отказа', () => {
    expect(OPEN_LEAD_STATUSES).not.toContain('rejected');
    expect(isOpenLeadStatus('new')).toBe(true);
    expect(isOpenLeadStatus('rejected')).toBe(false);
  });

  it('«перезвонить» требует даты следующего контакта', () => {
    expect(requiresNextContact('callback')).toBe(true);
    expect(requiresNextContact('new')).toBe(false);
  });
});

describe('подпись обращения', () => {
  it('имя клиента из базы важнее контактного', () => {
    expect(leadTitle({ clientName: 'Иван Петров', contactName: 'иван' })).toBe('Иван Петров');
  });

  it('добавляет автомобиль, когда он известен', () => {
    expect(leadTitle({ contactName: 'Иван', vehicleMake: 'Toyota', vehicleModel: 'Camry' })).toBe(
      'Иван · Toyota Camry',
    );
  });

  it('без имени не оставляет пустую строку', () => {
    expect(leadTitle({ contactName: '  ' })).toBe('Без имени');
  });
});
