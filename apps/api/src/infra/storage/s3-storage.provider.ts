import { Injectable } from '@nestjs/common';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfigService } from '@/config/config.service';
import type {
  CompletedPart,
  MultipartUpload,
  ObjectHead,
  PresignedUpload,
  StorageProvider,
} from './storage.types';

const PART_SIZE_BYTES = 10 * 1024 * 1024;

/** Приватный S3-совместимый bucket. Публичного доступа к объектам нет. */
@Injectable()
export class S3StorageProvider implements StorageProvider {
  readonly kind = 's3' as const;
  readonly bucket: string;
  private readonly client: S3Client;

  constructor(config: AppConfigService) {
    this.bucket = config.env.S3_BUCKET;
    this.client = new S3Client({
      region: config.env.S3_REGION,
      endpoint: config.env.S3_ENDPOINT || undefined,
      forcePathStyle: config.env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.env.S3_ACCESS_KEY,
        secretAccessKey: config.env.S3_SECRET_KEY,
      },
    });
  }

  async presignUpload(
    key: string,
    contentType: string,
    sizeBytes: number,
    ttlSec: number,
  ): Promise<PresignedUpload> {
    // Тип и длина зафиксированы в подписи: подменить их при загрузке нельзя.
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: ttlSec });
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': contentType, 'Content-Length': String(sizeBytes) },
      expiresAt: new Date(Date.now() + ttlSec * 1000),
    };
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
    sizeBytes: number,
    ttlSec: number,
  ): Promise<MultipartUpload> {
    const created = await this.client.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
    );
    const uploadId = created.UploadId;
    if (!uploadId) throw new Error('S3 не вернул UploadId');

    const count = Math.max(1, Math.ceil(sizeBytes / PART_SIZE_BYTES));
    const parts = await Promise.all(
      Array.from({ length: count }, async (_, i) => ({
        partNumber: i + 1,
        url: await getSignedUrl(
          this.client,
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: i + 1,
          }),
          { expiresIn: ttlSec },
        ),
      })),
    );

    return {
      uploadId,
      partSizeBytes: PART_SIZE_BYTES,
      parts,
      expiresAt: new Date(Date.now() + ttlSec * 1000),
    };
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.client
      .send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }))
      .catch(() => undefined);
  }

  async presignDownload(key: string, ttlSec: number, downloadName?: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(downloadName
        ? {
            ResponseContentDisposition: `attachment; filename="${encodeURIComponent(downloadName)}"`,
          }
        : {}),
    });
    return getSignedUrl(this.client, command, { expiresIn: ttlSec });
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        sizeBytes: Number(result.ContentLength ?? 0),
        contentType: result.ContentType ?? null,
        etag: result.ETag ?? null,
      };
    } catch {
      return null;
    }
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = result.Body as { transformToByteArray(): Promise<Uint8Array> };
    return Buffer.from(await body.transformToByteArray());
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
