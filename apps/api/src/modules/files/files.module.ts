import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FileAccessRegistry } from './file-access.registry';
import { FilesProcessHandler } from './jobs/files-process.handler';
import { FilesCleanupHandler } from './jobs/files-cleanup.handler';

@Global()
@Module({
  controllers: [FilesController],
  providers: [FilesService, FileAccessRegistry, FilesProcessHandler, FilesCleanupHandler],
  exports: [FilesService, FileAccessRegistry],
})
export class FilesModule implements OnModuleInit {
  constructor(
    private readonly registry: FileAccessRegistry,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    // Аватар и выгрузка принадлежат конкретному пользователю.
    this.registry.register('avatar', async ({ file, user }) => file.ownerUserId === user.id);
    this.registry.register('export', async ({ file, user }) => file.ownerUserId === user.id);

    // Фото заказов доступны активным участникам мастерской-владельца.
    this.registry.register('order_photo', async ({ file, user }) => {
      if (!file.workspaceId) return false;
      const member = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: file.workspaceId, userId: user.id } },
        select: { isActive: true },
      });
      return member?.isActive === true;
    });

    // Учебные материалы, работы и экзамены подключают свои проверки
    // на этапах 5–8; до этого доступ есть только у загрузившего.
  }
}
