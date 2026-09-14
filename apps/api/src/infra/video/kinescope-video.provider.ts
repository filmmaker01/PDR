import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '@/config/config.service';
import type {
  PlaybackRequest,
  PlaybackTicket,
  VideoProvider,
  VideoStatusResult,
  VideoUploadTarget,
} from './video.types';

const API_BASE = 'https://api.kinescope.io/v1';
const UPLOAD_BASE = 'https://uploader.kinescope.io/v2';
const EMBED_BASE = 'https://kinescope.io';

interface KinescopeVideo {
  id: string;
  status?: string;
  duration?: number;
}

/**
 * Kinescope: приватные видео и защищённый плеер.
 *
 * Наружу отдаётся только адрес плеера. Ссылки на поток (hls, mp4) сознательно
 * не запрашиваются и не возвращаются: любая из них воспроизводится без нашего
 * участия, и весь смысл проверки доступа на этом заканчивается.
 */
@Injectable()
export class KinescopeVideoProvider implements VideoProvider {
  readonly name = 'kinescope';
  private readonly logger = new Logger(KinescopeVideoProvider.name);

  constructor(private readonly config: AppConfigService) {}

  private async call<T>(path: string, init: RequestInit = {}, base = API_BASE): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.env.KINESCOPE_API_KEY}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Kinescope ${response.status}: ${text.slice(0, 300)}`);
    }
    return (await response.json()) as T;
  }

  async createUpload(input: { title: string }): Promise<VideoUploadTarget> {
    const parentId = this.config.env.KINESCOPE_PARENT_ID;
    const created = await this.call<{ data: KinescopeVideo }>('/videos', {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        ...(parentId ? { parent_id: parentId } : {}),
        privacy_type: 'nobody',
      }),
    });

    return {
      providerVideoId: created.data.id,
      instructions: 'Файл загружается через наш сервер: токен Kinescope не попадает в браузер.',
    };
  }

  /**
   * Загрузка файла.
   *
   * Идёт через наш бэкенд, а не напрямую из браузера: адрес загрузки
   * Kinescope требует основной токен доступа, и отдавать его в админку значит
   * отдать вместе с ним весь аккаунт.
   */
  async upload(input: {
    providerVideoId: string;
    body: NodeJS.ReadableStream;
    contentType: string;
    sizeBytes: number;
    fileName: string;
  }): Promise<void> {
    const response = await fetch(`${UPLOAD_BASE}/${input.providerVideoId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.env.KINESCOPE_API_KEY}`,
        'Content-Type': input.contentType || 'application/octet-stream',
        'Content-Length': String(input.sizeBytes),
        'X-File-Name': encodeURIComponent(input.fileName),
        'X-Video-Id': input.providerVideoId,
      },
      // Тело читается потоком: файл не собирается в памяти целиком.
      // duplex обязателен для потокового тела и не описан в типах Node.
      body: input.body,
      duplex: 'half',
    } as unknown as RequestInit);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Kinescope upload ${response.status}: ${text.slice(0, 300)}`);
    }
  }

  async getStatus(providerVideoId: string): Promise<VideoStatusResult> {
    try {
      const result = await this.call<{ data: KinescopeVideo }>(`/videos/${providerVideoId}`);
      const raw = result.data.status ?? 'processing';
      const status: VideoStatusResult['status'] =
        raw === 'done' || raw === 'ready'
          ? 'ready'
          : raw === 'error' || raw === 'failed'
            ? 'failed'
            : raw === 'uploading'
              ? 'uploading'
              : 'processing';
      return { status, durationSec: result.data.duration ?? null };
    } catch (err) {
      this.logger.warn({ err, providerVideoId }, 'Не удалось получить статус видео');
      return { status: 'processing' };
    }
  }

  /**
   * Адрес плеера.
   *
   * drmauthtoken провайдер присылает обратно к нам, когда запрашивает
   * разрешение на воспроизведение: по нему мы находим сессию и заново
   * проверяем права. Поэтому адрес сам по себе ничего не открывает.
   */
  async issuePlayback(providerVideoId: string, request: PlaybackRequest): Promise<PlaybackTicket> {
    return {
      provider: this.name,
      // Плеер собирает клиент через официальный IFrame Player API, поэтому
      // здесь адрес ролика, а не готовый iframe с параметрами в строке.
      embedUrl: `${EMBED_BASE}/${providerVideoId}`,
      authToken: request.authToken,
      watermark: request.watermark || null,
      drm: request.drm,
      expiresAt: new Date(Date.now() + request.ttlSec * 1000),
    };
  }

  async delete(providerVideoId: string): Promise<void> {
    await this.call(`/videos/${providerVideoId}`, { method: 'DELETE' }).catch((err: unknown) => {
      this.logger.warn({ err, providerVideoId }, 'Не удалось удалить видео');
    });
  }
}
