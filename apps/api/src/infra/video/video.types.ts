export interface VideoUploadTarget {
  providerVideoId: string;
  /** Прямая загрузка браузером; если провайдер требует иной путь — instructions. */
  uploadUrl?: string;
  instructions?: string;
  expiresAt?: Date;
}

export interface VideoStatusResult {
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  durationSec?: number | null;
  error?: string | null;
}

export interface PlaybackTicket {
  /** Встраиваемый плеер провайдера. */
  embedUrl?: string;
  /** Прямой HLS для собственного плеера. */
  hlsUrl?: string;
  posterUrl?: string;
  expiresAt: Date;
}

/**
 * Видеоплатформа за адаптером: продукт не зависит от конкретного провайдера,
 * а разработка и тесты не требуют доступа к его аккаунту.
 */
export interface VideoProvider {
  readonly name: string;
  createUpload(input: { title: string }): Promise<VideoUploadTarget>;
  getStatus(providerVideoId: string): Promise<VideoStatusResult>;
  issuePlayback(
    providerVideoId: string,
    options: { userId: string; ttlSec: number },
  ): Promise<PlaybackTicket>;
  delete(providerVideoId: string): Promise<void>;
}
