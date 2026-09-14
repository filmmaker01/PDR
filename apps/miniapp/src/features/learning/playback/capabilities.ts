export interface PlaybackCapabilities {
  widevine: boolean;
  fairplay: boolean;
  playready: boolean;
}

export const NO_CAPABILITIES: PlaybackCapabilities = {
  widevine: false,
  fairplay: false,
  playready: false,
};

const VIDEO_CONTENT_TYPE = 'video/mp4;codecs="avc1.42E01E"';

/**
 * Умеет ли этот клиент защищённое воспроизведение.
 *
 * Telegram открывает Mini App в системном WebView, и там всё иначе, чем в
 * браузере: на Android разрешение на защищённое медиа выдаёт приложение, на
 * Apple-платформах Widevine нет вовсе, а поддержка FairPlay в WKWebView не
 * гарантирована. Поэтому режим не угадывается по платформе, а проверяется
 * запросом к самому браузеру, и решение принимает сервер.
 */
async function supports(keySystem: string, initDataTypes: string[]): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.requestMediaKeySystemAccess) return false;
  try {
    await navigator.requestMediaKeySystemAccess(keySystem, [
      {
        initDataTypes,
        videoCapabilities: [{ contentType: VIDEO_CONTENT_TYPE }],
      },
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function detectCapabilities(): Promise<PlaybackCapabilities> {
  const [widevine, fairplay, fairplayLegacy, playready] = await Promise.all([
    supports('com.widevine.alpha', ['cenc']),
    supports('com.apple.fps', ['sinf']),
    supports('com.apple.fps.1_0', ['sinf']),
    supports('com.microsoft.playready', ['cenc']),
  ]);

  return { widevine, fairplay: fairplay || fairplayLegacy, playready };
}

export function describeCapabilities(caps: PlaybackCapabilities): string {
  const list = Object.entries(caps)
    .filter(([, on]) => on)
    .map(([name]) => name);
  return list.length > 0 ? list.join(', ') : 'нет';
}
