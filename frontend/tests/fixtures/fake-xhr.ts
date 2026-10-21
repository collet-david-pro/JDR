import type { XhrFactory, XhrLike } from '../../src/lib/assets/xhr-upload';

export interface FakeResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

/** Scriptable XMLHttpRequest: each request takes the next queued response. */
export class FakeXhr implements XhrLike {
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: FormData | null = null;
  status = 0;
  responseText = '';
  withCredentials = false;
  timeout = 0;
  aborted = false;
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  private responseHeaders: Record<string, string> = {};

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  send(body: FormData): void {
    this.body = body;
    this.onSend?.(this);
  }
  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }
  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name] ?? null;
  }
  progress(loaded: number, total: number): void {
    this.upload.onprogress?.({ loaded, total, lengthComputable: true } as ProgressEvent);
  }
  respond(response: FakeResponse): void {
    this.status = response.status;
    this.responseText =
      typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
    this.responseHeaders = { 'X-Request-Id': 'rq-x', ...(response.headers ?? {}) };
    this.onload?.();
  }
  fail(): void {
    this.onerror?.();
  }

  onSend: ((xhr: FakeXhr) => void) | undefined;
}

/** Factory recording the created requests; `script` answers each one synchronously. */
export function fakeXhrFactory(script: (xhr: FakeXhr, index: number) => void): {
  factory: XhrFactory;
  requests: FakeXhr[];
} {
  const requests: FakeXhr[] = [];
  const factory: XhrFactory = () => {
    const xhr = new FakeXhr();
    const index = requests.length;
    requests.push(xhr);
    xhr.onSend = (x) => script(x, index);
    return xhr;
  };
  return { factory, requests };
}
