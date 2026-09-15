import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './bootstrap';

/**
 * Обработчик запроса для функции Vercel.
 *
 * Между вызовами контейнер переиспользуется, поэтому приложение поднимается
 * один раз и кэшируется: иначе каждый запрос платил бы за подключение к базе
 * и построение графа зависимостей.
 *
 * Файл собирается обычным `nest build`, потому что NestJS полагается на
 * `emitDecoratorMetadata`: его даёт `tsc`, но не сборщик функций. В каталоге
 * `api/` лежит только тонкая обёртка над собранным файлом.
 */
type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void;

let cached: Promise<NodeHandler> | null = null;

async function boot(): Promise<NodeHandler> {
  const { app, server } = await createApp();
  await app.init();
  return server as unknown as NodeHandler;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Сбой инициализации не должен закешироваться навсегда: следующий запрос
  // должен получить новую попытку, иначе разовая недоступность базы
  // «залипает» на всё время жизни контейнера.
  if (!cached) {
    cached = boot().catch((err: unknown) => {
      cached = null;
      throw err;
    });
  }

  const server = await cached;
  server(req, res);
}
