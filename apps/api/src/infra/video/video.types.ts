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

/**
 * Что клиент умеет воспроизводить.
 *
 * Telegram открывает Mini App в системном WebView, и защищённое
 * воспроизведение там доступно далеко не везде. Клиент проверяет это сам и
 * сообщает результат, а решение о режиме принимает сервер.
 */
export interface PlaybackCapabilities {
  widevine: boolean;
  fairplay: boolean;
  playready: boolean;
}

export interface PlaybackRequest {
  /** Подписанный токен нашей сессии просмотра. */
  authToken: string;
  /** Метка поверх видео. Короткий внутренний идентификатор, без ФИО и телефона. */
  watermark: string;
  /** Выдавать ли DRM-режим. Решает сервер по флагу и возможностям клиента. */
  drm: boolean;
  ttlSec: number;
}

/**
 * Билет на воспроизведение.
 *
 * Здесь намеренно нет ни hls, ни mp4, ни любой другой ссылки на поток:
 * клиент получает адрес страницы плеера и токен, который плеер предъявит
 * нам при запросе лицензии. Без нашего разрешения не покажется ничего.
 */
export interface PlaybackTicket {
  /** Имя провайдера: клиент выбирает по нему реализацию плеера. */
  provider: string;
  /** Страница плеера провайдера. Не поток. */
  embedUrl: string;
  /** Токен авторизации просмотра: уходит провайдеру и возвращается к нам. */
  authToken: string;
  /** Метка поверх видео или null, если водяной знак выключен. */
  watermark: string | null;
  /** Выдан ли DRM-режим. */
  drm: boolean;
  expiresAt: Date;
}

/**
 * Видеоплатформа за адаптером: продукт не зависит от конкретного провайдера,
 * а разработка и тесты не требуют доступа к его аккаунту.
 */
export interface VideoProvider {
  readonly name: string;
  createUpload(input: { title: string }): Promise<VideoUploadTarget>;
  /** Загрузка файла через наш сервер: токен провайдера не покидает бэкенд. */
  upload(input: {
    providerVideoId: string;
    body: NodeJS.ReadableStream;
    contentType: string;
    sizeBytes: number;
    fileName: string;
  }): Promise<void>;
  getStatus(providerVideoId: string): Promise<VideoStatusResult>;
  issuePlayback(providerVideoId: string, request: PlaybackRequest): Promise<PlaybackTicket>;
  delete(providerVideoId: string): Promise<void>;
}
