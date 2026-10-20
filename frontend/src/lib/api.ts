/**
 * Typed REST client (projet.md sections 9.1 and 13.1).
 *
 * - Envelope: `{ok:true, data, meta}` / `{ok:false, error:{code, message, fields}}`.
 * - URL building works in both routing modes: in `query` mode the base already contains
 *   `?r=` (".../index.php?r=/api/v1"), so call query parameters are appended with "&".
 * - `X-CSRF-Token` is sent for every non-GET method once a token is known.
 * - Timeout per attempt (15 s by default) through AbortController.
 * - Idempotent GET/HEAD requests are retried on network errors, timeouts, 502 and 504
 *   (2 retries by default, exponential backoff).
 * - 401 and 503 responses are reported through callbacks (login redirect, maintenance screen)
 *   and then thrown as ApiError like any other error.
 * - 403 `csrf_invalid` (session renewed on the server): the token is refreshed through
 *   `refreshCsrf` (GET /auth/me) and the request is sent again, once.
 */

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue =
  string | number | boolean | null | undefined | readonly (string | number)[];
export type QueryParams = Readonly<Record<string, QueryValue>>;

export type ApiMeta = Readonly<Record<string, unknown>>;

export interface ApiResponse<T> {
  readonly data: T;
  readonly meta: ApiMeta;
  readonly status: number;
  readonly requestId: string | null;
}

/** Client-side error codes, in addition to the server codes of section 9.1. */
export type ClientErrorCode =
  'network_error' | 'timeout' | 'aborted' | 'invalid_response' | 'http_error';

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly fields: Readonly<Record<string, string>>;
  /** Seconds from a Retry-After header (429, 503), when present. */
  readonly retryAfter: number | null;

  constructor(init: {
    code: string;
    message: string;
    status: number;
    requestId?: string | null;
    fields?: Readonly<Record<string, string>>;
    retryAfter?: number | null;
    cause?: unknown;
  }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId ?? null;
    this.fields = init.fields ?? {};
    this.retryAfter = init.retryAfter ?? null;
  }
}

export interface RequestOptions {
  readonly query?: QueryParams;
  /** JSON-serialisable value, or FormData/Blob/ArrayBuffer/URLSearchParams sent as is. */
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Overrides the number of retries for idempotent requests (0 disables). */
  readonly retries?: number;
  /** When false, a 401 does not trigger onUnauthorized (e.g. the login form itself). */
  readonly notifyUnauthorized?: boolean;
}

export interface ApiClientOptions {
  /** API prefix from the boot configuration (BootConfig.apiBase). */
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  readonly csrfToken?: string | null;
  readonly timeoutMs?: number;
  readonly retries?: number;
  readonly retryDelayMs?: number;
  readonly onUnauthorized?: (error: ApiError) => void;
  readonly onMaintenance?: (error: ApiError) => void;
  /** Fetches a fresh CSRF token (and calls setCsrfToken) after a 403 csrf_invalid. */
  readonly refreshCsrf?: () => Promise<void>;
  /** Injectable for tests. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_RETRIES = 2;
export const DEFAULT_RETRY_DELAY_MS = 400;

const RETRYABLE_STATUS = new Set([502, 504]);

/** Builds a request URL from the API base, a path ("/games/12") and query parameters. */
export function buildApiUrl(baseUrl: string, path: string, query?: QueryParams): string {
  if (!path.startsWith('/')) {
    throw new Error(`API path must start with "/": ${path}`);
  }
  if (path.includes('?') || path.includes('#')) {
    throw new Error(`API path must not contain "?" or "#" (use the query option): ${path}`);
  }
  let url = baseUrl.replace(/\/+$/, '') + path;
  const search = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        search.append(key, value.join(','));
      } else {
        search.append(key, String(value));
      }
    }
  }
  const qs = search.toString();
  if (qs !== '') {
    url += (url.includes('?') ? '&' : '?') + qs;
  }
  return url;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly onUnauthorized: ((error: ApiError) => void) | undefined;
  private readonly onMaintenance: ((error: ApiError) => void) | undefined;
  private readonly refreshCsrf: (() => Promise<void>) | undefined;
  private readonly sleep: (ms: number) => Promise<void>;
  private csrf: string | null;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl;
    // Bind to globalThis: calling an unbound window.fetch throws "Illegal invocation".
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.onUnauthorized = options.onUnauthorized;
    this.onMaintenance = options.onMaintenance;
    this.refreshCsrf = options.refreshCsrf;
    this.sleep = options.sleep ?? defaultSleep;
    this.csrf = options.csrfToken ?? null;
  }

  get csrfToken(): string | null {
    return this.csrf;
  }

  setCsrfToken(token: string | null): void {
    this.csrf = token;
  }

  url(path: string, query?: QueryParams): string {
    return buildApiUrl(this.baseUrl, path, query);
  }

  get<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, { ...options, body });
  }

  put<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, { ...options, body });
  }

  patch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.request<T>('PATCH', path, { ...options, body });
  }

  delete<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path, options);
  }

  async request<T>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const url = this.url(path, options.query);
    const idempotent = method === 'GET' || method === 'HEAD';
    const maxRetries = idempotent ? (options.retries ?? this.retries) : 0;
    let csrfRetried = false;

    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.send(method, url, options);
        if (idempotent && RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
          await response.body?.cancel().catch(() => undefined);
          await this.sleep(this.retryDelayMs * 2 ** attempt);
          continue;
        }
        return await this.handleResponse<T>(response, options);
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.code === 'csrf_invalid' &&
          !idempotent &&
          !csrfRetried &&
          this.refreshCsrf !== undefined
        ) {
          csrfRetried = true;
          await this.refreshCsrf();
          continue;
        }
        if (
          error instanceof ApiError &&
          (error.code === 'network_error' || error.code === 'timeout') &&
          attempt < maxRetries
        ) {
          await this.sleep(this.retryDelayMs * 2 ** attempt);
          continue;
        }
        throw error;
      }
    }
  }

  private async send(method: HttpMethod, url: string, options: RequestOptions): Promise<Response> {
    const headers = new Headers({ Accept: 'application/json' });
    if (options.headers) {
      for (const [name, value] of Object.entries(options.headers)) headers.set(name, value);
    }
    if (method !== 'GET' && method !== 'HEAD' && this.csrf !== null) {
      headers.set('X-CSRF-Token', this.csrf);
    }

    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      if (
        options.body instanceof FormData ||
        options.body instanceof Blob ||
        options.body instanceof ArrayBuffer ||
        options.body instanceof URLSearchParams ||
        ArrayBuffer.isView(options.body)
      ) {
        body = options.body as BodyInit;
      } else {
        body = JSON.stringify(options.body);
        headers.set('Content-Type', 'application/json');
      }
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const external = options.signal;
    const onExternalAbort = (): void => controller.abort();
    if (external) {
      if (external.aborted) controller.abort();
      else external.addEventListener('abort', onExternalAbort, { once: true });
    }

    const init: RequestInit = {
      method,
      headers,
      credentials: 'same-origin',
      signal: controller.signal,
    };
    if (body !== undefined) init.body = body;

    try {
      return await this.fetchImpl(url, init);
    } catch (error) {
      if (timedOut) {
        throw new ApiError({
          code: 'timeout',
          message: `Request timed out after ${timeoutMs} ms`,
          status: 0,
          cause: error,
        });
      }
      if (external?.aborted === true) {
        throw new ApiError({
          code: 'aborted',
          message: 'Request aborted',
          status: 0,
          cause: error,
        });
      }
      throw new ApiError({
        code: 'network_error',
        message: 'Network error',
        status: 0,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
    }
  }

  private async handleResponse<T>(
    response: Response,
    options: RequestOptions,
  ): Promise<ApiResponse<T>> {
    const requestId = response.headers.get('X-Request-Id');
    const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));

    let payload: unknown = undefined;
    if (response.status !== 204 && response.status !== 205) {
      const text = await response.text();
      if (text !== '') {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = undefined;
        }
      }
    }

    if (response.ok) {
      if (response.status === 204 || response.status === 205) {
        return { data: null as T, meta: {}, status: response.status, requestId };
      }
      if (isSuccessEnvelope(payload)) {
        return {
          data: payload.data as T,
          meta: isRecord(payload.meta) ? payload.meta : {},
          status: response.status,
          requestId,
        };
      }
      throw new ApiError({
        code: 'invalid_response',
        message: 'Invalid API response envelope',
        status: response.status,
        requestId,
      });
    }

    const error = toApiError(payload, response.status, requestId, retryAfter);
    if (response.status === 401 && options.notifyUnauthorized !== false) {
      this.onUnauthorized?.(error);
    } else if (response.status === 503) {
      this.onMaintenance?.(error);
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSuccessEnvelope(value: unknown): value is { ok: true; data: unknown; meta?: unknown } {
  return isRecord(value) && value['ok'] === true && 'data' in value;
}

function toApiError(
  payload: unknown,
  status: number,
  requestId: string | null,
  retryAfter: number | null,
): ApiError {
  if (isRecord(payload) && payload['ok'] === false && isRecord(payload['error'])) {
    const err = payload['error'];
    const code = typeof err['code'] === 'string' && err['code'] !== '' ? err['code'] : 'http_error';
    const message = typeof err['message'] === 'string' ? err['message'] : `HTTP ${status}`;
    return new ApiError({
      code,
      message,
      status,
      requestId,
      fields: normalizeFields(err['fields']),
      retryAfter,
    });
  }
  return new ApiError({
    code: status === 503 ? 'maintenance' : 'http_error',
    message: `HTTP ${status}`,
    status,
    requestId,
    retryAfter,
  });
}

function normalizeFields(value: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!isRecord(value)) return fields;
  for (const [key, message] of Object.entries(value)) {
    if (typeof message === 'string') fields[key] = message;
    else if (Array.isArray(message))
      fields[key] = message.filter((m) => typeof m === 'string').join(' ');
  }
  return fields;
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}
