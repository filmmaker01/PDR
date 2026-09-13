import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '@/config/config.service';
import type {
  PlaybackTicket,
  VideoProvider,
  VideoStatusResult,
  VideoUploadTarget,
} from './video.types';

/**
 * Заглушка видеоплатформы для разработки и тестов.
 * Запрещена на staging и production проверкой конфигурации.
 */
@Injectable()
export class MockVideoProvider implements VideoProvider {
  readonly name = 'mock';

  constructor(private readonly config: AppConfigService) {}

  async createUpload(input: { title: string }): Promise<VideoUploadTarget> {
    void input;
    const providerVideoId = randomUUID();
    return {
      providerVideoId,
      uploadUrl: `${this.config.env.PUBLIC_API_URL}/v1/admin/videos/mock-upload/${providerVideoId}`,
      expiresAt: new Date(Date.now() + 3600_000),
    };
  }

  async getStatus(providerVideoId: string): Promise<VideoStatusResult> {
    void providerVideoId;
    return { status: 'ready', durationSec: 600 };
  }

  async issuePlayback(
    providerVideoId: string,
    options: { userId: string; ttlSec: number },
  ): Promise<PlaybackTicket> {
    // HLS не отдаём: настоящего потока здесь нет, и элемент video показал бы
    // сломанный плеер. Встраивается страница-заглушка с объяснением.
    return {
      embedUrl: `${this.config.env.PUBLIC_API_URL}/v1/mock-player/${providerVideoId}?u=${options.userId}`,
      expiresAt: new Date(Date.now() + options.ttlSec * 1000),
    };
  }

  async delete(): Promise<void> {
    /* нечего удалять */
  }
}
