import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '@/config/config.service';
import { KinescopeVideoProvider } from './kinescope-video.provider';
import { MockVideoProvider } from './mock-video.provider';
import { MockPlayerController } from './mock-player.controller';
import type { VideoProvider } from './video.types';

export const VIDEO_PROVIDER = Symbol('VIDEO_PROVIDER');

@Global()
@Module({
  // Заглушка плеера нужна только демо-режиму; при VIDEO_PROVIDER=kinescope
  // маршрут не регистрируется.
  controllers: process.env.VIDEO_PROVIDER === 'kinescope' ? [] : [MockPlayerController],
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
