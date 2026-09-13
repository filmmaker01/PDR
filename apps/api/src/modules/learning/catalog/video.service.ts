import { Inject, Injectable, Logger } from '@nestjs/common';
import type { VideoAsset } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppConfigService } from '@/config/config.service';
import { AppError } from '@/common/errors/app.error';
import { JobsService } from '@/infra/jobs/jobs.service';
import { JOB } from '@/infra/jobs/job-queue';
import { VIDEO_PROVIDER } from '@/infra/video/video.module';
import type { PlaybackTicket, VideoProvider } from '@/infra/video/video.types';

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly jobs: JobsService,
    @Inject(VIDEO_PROVIDER) private readonly provider: VideoProvider,
  ) {}

  async createUpload(
    title: string,
    uploadedById: string,
  ): Promise<{ asset: VideoAsset; uploadUrl?: string; instructions?: string }> {
    const target = await this.provider.createUpload({ title });

    const asset = await this.prisma.videoAsset.create({
      data: {
        provider: this.provider.name,
        providerVideoId: target.providerVideoId,
        title,
        status: 'uploading',
        uploadedById,
      },
    });

    // Провайдер обрабатывает видео асинхронно: опрашиваем статус.
    await this.jobs.enqueue(
      JOB.videoPoll,
      { videoAssetId: asset.id },
      { startAfterSec: 60, retryLimit: 0, singletonKey: `video:${asset.id}` },
    );

    return { asset, uploadUrl: target.uploadUrl, instructions: target.instructions };
  }

  async list(limit = 100): Promise<VideoAsset[]> {
    return this.prisma.videoAsset.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  }

  async getById(videoAssetId: string): Promise<VideoAsset> {
    const asset = await this.prisma.videoAsset.findUnique({ where: { id: videoAssetId } });
    if (!asset) throw AppError.notFound('Видео не найдено');
    return asset;
  }

  /** Опрос статуса у провайдера; повторяется, пока видео не готово. */
  async refreshStatus(videoAssetId: string): Promise<VideoAsset> {
    const asset = await this.getById(videoAssetId);
    if (asset.status === 'ready' || asset.status === 'failed') return asset;

    const result = await this.provider.getStatus(asset.providerVideoId);
    const updated = await this.prisma.videoAsset.update({
      where: { id: videoAssetId },
      data: {
        status: result.status,
        durationSec: result.durationSec ?? asset.durationSec,
        error: result.error ?? null,
      },
    });

    if (updated.status !== 'ready' && updated.status !== 'failed') {
      await this.jobs.enqueue(
        JOB.videoPoll,
        { videoAssetId },
        { startAfterSec: 120, retryLimit: 0, singletonKey: `video:${videoAssetId}:${Date.now()}` },
      );
    }
    return updated;
  }

  /**
   * Билет на воспроизведение. Выдаётся только после проверки доступа —
   * вызывающий обязан убедиться, что этап открыт и доступ к курсу действует.
   */
  async issuePlayback(videoAssetId: string, userId: string): Promise<PlaybackTicket> {
    const asset = await this.getById(videoAssetId);
    if (asset.status !== 'ready') {
      throw new AppError('file_not_ready', 'Видео ещё обрабатывается, попробуйте позже');
    }
    return this.provider.issuePlayback(asset.providerVideoId, {
      userId,
      ttlSec: this.config.env.VIDEO_PLAYBACK_TTL_SEC,
    });
  }

  async remove(videoAssetId: string): Promise<void> {
    const asset = await this.getById(videoAssetId);
    const usedBy = await this.prisma.lesson.count({ where: { videoAssetId } });
    if (usedBy > 0) {
      throw AppError.conflict(`Видео используется в ${usedBy} урок(ах), сначала отвяжите его`);
    }
    await this.provider.delete(asset.providerVideoId);
    await this.prisma.videoAsset.delete({ where: { id: videoAssetId } });
  }

  /** Пометить готовым вручную — нужно в разработке с заглушкой провайдера. */
  async markReady(videoAssetId: string, durationSec: number | null): Promise<VideoAsset> {
    return this.prisma.videoAsset.update({
      where: { id: videoAssetId },
      data: { status: 'ready', durationSec },
    });
  }
}
