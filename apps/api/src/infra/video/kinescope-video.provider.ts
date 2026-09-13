import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '@/config/config.service';
import type {
  PlaybackTicket,
  VideoProvider,
  VideoStatusResult,
  VideoUploadTarget,
} from './video.types';

const API_BASE = 'https://api.kinescope.io/v1';
const UPLOAD_BASE = 'https://uploader.kinescope.io/v2';

interface KinescopeVideo {
  id: string;
  status?: string;
  duration?: number;
  play_link?: string;
  embed_link?: string;
  hls_link?: string;
  poster?: { original?: string };
}

/**
 * Kinescope: приватные видео и защищённый плеер.
 * Доступ к воспроизведению выдаёт наш сервер — только после проверки того,
 * что этап открыт и доступ к курсу действует.
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
      // Kinescope принимает файл по TUS-протоколу на отдельный домен.
      uploadUrl: `${UPLOAD_BASE}/${created.data.id}`,
      instructions:
        'Загрузка выполняется протоколом TUS на uploader.kinescope.io с тем же токеном доступа.',
    };
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

  async issuePlayback(
    providerVideoId: string,
    options: { userId: string; ttlSec: number },
  ): Promise<PlaybackTicket> {
    const result = await this.call<{ data: KinescopeVideo }>(`/videos/${providerVideoId}`);
    void options.userId;
    return {
      embedUrl: result.data.embed_link ?? result.data.play_link,
      hlsUrl: result.data.hls_link,
      posterUrl: result.data.poster?.original,
      expiresAt: new Date(Date.now() + options.ttlSec * 1000),
    };
  }

  async delete(providerVideoId: string): Promise<void> {
    await this.call(`/videos/${providerVideoId}`, { method: 'DELETE' }).catch((err: unknown) => {
      this.logger.warn({ err, providerVideoId }, 'Не удалось удалить видео');
    });
  }
}
