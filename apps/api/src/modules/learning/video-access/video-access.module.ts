import { Global, Module } from '@nestjs/common';
import { VideoSessionService } from './video-session.service';
import { VideoAuthorizeController } from './video-authorize.controller';

/**
 * Доступ к просмотру видео: сессии и проверка запросов провайдера.
 * Глобальный, потому что отзыв сессий нужен и в доступах, и в группах.
 */
@Global()
@Module({
  controllers: [VideoAuthorizeController],
  providers: [VideoSessionService],
  exports: [VideoSessionService],
})
export class VideoAccessModule {}
