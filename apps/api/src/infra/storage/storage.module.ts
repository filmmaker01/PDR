import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '@/config/config.service';
import { BlobStorageProvider } from './blob-storage.provider';
import { LocalStorageProvider } from './local-storage.provider';
import { S3StorageProvider } from './s3-storage.provider';
import type { StorageProvider } from './storage.types';

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

function createProvider(config: AppConfigService): StorageProvider {
  switch (config.env.STORAGE_DRIVER) {
    case 's3':
      return new S3StorageProvider(config);
    case 'blob':
      return new BlobStorageProvider(config);
    default:
      return new LocalStorageProvider(config);
  }
}

@Global()
@Module({
  providers: [
    LocalStorageProvider,
    {
      provide: STORAGE_PROVIDER,
      inject: [AppConfigService],
      useFactory: createProvider,
    },
  ],
  exports: [STORAGE_PROVIDER, LocalStorageProvider],
})
export class StorageModule {}
