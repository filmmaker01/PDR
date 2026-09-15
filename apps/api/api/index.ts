import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Точка входа функции Vercel.
 *
 * Импорт идёт из собранного `dist`, а не из исходников: NestJS полагается на
 * `emitDecoratorMetadata`, который даёт `tsc` при `nest build`, но не даёт
 * сборщик функций. Поэтому приложение собирается заранее, а здесь только
 * запускается.
 *
 * Между вызовами функции контейнер переиспользуется, поэтому приложение
 * поднимается один раз и кэшируется: иначе каждый запрос платил бы за
 * подключение к базе и построение графа зависимостей.
 */
type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let cached: Promise<Handler> | null = null;

async function boot(): Promise<Handler> {
  const { createApp } = (await import('../dist/bootstrap.js')) as {
    createApp: () => Promise<{ app: { init: () => Promise<unknown> }; server: Handler }>;
  };

  const { app, server } = await createApp();
  await app.init();
  return server;
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
