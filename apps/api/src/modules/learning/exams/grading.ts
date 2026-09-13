/**
 * Автоматическая проверка теста.
 * Вынесена отдельно от сервиса, чтобы правила начисления баллов
 * можно было проверить модульными тестами без базы.
 */

export interface QuestionForGrading {
  id: string;
  kind: 'single' | 'multiple' | 'boolean' | 'short_text';
  points: number;
  options: { id: string; isCorrect: boolean }[];
  acceptedAnswers: string[] | null;
}

export interface AnswerInput {
  questionId: string;
  selectedOptionIds: string[];
  textAnswer: string | null;
}

export interface GradedAnswer {
  questionId: string;
  isCorrect: boolean;
  pointsAwarded: number;
}

export interface GradingResult {
  answers: GradedAnswer[];
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
}

/** Нормализация короткого ответа: регистр, пробелы и «ё» не должны решать. */
export function normalizeShortAnswer(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:]+$/g, '');
}

export function gradeAnswer(
  question: QuestionForGrading,
  answer: AnswerInput | undefined,
): GradedAnswer {
  const empty: GradedAnswer = { questionId: question.id, isCorrect: false, pointsAwarded: 0 };
  if (!answer) return empty;

  if (question.kind === 'short_text') {
    const given = answer.textAnswer ? normalizeShortAnswer(answer.textAnswer) : '';
    if (!given) return empty;
    const accepted = (question.acceptedAnswers ?? []).map(normalizeShortAnswer);
    const correct = accepted.includes(given);
    return {
      questionId: question.id,
      isCorrect: correct,
      pointsAwarded: correct ? question.points : 0,
    };
  }

  const correctIds = new Set(question.options.filter((o) => o.isCorrect).map((o) => o.id));
  const selected = new Set(answer.selectedOptionIds);

  // Частичные баллы намеренно не начисляются: половина правильных вариантов
  // в вопросе с множественным выбором не означает знания темы.
  const correct =
    selected.size === correctIds.size && [...selected].every((id) => correctIds.has(id));

  return {
    questionId: question.id,
    isCorrect: correct,
    pointsAwarded: correct ? question.points : 0,
  };
}

export function gradeAttempt(
  questions: QuestionForGrading[],
  answers: AnswerInput[],
  passingScore: number,
): GradingResult {
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  const graded = questions.map((question) => gradeAnswer(question, byQuestion.get(question.id)));

  const score = graded.reduce((sum, a) => sum + a.pointsAwarded, 0);
  const maxScore = questions.reduce((sum, q) => sum + q.points, 0);
  const percent = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

  return { answers: graded, score, maxScore, percent, passed: percent >= passingScore };
}

/** Выборка и перемешивание вопросов для попытки. */
export function pickQuestions(
  questionIds: string[],
  options: { shuffle: boolean; take: number | null },
  random: () => number = Math.random,
): string[] {
  let pool = [...questionIds];
  if (options.shuffle) {
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
  }
  if (options.take && options.take < pool.length) pool = pool.slice(0, options.take);
  return pool;
}
