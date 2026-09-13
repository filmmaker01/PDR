import { Injectable, Logger } from '@nestjs/common';
import type { FileScope, StoredFile, User } from '@prisma/client';

export interface FileAccessRequest {
  file: StoredFile;
  user: User;
  platformRoles: string[];
  /** Чтение или изменение/удаление. */
  intent: 'read' | 'write';
}

export type FileAccessChecker = (request: FileAccessRequest) => Promise<boolean>;

/**
 * Кто может получить ссылку на файл.
 *
 * Проверка идёт не по scope как таковому, а по привязке файла к сущности:
 * фото заказа — участникам мастерской заказа, работа ученика — автору,
 * куратору его группы и администратору. Модули регистрируют свои проверки
 * здесь, а по умолчанию доступ запрещён: новый scope без проверки закрыт.
 */
@Injectable()
export class FileAccessRegistry {
  private readonly logger = new Logger(FileAccessRegistry.name);
  private readonly checkers = new Map<FileScope, FileAccessChecker>();

  register(scope: FileScope, checker: FileAccessChecker): void {
    this.checkers.set(scope, checker);
  }

  async isAllowed(request: FileAccessRequest): Promise<boolean> {
    // Загрузивший всегда видит собственный файл, пока тот не привязан к чужой сущности.
    const checker = this.checkers.get(request.file.scope);
    if (!checker) {
      this.logger.warn(
        { scope: request.file.scope },
        'Нет проверки доступа для типа файла, доступ запрещён',
      );
      return request.file.ownerUserId === request.user.id;
    }
    return checker(request);
  }
}
