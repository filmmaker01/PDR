import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** Транзакционный клиент Prisma (внутри $transaction) либо обычный. */
export type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    (this as unknown as { $on: (e: string, cb: (p: { message: string }) => void) => void }).$on(
      'warn',
      (e) => this.logger.warn(e.message),
    );
    (this as unknown as { $on: (e: string, cb: (p: { message: string }) => void) => void }).$on(
      'error',
      (e) => this.logger.error(e.message),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Проверка живости БД для /health/ready. */
  async ping(): Promise<boolean> {
    await this.$queryRaw`SELECT 1`;
    return true;
  }

  /**
   * Транзакция с уровнем изоляции по умолчанию ReadCommitted и разумным таймаутом.
   * Единая точка, чтобы не разъезжались настройки по модулям.
   */
  async transaction<T>(
    fn: (tx: PrismaTx) => Promise<T>,
    options?: { timeoutMs?: number; isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T> {
    return this.$transaction(fn, {
      maxWait: 5_000,
      timeout: options?.timeoutMs ?? 15_000,
      isolationLevel: options?.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  }
}
