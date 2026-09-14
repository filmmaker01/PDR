export type LockReason =
  | { code: 'no_course_access'; message: string }
  | { code: 'date'; opensAt: string; message: string }
  | {
      code: 'previous_stage';
      stageKey: string;
      stageTitle: string;
      missing: ('lessons' | 'assignments' | 'exams')[];
      message: string;
    }
  | { code: 'manual_lock'; reason: string; message: string }
  | { code: 'enrollment_inactive'; status: string; message: string };

export type StageAccess =
  | { status: 'open' }
  | { status: 'completed'; completedAt: string }
  | { status: 'locked'; reasons: LockReason[]; opensAt: string | null };

export interface RequirementCounts {
  done: number;
  total: number;
}

export interface StageProgress {
  lessons: RequirementCounts;
  assignments: RequirementCounts;
  exams: RequirementCounts;
}

export interface EnrollmentSummary {
  id: string;
  courseId: string;
  courseTitle: string;
  cohortTitle: string;
  status: string;
  startedAt: string;
  hasActiveAccess: boolean;
  accessValidUntil: string | null;
  stagesTotal: number;
  stagesDone: number;
}

export interface CourseMap {
  enrollmentId: string;
  courseTitle: string;
  cohortTitle: string;
  status: string;
  startedAt: string;
  access: { active: boolean; validUntil: string | null };
  overall: { lessons: RequirementCounts; stages: RequirementCounts };
  stages: {
    key: string;
    title: string;
    description: string | null;
    access: StageAccess;
    progress: StageProgress;
  }[];
}

export interface StageDetails {
  key: string;
  title: string;
  description: string | null;
  access: StageAccess;
  lessons: {
    key: string;
    title: string;
    isRequired: boolean;
    estimatedMinutes: number | null;
    minWatchPercent: number;
    hasVideo: boolean;
    materialsCount: number;
    progress: { completed: boolean; watchPercent: number; watchPositionSec: number };
  }[];
  assignments: { key: string; title: string; isRequired: boolean; accepted: boolean }[];
  exams: {
    key: string;
    title: string;
    kind: 'test' | 'practical';
    isRequired: boolean;
    passingScore: number;
    passed: boolean;
  }[];
}

export interface LessonDetails {
  key: string;
  stageKey: string;
  title: string;
  description: string | null;
  isRequired: boolean;
  minWatchPercent: number;
  estimatedMinutes: number | null;
  /**
   * Про видео известно только то, что оно есть и сколько идёт. Ни адреса
   * плеера, ни тем более ссылки на поток здесь нет: доступ к просмотру
   * запрашивается отдельно и живёт минуты.
   */
  video: {
    status: 'uploading' | 'processing' | 'ready' | 'failed';
    durationSec: number | null;
  } | null;
  materials: {
    id: string;
    kind: 'file' | 'link' | 'text';
    title: string;
    url: string | null;
    body: string | null;
    fileId: string | null;
  }[];
  assignments: { key: string; title: string }[];
  progress: { completed: boolean; watchPercent: number; watchPositionSec: number };
  navigation: { previousKey: string | null; nextKey: string | null };
}

/** Сессия просмотра: выдаётся отдельным запросом и быстро протухает. */
export interface PlaybackSession {
  sessionId: string;
  provider: string;
  /** Страница плеера провайдера. Не поток. */
  embedUrl: string;
  /** Токен, который плеер предъявит нашему серверу при запросе лицензии. */
  authToken: string;
  watermark: string | null;
  drm: boolean;
  expiresAt: string;
}
