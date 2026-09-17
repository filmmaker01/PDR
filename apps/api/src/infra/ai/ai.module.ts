import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '@/config/config.service';
import { DisabledDamageVisionProvider } from './disabled-damage-vision.provider';
import { MockDamageVisionProvider } from './mock-damage-vision.provider';
import { OpenAiDamageVisionProvider } from './openai-damage-vision.provider';
import type { DamageVisionProvider } from './ai.types';

export const DAMAGE_VISION_PROVIDER = Symbol('DAMAGE_VISION_PROVIDER');

/**
 * Разбор фотографии повреждения за адаптером — по образцу видеоплатформы.
 *
 * По умолчанию провайдер выключен: приложение поднимается и работает без
 * внешнего ключа, а AI-оценка честно говорит, что не настроена.
 */
@Global()
@Module({
  providers: [
    {
      provide: DAMAGE_VISION_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): DamageVisionProvider => {
        switch (config.env.AI_PROVIDER) {
          case 'openai_compatible':
            return new OpenAiDamageVisionProvider(config);
          case 'mock':
            return new MockDamageVisionProvider();
          default:
            return new DisabledDamageVisionProvider();
        }
      },
    },
  ],
  exports: [DAMAGE_VISION_PROVIDER],
})
export class AiModule {}
