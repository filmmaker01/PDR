import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import {
  CurrentAuth,
  PlatformRoles,
  type AuthContext,
} from '@/modules/auth/decorators/auth.decorators';
import { Audited } from '@/modules/audit/audit.interceptor';
import { CatalogService } from './catalog.service';
import { CourseEditorService } from './course-editor.service';
import { VideoService } from './video.service';
import {
  createAssignmentSchema,
  createCourseSchema,
  createExamSchema,
  createLessonSchema,
  createMaterialSchema,
  createStageSchema,
  createVideoSchema,
  publishSchema,
  reorderSchema,
  updateAssignmentSchema,
  updateCourseSchema,
  updateExamSchema,
  updateLessonSchema,
  updateStageSchema,
  upsertQuestionSchema,
} from './dto/catalog.dto';

/**
 * Редактор курса. Работает только с черновиком: опубликованная версия
 * неизменяема, поэтому правки не могут повлиять на идущие группы.
 */
@ApiTags('admin')
@Controller('admin')
@PlatformRoles('admin')
export class AdminCatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly editor: CourseEditorService,
    private readonly video: VideoService,
  ) {}

  // ── Курсы и версии ─────────────────────────────────────────────────────────

  @Get('courses')
  @ApiOperation({ summary: 'Курсы и их версии' })
  async listCourses() {
    const courses = await this.catalog.listCourses();
    return courses.map((course) => ({
      id: course.id,
      slug: course.slug,
      title: course.title,
      description: course.description,
      isActive: course.isActive,
      versions: course.versions.map((v) => ({
        id: v.id,
        versionNo: v.versionNo,
        status: v.status,
        publishedAt: v.publishedAt?.toISOString() ?? null,
        changelog: v.changelog,
      })),
    }));
  }

  @Post('courses')
  @Audited({ entityType: 'course', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Создание курса с пустым черновиком' })
  async createCourse(
    @Body(zodBody(createCourseSchema))
    body: {
      slug: string;
      title: string;
      description?: string | null;
    },
  ) {
    const course = await this.catalog.createCourse(body);
    return { id: course.id, slug: course.slug, title: course.title };
  }

  @Patch('courses/:courseId')
  @Audited({ entityType: 'course', idFrom: { param: 'courseId' } })
  @ApiOperation({ summary: 'Изменение курса' })
  async updateCourse(
    @Param('courseId') courseId: string,
    @Body(zodBody(updateCourseSchema)) body: Record<string, unknown>,
  ) {
    const course = await this.catalog.updateCourse(courseId, body);
    return { id: course.id, title: course.title, isActive: course.isActive };
  }

  @Get('courses/:courseId/versions')
  @ApiOperation({ summary: 'Версии курса' })
  async listVersions(@Param('courseId') courseId: string) {
    const versions = await this.catalog.listVersions(courseId);
    return versions.map((v) => ({
      id: v.id,
      versionNo: v.versionNo,
      status: v.status,
      publishedAt: v.publishedAt?.toISOString() ?? null,
      changelog: v.changelog,
    }));
  }

  @Post('courses/:courseId/draft')
  @Audited({
    entityType: 'course_version',
    action: 'create_draft',
    idFrom: { responseField: 'id' },
  })
  @ApiOperation({ summary: 'Черновик из последней опубликованной версии' })
  async createDraft(@Param('courseId') courseId: string) {
    const draft = await this.catalog.createDraft(courseId);
    return { id: draft.id, versionNo: draft.versionNo, status: draft.status };
  }

  @Get('course-versions/:versionId')
  @ApiOperation({ summary: 'Полная структура версии курса' })
  async getVersion(@Param('versionId') versionId: string) {
    const version = await this.catalog.getVersionTree(versionId);
    return {
      id: version.id,
      courseId: version.courseId,
      versionNo: version.versionNo,
      status: version.status,
      publishedAt: version.publishedAt?.toISOString() ?? null,
      changelog: version.changelog,
      stages: version.stages.map((stage) => ({
        id: stage.id,
        key: stage.key,
        position: stage.position,
        title: stage.title,
        description: stage.description,
        unlockDaysOffset: stage.unlockDaysOffset,
        requiresPreviousStage: stage.requiresPreviousStage,
        lessons: stage.lessons.map((lesson) => ({
          id: lesson.id,
          key: lesson.key,
          position: lesson.position,
          title: lesson.title,
          description: lesson.description,
          isRequired: lesson.isRequired,
          minWatchPercent: lesson.minWatchPercent,
          estimatedMinutes: lesson.estimatedMinutes,
          video: lesson.videoAsset
            ? {
                id: lesson.videoAsset.id,
                title: lesson.videoAsset.title,
                status: lesson.videoAsset.status,
                durationSec: lesson.videoAsset.durationSec,
              }
            : null,
          materials: lesson.materials.map((m) => ({
            id: m.id,
            kind: m.kind,
            title: m.title,
            fileId: m.fileId,
            url: m.url,
            body: m.body,
          })),
        })),
        assignments: stage.assignments.map((a) => ({
          id: a.id,
          key: a.key,
          title: a.title,
          instructions: a.instructions,
          isRequired: a.isRequired,
          lessonId: a.lessonId,
          requiredMedia: a.requiredMedia,
          maxVideoSec: a.maxVideoSec,
        })),
        exams: stage.exams.map((e) => ({
          id: e.id,
          key: e.key,
          title: e.title,
          kind: e.kind,
          passingScore: e.passingScore,
          maxAttempts: e.maxAttempts,
          timeLimitSec: e.timeLimitSec,
          cooldownHours: e.cooldownHours,
          shuffleQuestions: e.shuffleQuestions,
          questionsPerAttempt: e.questionsPerAttempt,
          showExplanations: e.showExplanations,
          isRequired: e.isRequired,
          questions: e.questions.map((q) => ({
            id: q.id,
            position: q.position,
            kind: q.kind,
            body: q.body,
            explanation: q.explanation,
            points: q.points,
            acceptedAnswers: q.acceptedAnswers,
            options: q.options.map((o) => ({ id: o.id, body: o.body, isCorrect: o.isCorrect })),
          })),
        })),
      })),
    };
  }

  @Get('course-versions/:versionId/validate')
  @ApiOperation({ summary: 'Проверка готовности версии к публикации' })
  async validate(@Param('versionId') versionId: string) {
    const issues = await this.catalog.validateForPublish(versionId);
    return { ready: issues.length === 0, issues };
  }

  @Post('course-versions/:versionId/publish')
  @Audited({ entityType: 'course_version', action: 'publish', idFrom: { param: 'versionId' } })
  @ApiOperation({ summary: 'Публикация версии' })
  async publish(
    @CurrentAuth() auth: AuthContext,
    @Param('versionId') versionId: string,
    @Body(zodBody(publishSchema)) body: { changelog?: string | null },
  ) {
    const version = await this.catalog.publish(versionId, auth.user.id, body.changelog);
    return { id: version.id, versionNo: version.versionNo, status: version.status };
  }

  // ── Этапы ──────────────────────────────────────────────────────────────────

  @Post('course-versions/:versionId/stages')
  @Audited({ entityType: 'stage', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Добавление этапа' })
  async createStage(
    @Param('versionId') versionId: string,
    @Body(zodBody(createStageSchema)) body: Record<string, never>,
  ) {
    const stage = await this.editor.createStage(versionId, body as never);
    return { id: stage.id, key: stage.key, position: stage.position };
  }

  @Post('course-versions/:versionId/stages/reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited({
    entityType: 'course_version',
    action: 'reorder_stages',
    idFrom: { param: 'versionId' },
  })
  @ApiOperation({ summary: 'Изменение порядка этапов' })
  async reorderStages(
    @Param('versionId') versionId: string,
    @Body(zodBody(reorderSchema)) body: { order: string[] },
  ): Promise<void> {
    await this.editor.reorderStages(versionId, body.order);
  }

  @Patch('stages/:stageId')
  @Audited({ entityType: 'stage', idFrom: { param: 'stageId' } })
  @ApiOperation({ summary: 'Изменение этапа' })
  async updateStage(
    @Param('stageId') stageId: string,
    @Body(zodBody(updateStageSchema)) body: Record<string, never>,
  ) {
    const stage = await this.editor.updateStage(stageId, body as never);
    return { id: stage.id, title: stage.title };
  }

  @Delete('stages/:stageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited({ entityType: 'stage', action: 'delete', idFrom: { param: 'stageId' } })
  @ApiOperation({ summary: 'Удаление этапа' })
  async deleteStage(@Param('stageId') stageId: string): Promise<void> {
    await this.editor.deleteStage(stageId);
  }

  // ── Уроки и материалы ──────────────────────────────────────────────────────

  @Post('stages/:stageId/lessons')
  @Audited({ entityType: 'lesson', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Добавление урока' })
  async createLesson(
    @Param('stageId') stageId: string,
    @Body(zodBody(createLessonSchema)) body: Record<string, never>,
  ) {
    const lesson = await this.editor.createLesson(stageId, body as never);
    return { id: lesson.id, key: lesson.key, position: lesson.position };
  }

  @Post('stages/:stageId/lessons/reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Изменение порядка уроков' })
  async reorderLessons(
    @Param('stageId') stageId: string,
    @Body(zodBody(reorderSchema)) body: { order: string[] },
  ): Promise<void> {
    await this.editor.reorderLessons(stageId, body.order);
  }

  @Patch('lessons/:lessonId')
  @Audited({ entityType: 'lesson', idFrom: { param: 'lessonId' } })
  @ApiOperation({ summary: 'Изменение урока' })
  async updateLesson(
    @Param('lessonId') lessonId: string,
    @Body(zodBody(updateLessonSchema)) body: Record<string, never>,
  ) {
    const lesson = await this.editor.updateLesson(lessonId, body as never);
    return { id: lesson.id, title: lesson.title };
  }

  @Delete('lessons/:lessonId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited({ entityType: 'lesson', action: 'delete', idFrom: { param: 'lessonId' } })
  @ApiOperation({ summary: 'Удаление урока' })
  async deleteLesson(@Param('lessonId') lessonId: string): Promise<void> {
    await this.editor.deleteLesson(lessonId);
  }

  @Post('lessons/:lessonId/materials')
  @ApiOperation({ summary: 'Добавление материала к уроку' })
  async createMaterial(
    @Param('lessonId') lessonId: string,
    @Body(zodBody(createMaterialSchema)) body: Record<string, never>,
  ) {
    const material = await this.editor.createMaterial(lessonId, body as never);
    return { id: material.id, title: material.title };
  }

  @Delete('materials/:materialId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удаление материала' })
  async deleteMaterial(@Param('materialId') materialId: string): Promise<void> {
    await this.editor.deleteMaterial(materialId);
  }

  // ── Задания ────────────────────────────────────────────────────────────────

  @Post('stages/:stageId/assignments')
  @Audited({ entityType: 'assignment', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Добавление задания' })
  async createAssignment(
    @Param('stageId') stageId: string,
    @Body(zodBody(createAssignmentSchema)) body: Record<string, never>,
  ) {
    const assignment = await this.editor.createAssignment(stageId, body as never);
    return { id: assignment.id, key: assignment.key };
  }

  @Patch('assignments/:assignmentId')
  @Audited({ entityType: 'assignment', idFrom: { param: 'assignmentId' } })
  @ApiOperation({ summary: 'Изменение задания' })
  async updateAssignment(
    @Param('assignmentId') assignmentId: string,
    @Body(zodBody(updateAssignmentSchema)) body: Record<string, never>,
  ) {
    const assignment = await this.editor.updateAssignment(assignmentId, body as never);
    return { id: assignment.id, title: assignment.title };
  }

  @Delete('assignments/:assignmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удаление задания' })
  async deleteAssignment(@Param('assignmentId') assignmentId: string): Promise<void> {
    await this.editor.deleteAssignment(assignmentId);
  }

  // ── Экзамены и вопросы ─────────────────────────────────────────────────────

  @Post('stages/:stageId/exams')
  @Audited({ entityType: 'exam', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Добавление экзамена или теста' })
  async createExam(
    @Param('stageId') stageId: string,
    @Body(zodBody(createExamSchema)) body: Record<string, never>,
  ) {
    const exam = await this.editor.createExam(stageId, body as never);
    return { id: exam.id, key: exam.key, kind: exam.kind };
  }

  @Patch('exams/:examId')
  @Audited({ entityType: 'exam', idFrom: { param: 'examId' } })
  @ApiOperation({ summary: 'Изменение экзамена' })
  async updateExam(
    @Param('examId') examId: string,
    @Body(zodBody(updateExamSchema)) body: Record<string, never>,
  ) {
    const exam = await this.editor.updateExam(examId, body as never);
    return { id: exam.id, title: exam.title };
  }

  @Delete('exams/:examId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удаление экзамена' })
  async deleteExam(@Param('examId') examId: string): Promise<void> {
    await this.editor.deleteExam(examId);
  }

  @Post('exams/:examId/questions')
  @ApiOperation({ summary: 'Создание или замена вопроса вместе с вариантами' })
  async upsertQuestion(
    @Param('examId') examId: string,
    @Body(zodBody(upsertQuestionSchema)) body: Record<string, never>,
  ) {
    const question = await this.editor.upsertQuestion(examId, body as never);
    return { id: question.id, position: question.position };
  }

  @Delete('questions/:questionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удаление вопроса' })
  async deleteQuestion(@Param('questionId') questionId: string): Promise<void> {
    await this.editor.deleteQuestion(questionId);
  }

  // ── Видео ──────────────────────────────────────────────────────────────────

  @Get('videos')
  @ApiOperation({ summary: 'Загруженные видео' })
  async listVideos() {
    const videos = await this.video.list();
    return videos.map((v) => ({
      id: v.id,
      title: v.title,
      status: v.status,
      durationSec: v.durationSec,
      provider: v.provider,
      createdAt: v.createdAt.toISOString(),
    }));
  }

  @Post('videos')
  @Audited({ entityType: 'video', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Начало загрузки видео' })
  async createVideo(
    @CurrentAuth() auth: AuthContext,
    @Body(zodBody(createVideoSchema)) body: { title: string },
  ) {
    const result = await this.video.createUpload(body.title, auth.user.id);
    return {
      id: result.asset.id,
      status: result.asset.status,
      uploadUrl: result.uploadUrl,
      instructions: result.instructions,
    };
  }

  @Get('videos/:videoId')
  @ApiOperation({ summary: 'Статус видео' })
  async getVideo(@Param('videoId') videoId: string) {
    const asset = await this.video.refreshStatus(videoId);
    return {
      id: asset.id,
      title: asset.title,
      status: asset.status,
      durationSec: asset.durationSec,
      error: asset.error,
    };
  }

  @Delete('videos/:videoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удаление видео' })
  async deleteVideo(@Param('videoId') videoId: string): Promise<void> {
    await this.video.remove(videoId);
  }
}
