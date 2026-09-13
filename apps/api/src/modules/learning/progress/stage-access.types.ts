/** Чего не хватает для завершения этапа. */
export type MissingRequirement = 'lessons' | 'assignments' | 'exams';

export type LockReason =
  | { code: 'no_course_access'; message: string }
  | { code: 'date'; opensAt: string; message: string }
  | {
      code: 'previous_stage';
      stageKey: string;
      stageTitle: string;
      missing: MissingRequirement[];
      message: string;
    }
  | { code: 'manual_lock'; reason: string; message: string }
  | { code: 'enrollment_inactive'; status: string; message: string };

export type StageAccess =
  | { status: 'open' }
  | { status: 'completed'; completedAt: string }
  | { status: 'locked'; reasons: LockReason[]; opensAt: string | null };

export interface StageRequirementProgress {
  lessons: { done: number; total: number };
  assignments: { done: number; total: number };
  exams: { done: number; total: number };
}
