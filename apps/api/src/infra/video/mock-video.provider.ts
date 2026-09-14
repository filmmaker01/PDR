import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { AppConfigService } from '@/config/config.service';
import type {
  PlaybackRequest,
  PlaybackTicket,
  VideoProvider,
  VideoStatusResult,
  VideoUploadTarget,
} from './video.types';

/**
 * Заглушка видеоплатформы для разработки и тестов.
 *
 * Повторяет контракт настоящего провайдера буквально: отдаёт только адрес
 * страницы плеера с теми же параметрами, что и Kinescope. Благодаря этому
 * тесты проверяют ровно то поведение, которое будет в бою, и ни один ответ
 * API не содержит ссылки на поток.
 *
 * Запрещена на staging и production проверкой конфигурации.
 */
@Injectable()
export class MockVideoProvider implements VideoProvider {
  readonly name = 'mock';

  constructor(private readonly config: AppConfigService) {}

  private storagePath(providerVideoId: string): string {
    const root = resolve(process.cwd(), this.config.env.STORAGE_LOCAL_DIR);
    return join(root, 'video-mock', `${providerVideoId}.bin`);
  }

  async createUpload(input: { title: string }): Promise<VideoUploadTarget> {
    void input;
    return {
      providerVideoId: randomUUID(),
      instructions: 'Демо-провайдер: файл принимается нашим API и никуда не отправляется.',
    };
  }

  async upload(input: {
    providerVideoId: string;
    body: NodeJS.ReadableStream;
    contentType: string;
    sizeBytes: number;
    fileName: string;
  }): Promise<void> {
    const path = this.storagePath(input.providerVideoId);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(input.body, createWriteStream(path));
    await writeFile(
      `${path}.json`,
      JSON.stringify({ fileName: input.fileName, contentType: input.contentType }),
    );
  }

  async getStatus(providerVideoId: string): Promise<VideoStatusResult> {
    void providerVideoId;
    return { status: 'ready', durationSec: 600 };
  }

  async issuePlayback(providerVideoId: string, request: PlaybackRequest): Promise<PlaybackTicket> {
    return {
      provider: 'mock',
      embedUrl: `${this.config.env.PUBLIC_API_URL}/v1/mock-player/${providerVideoId}`,
      authToken: request.authToken,
      watermark: request.watermark || null,
      drm: request.drm,
      expiresAt: new Date(Date.now() + request.ttlSec * 1000),
    };
  }

  async delete(): Promise<void> {
    /* нечего удалять */
  }
}
