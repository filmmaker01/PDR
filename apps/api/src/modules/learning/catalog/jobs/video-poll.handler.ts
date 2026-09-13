import { Injectable } from '@nestjs/common';
import { JobHandler } from '@/infra/jobs/job-handler';
import { JOB } from '@/infra/jobs/job-queue';
import { VideoService } from '../video.service';

/** Опрос готовности видео у провайдера. */
@Injectable()
export class VideoPollHandler extends JobHandler<typeof JOB.videoPoll> {
  readonly jobName = JOB.videoPoll;

  constructor(private readonly video: VideoService) {
    super();
  }

  async handle(payload: { videoAssetId: string }): Promise<void> {
    await this.video.refreshStatus(payload.videoAssetId);
  }
}
