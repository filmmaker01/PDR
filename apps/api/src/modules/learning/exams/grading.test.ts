import { describe, expect, it } from 'vitest';
import {
  gradeAnswer,
  gradeAttempt,
  normalizeShortAnswer,
  pickQuestions,
  type QuestionForGrading,
} from './grading';

describe('normalizeShortAnswer', () => {
  it('приводит регистр, пробелы, «ё» и убирает точку в конце', () => {
    expect(normalizeShortAnswer('  Крючок.  ')).toBe('крючок');
    expect(normalizeShortAnswer('СЪЁМНИК')).toBe('съемник');
    expect(normalizeShortAnswer('два   слова')).toBe('два слова');
  });
});

const single: QuestionForGrading = {
  id: 'q1',
  kind: 'single',
  points: 1,
  options: [
    { id: 'a', isCorrect: true },
    { id: 'b', isCorrect: false },
  ],
  acceptedAnswers: null,
};

const multiple: QuestionForGrading = {
  id: 'q2',
  kind: 'multiple',
  points: 2,
  options: [
    { id: 'a', isCorrect: true },
    { id: 'b', isCorrect: true },
    { id: 'c', isCorrect: false },
  ],
  acceptedAnswers: null,
};

const shortText: QuestionForGrading = {
  id: 'q3',
  kind: 'short_text',
  points: 1,
  options: [],
  acceptedAnswers: ['крючок', 'PDR-крючок'],
};

describe('gradeAnswer', () => {
  it('одиночный выбор: верный вариант даёт балл', () => {
    expect(
      gradeAnswer(single, { questionId: 'q1', selectedOptionIds: ['a'], textAnswer: null }),
    ).toEqual({
      questionId: 'q1',
      isCorrect: true,
      pointsAwarded: 1,
    });
  });

  it('одиночный выбор: неверный вариант не даёт баллов', () => {
    expect(
      gradeAnswer(single, { questionId: 'q1', selectedOptionIds: ['b'], textAnswer: null })
        .pointsAwarded,
    ).toBe(0);
  });

  it('множественный выбор требует полного совпадения', () => {
    const full = gradeAnswer(multiple, {
      questionId: 'q2',
      selectedOptionIds: ['a', 'b'],
      textAnswer: null,
    });
    expect(full).toEqual({ questionId: 'q2', isCorrect: true, pointsAwarded: 2 });

    // Половина правильных ответов баллов не приносит.
    const partial = gradeAnswer(multiple, {
      questionId: 'q2',
      selectedOptionIds: ['a'],
      textAnswer: null,
    });
    expect(partial.pointsAwarded).toBe(0);

    const withExtra = gradeAnswer(multiple, {
      questionId: 'q2',
      selectedOptionIds: ['a', 'b', 'c'],
      textAnswer: null,
    });
    expect(withExtra.pointsAwarded).toBe(0);
  });

  it('короткий ответ не зависит от регистра, пробелов, «ё» и точки в конце', () => {
    for (const given of ['крючок', 'Крючок', '  КРЮЧОК  ', 'крючок.']) {
      expect(
        gradeAnswer(shortText, { questionId: 'q3', selectedOptionIds: [], textAnswer: given })
          .isCorrect,
      ).toBe(true);
    }
    expect(
      gradeAnswer(shortText, { questionId: 'q3', selectedOptionIds: [], textAnswer: 'молоток' })
        .isCorrect,
    ).toBe(false);
  });

  it('отсутствующий ответ считается неверным', () => {
    expect(gradeAnswer(single, undefined).pointsAwarded).toBe(0);
    expect(
      gradeAnswer(shortText, { questionId: 'q3', selectedOptionIds: [], textAnswer: '  ' })
        .isCorrect,
    ).toBe(false);
  });
});

describe('gradeAttempt', () => {
  it('считает процент по баллам, а не по числу вопросов', () => {
    const result = gradeAttempt(
      [single, multiple],
      [
        { questionId: 'q1', selectedOptionIds: ['a'], textAnswer: null },
        { questionId: 'q2', selectedOptionIds: ['a'], textAnswer: null },
      ],
      70,
    );
    expect(result.score).toBe(1);
    expect(result.maxScore).toBe(3);
    expect(result.percent).toBe(33);
    expect(result.passed).toBe(false);
  });

  it('порог сдачи применяется включительно', () => {
    const result = gradeAttempt(
      [single, multiple],
      [
        { questionId: 'q1', selectedOptionIds: ['a'], textAnswer: null },
        { questionId: 'q2', selectedOptionIds: ['a', 'b'], textAnswer: null },
      ],
      100,
    );
    expect(result.percent).toBe(100);
    expect(result.passed).toBe(true);
  });

  it('пустой тест не делит на ноль', () => {
    const result = gradeAttempt([], [], 70);
    expect(result.percent).toBe(0);
    expect(result.passed).toBe(false);
  });
});

describe('pickQuestions', () => {
  it('без перемешивания сохраняет порядок', () => {
    expect(pickQuestions(['a', 'b', 'c'], { shuffle: false, take: null })).toEqual(['a', 'b', 'c']);
  });

  it('берёт заданное количество', () => {
    expect(pickQuestions(['a', 'b', 'c', 'd'], { shuffle: false, take: 2 })).toEqual(['a', 'b']);
  });

  it('выборка больше банка возвращает весь банк', () => {
    expect(pickQuestions(['a', 'b'], { shuffle: false, take: 10 })).toHaveLength(2);
  });

  it('перемешивание сохраняет состав', () => {
    const result = pickQuestions(['a', 'b', 'c', 'd'], { shuffle: true, take: null }, () => 0.42);
    expect([...result].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
