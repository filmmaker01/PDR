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
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { AppError } from '@/common/errors/app.error';
import {
  CurrentAuth,
  PlatformRoles,
  type AuthContext,
} from '@/modules/auth/decorators/auth.decorators';
import { Audited } from '@/modules/audit/audit.interceptor';
import { CatalogService } from '@/modules/learning/catalog/catalog.service';
import { StageAccessService } from '@/modules/learning/progress/stage-access.service';
import { ProgressService } from '@/modules/learning/progress/progress.service';
import { CohortsService } from './cohorts.service';
import {
  bulkEnrollSchema,
  createCohortSchema,
  curatorSchema,
  enrollSchema,
  migrateSchema,
  overrideSchema,
  transferSchema,
  updateCohortSchema,
  updateEnrollmentSchema,
} from './dto/cohorts.dto';

const listStudentsQuery = z.object({
  cohortId: z.string().uuid().optional(),
  status: z.enum(['active', 'paused', 'withdrawn', 'completed']).optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

@ApiTags('admin')
@Controller('admin')
@PlatformRoles('admin')
export class AdminCohortsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cohorts: CohortsService,
    private readonly catalog: CatalogService,
    private readonly stageAccess: StageAccessService,
    private readonly progress: ProgressService,
  ) {}

  // ── Группы ─────────────────────────────────────────────────────────────────

  @Get('cohorts')
  @ApiOperation({ summary: 'Группы (потоки)' })
  async list(@Query('courseId') courseId?: string) {
    const cohorts = await this.cohorts.list(courseId);
    return Promise.all(
      cohorts.map(async (cohort) => {
        const version = await this.prisma.courseVersion.findUnique({
          where: { id: cohort.courseVersionId },
          select: { versionNo: true },
        });
        return {
          id: cohort.id,
          courseId: cohort.courseId,
          courseVersionId: cohort.courseVersionId,
          versionNo: version?.versionNo ?? null,
          title: cohort.title,
          unlockMode: cohort.unlockMode,
          startsAt: cohort.startsAt.toISOString(),
          stageDates: cohort.stageDates,
          isActive: cohort.isActive,
          studentsCount: cohort._count.enrollments,
        };
      }),
    );
  }

  @Post('cohorts')
  @Audited({ entityType: 'cohort', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Создание группы на опубликованной версии' })
  async create(@Body(zodBody(createCohortSchema)) body: Record<string, never>) {
    const cohort = await this.cohorts.create(body as never);
    return { id: cohort.id, title: cohort.title, courseVersionId: cohort.courseVersionId };
  }

  @Patch('cohorts/:cohortId')
  @Audited({ entityType: 'cohort', idFrom: { param: 'cohortId' } })
  @ApiOperation({ summary: 'Изменение группы' })
  async update(
    @Param('cohortId') cohortId: string,
    @Body(zodBody(updateCohortSchema)) body: Record<string, never>,
  ) {
    const cohort = await this.cohorts.update(cohortId, body as never);
    return { id: cohort.id, title: cohort.title, unlockMode: cohort.unlockMode };
  }

  @Get('cohorts/:cohortId')
  @ApiOperation({ summary: 'Группа с кураторами и учениками' })
  async get(@Param('cohortId') cohortId: string) {
    const cohort = await this.cohorts.getById(cohortId);
    const curators = await this.cohorts.listCurators(cohortId);
    const enrollments = await this.cohorts.listEnrollments(cohortId);
    const version = await this.prisma.courseVersion.findUnique({
      where: { id: cohort.courseVersionId },
      select: { versionNo: true, status: true },
    });

    return {
      id: cohort.id,
      courseId: cohort.courseId,
      courseVersionId: cohort.courseVersionId,
      version,
      title: cohort.title,
      unlockMode: cohort.unlockMode,
      startsAt: cohort.startsAt.toISOString(),
      stageDates: cohort.stageDates,
      isActive: cohort.isActive,
      curators: curators.map((c) => ({
        userId: c.user.id,
        name: [c.user.firstName, c.user.lastName].filter(Boolean).join(' '),
        username: c.user.username,
      })),
      students: enrollments.map((e) => ({
        enrollmentId: e.id,
        userId: e.user.id,
        name: [e.user.firstName, e.user.lastName].filter(Boolean).join(' '),
        username: e.user.username,
        status: e.status,
        startedAt: e.startedAt.toISOString(),
      })),
    };
  }

  @Post('cohorts/:cohortId/curators')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited({ entityType: 'cohort', action: 'add_curator', idFrom: { param: 'cohortId' } })
  @ApiOperation({ summary: 'Назначение куратора' })
  async addCurator(
    @Param('cohortId') cohortId: string,
    @Body(zodBody(curatorSchema)) body: { userId: string },
  ): Promise<void> {
    await this.cohorts.addCurator(cohortId, body.userId);
  }

  @Delete('cohorts/:cohortId/curators/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited({ entityType: 'cohort', action: 'remove_curator', idFrom: { param: 'cohortId' } })
  @ApiOperation({ summary: 'Снятие куратора' })
  async removeCurator(
    @Param('cohortId') cohortId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.cohorts.removeCurator(cohortId, userId);
  }

  @Post('cohorts/:cohortId/migrate-version')
  @Audited({ entityType: 'cohort', action: 'migrate_version', idFrom: { param: 'cohortId' } })
  @ApiOperation({ summary: 'Перенос группы на другую версию курса' })
  async migrate(
    @Param('cohortId') cohortId: string,
    @Body(zodBody(migrateSchema)) body: { courseVersionId: string; dryRun: boolean },
  ) {
    const report = body.dryRun
      ? await this.cohorts.previewMigration(cohortId, body.courseVersionId)
      : await this.cohorts.migrate(cohortId, body.courseVersionId);

    if (!body.dryRun) {
      // Требования могли измениться: пересчитываем завершение этапов.
      const enrollments = await this.prisma.enrollment.findMany({
        where: { cohortId },
        select: { id: true },
      });
      for (const enrollment of enrollments) {
        await this.progress.recalculate(enrollment.id);
      }
    }
    return { dryRun: body.dryRun, report };
  }

  // ── Зачисления ─────────────────────────────────────────────────────────────

  @Post('cohorts/:cohortId/enrollments')
  @Audited({ entityType: 'enrollment', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Зачисление ученика: доступ и запись одной транзакцией' })
  async enroll(
    @CurrentAuth() auth: AuthContext,
    @Param('cohortId') cohortId: string,
    @Body(zodBody(enrollSchema))
    body: {
      userId: string;
      startedAt?: Date;
      grantValidUntil?: Date | null;
      reason?: string | null;
    },
  ) {
    const enrollment = await this.cohorts.enroll({
      cohortId,
      userId: body.userId,
      startedAt: body.startedAt,
      grantValidUntil: body.grantValidUntil ?? null,
      reason: body.reason ?? null,
      grantedById: auth.user.id,
    });
    // Пересчёт сразу после зачисления: ученик получает сообщение об открытом этапе.
    await this.progress.recalculate(enrollment.id);
    return { id: enrollment.id, startedAt: enrollment.startedAt.toISOString() };
  }

  @Post('cohorts/:cohortId/enrollments/bulk')
  @ApiOperation({ summary: 'Массовое зачисление списком' })
  async enrollBulk(
    @CurrentAuth() auth: AuthContext,
    @Param('cohortId') cohortId: string,
    @Body(zodBody(bulkEnrollSchema))
    body: { userIds: string[]; startedAt?: Date; grantValidUntil?: Date | null },
  ) {
    const enrolled: string[] = [];
    const skipped: { userId: string; reason: string }[] = [];

    for (const userId of body.userIds) {
      try {
        const enrollment = await this.cohorts.enroll({
          cohortId,
          userId,
          startedAt: body.startedAt,
          grantValidUntil: body.grantValidUntil ?? null,
          grantedById: auth.user.id,
        });
        await this.progress.recalculate(enrollment.id);
        enrolled.push(enrollment.id);
      } catch (err) {
        skipped.push({ userId, reason: err instanceof Error ? err.message : 'ошибка' });
      }
    }
    return { enrolled: enrolled.length, skipped };
  }

  @Get('students')
  @ApiOperation({ summary: 'Ученики с прогрессом' })
  async students(@Query() query: Record<string, string>) {
    const parsed = listStudentsQuery.parse(query);

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        ...(parsed.cohortId ? { cohortId: parsed.cohortId } : {}),
        ...(parsed.status ? { status: parsed.status } : {}),
        ...(parsed.q
          ? {
              user: {
                OR: [
                  { firstName: { contains: parsed.q, mode: 'insensitive' } },
                  { lastName: { contains: parsed.q, mode: 'insensitive' } },
                  { username: { contains: parsed.q.replace(/^@/, ''), mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, username: true } },
        cohort: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: parsed.limit,
    });

    return Promise.all(
      enrollments.map(async (enrollment) => {
        const states = await this.stageAccess.getStageStates(enrollment.id);
        const current = states.find((s) => s.access.status === 'open');
        return {
          enrollmentId: enrollment.id,
          userId: enrollment.user.id,
          name: [enrollment.user.firstName, enrollment.user.lastName].filter(Boolean).join(' '),
          username: enrollment.user.username,
          cohort: enrollment.cohort,
          status: enrollment.status,
          startedAt: enrollment.startedAt.toISOString(),
          stagesDone: states.filter((s) => s.access.status === 'completed').length,
          stagesTotal: states.length,
          currentStage: current ? { key: current.stageKey, title: current.stageTitle } : null,
        };
      }),
    );
  }

  @Get('enrollments/:enrollmentId')
  @ApiOperation({ summary: 'Карточка прогресса ученика' })
  async enrollmentCard(@Param('enrollmentId') enrollmentId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, username: true, phone: true },
        },
        cohort: { include: { course: { select: { id: true, title: true } } } },
      },
    });
    if (!enrollment) throw AppError.notFound('Зачисление не найдено');

    const ctx = await this.stageAccess.loadContext(enrollmentId);
    const states = await this.stageAccess.getStageStates(enrollmentId);
    const lessonProgress = await this.progress.listLessonProgress(enrollmentId);
    const overrides = await this.progress.listOverrides(enrollmentId);
    const progressByKey = new Map(lessonProgress.map((p) => [p.lessonKey, p]));

    return {
      enrollmentId,
      user: {
        id: enrollment.user.id,
        name: [enrollment.user.firstName, enrollment.user.lastName].filter(Boolean).join(' '),
        username: enrollment.user.username,
        phone: enrollment.user.phone,
      },
      cohort: { id: enrollment.cohort.id, title: enrollment.cohort.title },
      course: enrollment.cohort.course,
      status: enrollment.status,
      startedAt: enrollment.startedAt.toISOString(),
      completedAt: enrollment.completedAt?.toISOString() ?? null,
      note: enrollment.note,
      access: {
        active: ctx.hasCourseAccess,
        validUntil: ctx.courseAccessValidUntil?.toISOString() ?? null,
      },
      stages: states.map((state) => {
        const stage = ctx.version.stages.find((s) => s.key === state.stageKey);
        return {
          key: state.stageKey,
          title: state.stageTitle,
          access: state.access,
          progress: state.progress,
          lessons: (stage?.lessons ?? []).map((lesson) => {
            const progress = progressByKey.get(lesson.key);
            return {
              key: lesson.key,
              title: lesson.title,
              isRequired: lesson.isRequired,
              completed: Boolean(progress?.completedAt),
              watchPercent: progress?.watchPercent ?? 0,
            };
          }),
        };
      }),
      overrides: overrides.map((o) => ({
        id: o.id,
        stageKey: o.stageKey,
        action: o.action,
        reason: o.reason,
        createdAt: o.createdAt.toISOString(),
        expiresAt: o.expiresAt?.toISOString() ?? null,
        createdBy: [o.createdBy.firstName, o.createdBy.lastName].filter(Boolean).join(' '),
      })),
    };
  }

  @Patch('enrollments/:enrollmentId')
  @Audited({ entityType: 'enrollment', idFrom: { param: 'enrollmentId' } })
  @ApiOperation({ summary: 'Изменение зачисления' })
  async updateEnrollment(
    @Param('enrollmentId') enrollmentId: string,
    @Body(zodBody(updateEnrollmentSchema)) body: Record<string, never>,
  ) {
    const enrollment = await this.cohorts.updateEnrollment(enrollmentId, body as never);
    await this.progress.recalculate(enrollmentId);
    return { id: enrollment.id, status: enrollment.status };
  }

  @Post('enrollments/:enrollmentId/transfer')
  @Audited({ entityType: 'enrollment', action: 'transfer', idFrom: { param: 'enrollmentId' } })
  @ApiOperation({ summary: 'Перевод ученика в другую группу того же курса' })
  async transfer(
    @Param('enrollmentId') enrollmentId: string,
    @Body(zodBody(transferSchema)) body: { cohortId: string },
  ) {
    const enrollment = await this.cohorts.transferEnrollment(enrollmentId, body.cohortId);
    await this.progress.recalculate(enrollmentId);
    return { id: enrollment.id, cohortId: enrollment.cohortId };
  }

  @Post('enrollments/:enrollmentId/stage-overrides')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited({
    entityType: 'enrollment',
    action: 'stage_override',
    idFrom: { param: 'enrollmentId' },
  })
  @ApiOperation({ summary: 'Ручное открытие или закрытие этапа с указанием причины' })
  async setOverride(
    @CurrentAuth() auth: AuthContext,
    @Param('enrollmentId') enrollmentId: string,
    @Body(zodBody(overrideSchema))
    body: { stageKey: string; action: 'unlock' | 'lock'; reason: string; expiresAt?: Date | null },
  ): Promise<void> {
    await this.progress.setOverride({
      enrollmentId,
      stageKey: body.stageKey,
      action: body.action,
      reason: body.reason,
      expiresAt: body.expiresAt ?? null,
      createdById: auth.user.id,
    });
  }

  @Delete('stage-overrides/:overrideId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Снятие ручного исключения' })
  async removeOverride(@Param('overrideId') overrideId: string): Promise<void> {
    await this.progress.removeOverride(overrideId);
  }
}
