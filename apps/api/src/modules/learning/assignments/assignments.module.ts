import { Module, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { FileAccessRegistry } from '@/modules/files/file-access.registry';
import { CompletionFactsRegistry } from '@/modules/learning/progress/completion-facts.registry';
import { SubmissionsService } from './submissions.service';
import { ReviewsService } from './reviews.service';
import { SubmissionsController } from './submissions.controller';
import { ReviewsController } from './reviews.controller';
import { ReleaseStaleClaimsHandler } from './jobs/release-stale-claims.handler';

@Module({
  controllers: [SubmissionsController, ReviewsController],
  providers: [SubmissionsService, ReviewsService, ReleaseStaleClaimsHandler],
  exports: [SubmissionsService, ReviewsService],
})
export class AssignmentsModule implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly submissions: SubmissionsService,
    private readonly facts: CompletionFactsRegistry,
    private readonly fileAccess: FileAccessRegistry,
  ) {}

  onModuleInit(): void {
    // Принятые работы становятся источником фактов для правил открытия этапов.
    this.facts.registerAcceptedAssignments((enrollmentId) =>
      this.submissions.acceptedAssignmentKeys(enrollmentId),
    );

    /**
     * Файл работы виден автору, куратору его группы и администратору.
     * Проверка идёт по привязке файла к сдаче, а не по типу файла.
     */
    this.fileAccess.register('submission', async ({ file, user, platformRoles }) => {
      if (file.ownerUserId === user.id) return true;
      if (platformRoles.includes('admin')) return true;
      if (!platformRoles.includes('curator')) return false;

      const link = await this.prisma.submissionFile.findFirst({
        where: { fileId: file.id },
        select: { submission: { select: { enrollment: { select: { cohortId: true } } } } },
      });
      if (!link) return false;

      const isCurator = await this.prisma.cohortCurator.findUnique({
        where: {
          cohortId_userId: {
            cohortId: link.submission.enrollment.cohortId,
            userId: user.id,
          },
        },
        select: { cohortId: true },
      });
      return isCurator !== null;
    });
  }
}
