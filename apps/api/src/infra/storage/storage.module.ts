import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '@/config/config.service';
import { LocalStorageProvider } from './local-storage.provider';
import { S3StorageProvider } from './s3-storage.provider';
import type { StorageProvider } from './storage.types';

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

@Global()
@Module({
  providers: [
    LocalStorageProvider,
    {
      provide: STORAGE_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): StorageProvider =>
        config.env.STORAGE_DRIVER === 's3'
          ? new S3StorageProvider(config)
          : new LocalStorageProvider(config),
    },
  ],
  exports: [STORAGE_PROVIDER, LocalStorageProvider],
})
export class StorageModule {}
