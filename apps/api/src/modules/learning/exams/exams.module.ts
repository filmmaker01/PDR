import { Module, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { FileAccessRegistry } from '@/modules/files/file-access.registry';
import { CompletionFactsRegistry } from '@/modules/learning/progress/completion-facts.registry';
import { ExamsService } from './exams.service';
import { ExamsController } from './exams.controller';
import { AdminAttemptsController, ExamGradingController } from './exam-grading.controller';
import { ExpireAttemptsHandler } from './jobs/expire-attempts.handler';

@Module({
  controllers: [ExamsController, ExamGradingController, AdminAttemptsController],
  providers: [ExamsService, ExpireAttemptsHandler],
  exports: [ExamsService],
})
export class ExamsModule implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exams: ExamsService,
    private readonly facts: CompletionFactsRegistry,
    private readonly fileAccess: FileAccessRegistry,
  ) {}

  onModuleInit(): void {
    this.facts.registerPassedExams((enrollmentId) => this.exams.passedExamKeys(enrollmentId));

    // Материалы практического экзамена: автор, куратор его группы, администратор.
    this.fileAccess.register('exam_attempt', async ({ file, user, platformRoles }) => {
      if (file.ownerUserId === user.id) return true;
      if (platformRoles.includes('admin')) return true;
      if (!platformRoles.includes('curator')) return false;

      const link = await this.prisma.attemptFile.findFirst({
        where: { fileId: file.id },
        select: { attempt: { select: { enrollment: { select: { cohortId: true } } } } },
      });
      if (!link) return false;

      const isCurator = await this.prisma.cohortCurator.findUnique({
        where: {
          cohortId_userId: { cohortId: link.attempt.enrollment.cohortId, userId: user.id },
        },
        select: { cohortId: true },
      });
      return isCurator !== null;
    });
  }
}
