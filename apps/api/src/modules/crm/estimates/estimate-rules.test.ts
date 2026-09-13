import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ESTIMATE_TRANSITIONS,
  ESTIMATE_STATUS_LABELS,
  canTransitionEstimate,
  canVersion,
  isEstimateEditable,
  supersedesSourceOnNewVersion,
} from './estimate-rules';

describe('правила сметы', () => {
  it('править можно черновик и отправленную смету', () => {
    expect(isEstimateEditable('draft')).toBe(true);
    expect(isEstimateEditable('sent')).toBe(true);
    expect(isEstimateEditable('agreed')).toBe(false);
    expect(isEstimateEditable('rejected')).toBe(false);
    expect(isEstimateEditable('superseded')).toBe(false);
  });

  it('согласованную смету нельзя отклонить — только заменить', () => {
    expect(canTransitionEstimate('agreed', 'rejected')).toBe(false);
    expect(canTransitionEstimate('agreed', 'superseded')).toBe(true);
  });

  it('из заменённой сметы переходов нет', () => {
    expect(ALLOWED_ESTIMATE_TRANSITIONS.superseded).toEqual([]);
  });

  it('новую версию делают из отправленной, согласованной и отклонённой', () => {
    expect(canVersion('sent')).toBe(true);
    expect(canVersion('agreed')).toBe(true);
    expect(canVersion('rejected')).toBe(true);
    expect(canVersion('draft')).toBe(false);
    expect(canVersion('superseded')).toBe(false);
  });

  it('новая версия отменяет отправленную, но не согласованную', () => {
    expect(supersedesSourceOnNewVersion('sent')).toBe(true);
    expect(supersedesSourceOnNewVersion('rejected')).toBe(true);
    expect(supersedesSourceOnNewVersion('agreed')).toBe(false);
  });

  it('у каждого статуса есть название', () => {
    for (const status of Object.keys(ALLOWED_ESTIMATE_TRANSITIONS)) {
      expect(ESTIMATE_STATUS_LABELS[status as 'draft']).toBeTruthy();
    }
  });
});
