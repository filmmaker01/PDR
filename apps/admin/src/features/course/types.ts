export interface CourseVersionSummary {
  id: string;
  versionNo: number;
  status: 'draft' | 'published' | 'archived';
  publishedAt: string | null;
  changelog: string | null;
}

export interface CourseSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  isActive: boolean;
  versions: CourseVersionSummary[];
}

export interface MaterialNode {
  id: string;
  kind: 'file' | 'link' | 'text';
  title: string;
  fileId: string | null;
  url: string | null;
  body: string | null;
}

export interface LessonNode {
  id: string;
  key: string;
  position: number;
  title: string;
  description: string | null;
  isRequired: boolean;
  minWatchPercent: number;
  estimatedMinutes: number | null;
  video: { id: string; title: string; status: string; durationSec: number | null } | null;
  materials: MaterialNode[];
}

export interface AssignmentNode {
  id: string;
  key: string;
  title: string;
  instructions: string;
  isRequired: boolean;
  lessonId: string | null;
  requiredMedia: { min_photos?: number; min_videos?: number; text_required?: boolean };
  maxVideoSec: number | null;
}

export interface QuestionNode {
  id: string;
  position: number;
  kind: 'single' | 'multiple' | 'boolean' | 'short_text';
  body: string;
  explanation: string | null;
  points: number;
  acceptedAnswers: string[] | null;
  options: { id: string; body: string; isCorrect: boolean }[];
}

export interface ExamNode {
  id: string;
  key: string;
  title: string;
  kind: 'test' | 'practical';
  passingScore: number;
  maxAttempts: number | null;
  timeLimitSec: number | null;
  cooldownHours: number;
  shuffleQuestions: boolean;
  questionsPerAttempt: number | null;
  showExplanations: boolean;
  isRequired: boolean;
  questions: QuestionNode[];
}

export interface StageNode {
  id: string;
  key: string;
  position: number;
  title: string;
  description: string | null;
  unlockDaysOffset: number;
  requiresPreviousStage: boolean;
  lessons: LessonNode[];
  assignments: AssignmentNode[];
  exams: ExamNode[];
}

export interface VersionTree {
  id: string;
  courseId: string;
  versionNo: number;
  status: 'draft' | 'published' | 'archived';
  publishedAt: string | null;
  changelog: string | null;
  stages: StageNode[];
}

export interface VideoAssetRow {
  id: string;
  title: string;
  status: string;
  durationSec: number | null;
  provider: string;
  createdAt: string;
}

export interface PublishIssue {
  path: string;
  message: string;
}
