import type { PlaybackSession } from '../types';

export interface PlayerCallbacks {
  onTime(currentTime: number, percent: number): void;
  onEnded(): void;
  onError(reason: string): void;
}

export interface PlayerHandle {
  destroy(): void;
}

export interface CreatePlayerInput {
  container: HTMLElement;
  session: PlaybackSession;
  startAtSec: number;
  durationSec: number | null;
  callbacks: PlayerCallbacks;
}

/**
 * Единая точка входа для плеера.
 *
 * Выше по коду не важно, кто проигрывает видео: прогресс, порог просмотра и
 * обработка ошибок написаны один раз. Различаются только реализации —
 * настоящий плеер провайдера и заглушка для разработки и тестов.
 */
export async function createPlayer(input: CreatePlayerInput): Promise<PlayerHandle> {
  return input.session.provider === 'kinescope'
    ? createKinescopePlayer(input)
    : createMockPlayer(input);
}

/* ── Kinescope ─────────────────────────────────────────────────────────────── */

/**
 * Плеер Kinescope через официальный IFrame Player API.
 *
 * Токен сессии уходит в drm.auth: провайдер предъявит его нашему серверу,
 * когда попросит лицензию. Водяной знак рисует сам плеер в случайных местах —
 * так метку нельзя ни закрыть, ни обрезать одним кадрированием.
 */
async function createKinescopePlayer(input: CreatePlayerInput): Promise<PlayerHandle> {
  const { load } = await import('@kinescope/player-iframe-api-loader');
  const api = await load();

  const player = await api.create(input.container, {
    url: input.session.embedUrl,
    size: { width: '100%', height: '100%' },
    behavior: { playsInline: true, localStorage: false },
    ui: input.session.watermark
      ? {
          watermark: {
            text: input.session.watermark,
            mode: 'random',
            displayTimeout: { visible: 6000, hidden: 4000 },
          },
        }
      : undefined,
    playlist: [{ drm: { auth: { token: input.session.authToken } } }],
  });

  player.on(player.Events.TimeUpdate, ({ data }) => {
    input.callbacks.onTime(data.currentTime, Math.round(data.percent));
  });
  player.on(player.Events.Ended, () => input.callbacks.onEnded());
  player.on(player.Events.Error, ({ data }) => {
    input.callbacks.onError(describeError(data.error));
  });

  if (input.startAtSec > 0) {
    await player.seekTo(input.startAtSec).catch(() => undefined);
  }

  return {
    destroy: () => {
      void player.destroy().catch(() => undefined);
    },
  };
}

function describeError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : null;
    const message = typeof record.message === 'string' ? record.message : null;
    if (name || message) return [name, message].filter(Boolean).join(': ');
  }
  return 'player_error';
}

/* ── Заглушка ──────────────────────────────────────────────────────────────── */

interface MockMessage {
  source?: string;
  type?: string;
  data?: { currentTime?: number; percent?: number; reason?: string };
}

/**
 * Плеер-заглушка: тот же контракт событий, что у настоящего.
 * Нужен, чтобы вся цепочка — сессия, отзыв, прогресс, метка — проверялась
 * без доступа к аккаунту провайдера.
 */
function createMockPlayer(input: CreatePlayerInput): PlayerHandle {
  const params = new URLSearchParams();
  params.set('drmauthtoken', input.session.authToken);
  if (input.session.watermark) params.set('watermark', input.session.watermark);
  if (input.durationSec) params.set('duration', String(input.durationSec));
  if (input.startAtSec > 0) params.set('t', String(Math.floor(input.startAtSec)));

  const frame = document.createElement('iframe');
  frame.src = `${input.session.embedUrl}?${params.toString()}`;
  frame.title = 'Видеоурок';
  frame.allow = 'autoplay; fullscreen; encrypted-media';
  frame.style.width = '100%';
  frame.style.height = '100%';
  frame.style.border = '0';
  input.container.replaceChildren(frame);

  const onMessage = (event: MessageEvent<MockMessage>) => {
    const payload = event.data;
    if (!payload || payload.source !== 'pdr-mock-player') return;
    if (payload.type === 'timeupdate') {
      input.callbacks.onTime(payload.data?.currentTime ?? 0, payload.data?.percent ?? 0);
    } else if (payload.type === 'ended') {
      input.callbacks.onEnded();
    } else if (payload.type === 'error') {
      input.callbacks.onError(payload.data?.reason ?? 'player_error');
    }
  };
  window.addEventListener('message', onMessage);

  return {
    destroy: () => {
      window.removeEventListener('message', onMessage);
      frame.remove();
    },
  };
}
