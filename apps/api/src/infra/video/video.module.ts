import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '@/config/config.service';
import { KinescopeVideoProvider } from './kinescope-video.provider';
import { MockVideoProvider } from './mock-video.provider';
import type { VideoProvider } from './video.types';

export const VIDEO_PROVIDER = Symbol('VIDEO_PROVIDER');

@Global()
@Module({
  providers: [
    {
      provide: VIDEO_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): VideoProvider =>
        config.env.VIDEO_PROVIDER === 'kinescope'
          ? new KinescopeVideoProvider(config)
          : new MockVideoProvider(config),
    },
  ],
  exports: [VIDEO_PROVIDER],
})
export class VideoModule {}
