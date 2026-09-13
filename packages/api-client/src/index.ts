import type { ApiErrorBody, ErrorCode } from '@pdr/shared';

export interface TokenStore {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  setTokens(tokens: { accessToken: string; refreshToken: string }): void;
  clear(): void;
}

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null | (string | number)[]>;
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Не пытаться обновить сессию при 401 (для самих auth-запросов). */
  skipRefresh?: boolean;
  /** Полный контроль над заголовками. */
  headers?: Record<string, string>;
}

export interface ApiClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  /** Вызывается, когда сессию восстановить не удалось. */
  onAuthFailure?: () => void | Promise<void>;
  /** Повторный вход (Mini App умеет получить свежий initData). */
  reauthenticate?: () => Promise<{ accessToken: string; refreshToken: string } | null>;
}

function buildQuery(query: RequestOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, String(v));
    } else {
      params.set(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export class ApiClient {
  private refreshing: Promise<boolean> | null = null;

  constructor(private readonly options: ApiClientOptions) {}

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.rawRequest(path, options);

    if (response.status === 401 && !options.skipRefresh) {
      const refreshed = await this.refreshSession();
      if (refreshed) {
        const retry = await this.rawRequest(path, options);
        return this.parse<T>(retry);
      }
      await this.options.onAuthFailure?.();
    }

    return this.parse<T>(response);
  }

  private async rawRequest(path: string, options: RequestOptions): Promise<Response> {
    const url = `${this.options.baseUrl}${path}${buildQuery(options.query)}`;
    const headers: Record<string, string> = { ...options.headers };
    const token = this.options.tokens.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    return fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  }

  private async parse<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    const data: unknown = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const body = data as ApiErrorBody | null;
      throw new ApiError(
        body?.error?.code ?? 'internal_error',
        body?.error?.message ?? `Ошибка ${response.status}`,
        response.status,
        body?.error?.details,
        body?.error?.requestId ?? response.headers.get('X-Request-Id') ?? undefined,
      );
    }
    return data as T;
  }

  /** Один параллельный refresh на все запросы. */
  private async refreshSession(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const refreshToken = this.options.tokens.getRefreshToken();
    if (refreshToken) {
      const res = await this.rawRequest('/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
        skipRefresh: true,
      });
      if (res.ok) {
        const tokens = (await res.json()) as { accessToken: string; refreshToken: string };
        this.options.tokens.setTokens(tokens);
        return true;
      }
      this.options.tokens.clear();
    }
    // Mini App может войти заново по свежему initData без участия пользователя.
    const reauth = await this.options.reauthenticate?.();
    if (reauth) {
      this.options.tokens.setTokens(reauth);
      return true;
    }
    return false;
  }

  get<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  /**
   * Бинарный ответ (печатная форма сметы): файл отдаётся только по токену,
   * поэтому обычная ссылка не подходит — нужен запрос с заголовком.
   */
  async getBlob(
    path: string,
    options: Omit<RequestOptions, 'method' | 'body'> = {},
  ): Promise<Blob> {
    let response = await this.rawRequest(path, { ...options, method: 'GET' });
    if (response.status === 401 && !options.skipRefresh && (await this.refreshSession())) {
      response = await this.rawRequest(path, { ...options, method: 'GET' });
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let body: ApiErrorBody | null = null;
      try {
        body = text ? (JSON.parse(text) as ApiErrorBody) : null;
      } catch {
        body = null;
      }
      throw new ApiError(
        body?.error?.code ?? 'internal_error',
        body?.error?.message ?? `Ошибка ${response.status}`,
        response.status,
        body?.error?.details,
      );
    }
    return response.blob();
  }
  post<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }
  patch<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }
  put<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }
  delete<T>(path: string, options?: Omit<RequestOptions, 'method'>): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}

/** Хранилище токенов в localStorage с защитой от недоступного хранилища. */
export function createLocalTokenStore(prefix: string): TokenStore {
  const accessKey = `${prefix}:access`;
  const refreshKey = `${prefix}:refresh`;
  const memory: Record<string, string | null> = { [accessKey]: null, [refreshKey]: null };

  const read = (key: string): string | null => {
    try {
      return localStorage.getItem(key) ?? memory[key] ?? null;
    } catch {
      return memory[key] ?? null;
    }
  };
  const write = (key: string, value: string | null): void => {
    memory[key] = value;
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* приватный режим — остаёмся на памяти процесса */
    }
  };

  return {
    getAccessToken: () => read(accessKey),
    getRefreshToken: () => read(refreshKey),
    setTokens: ({ accessToken, refreshToken }) => {
      write(accessKey, accessToken);
      write(refreshKey, refreshToken);
    },
    clear: () => {
      write(accessKey, null);
      write(refreshKey, null);
    },
  };
}
