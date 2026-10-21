/**
 * Multipart upload through XMLHttpRequest: fetch() still offers no upload progress in
 * every target browser. Same envelope and errors as ApiClient (parseEnvelope).
 */

import { ApiError, parseEnvelope, type ApiResponse } from '../api';

/** The subset of XMLHttpRequest used here (injectable for tests). */
export interface XhrLike {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: FormData): void;
  abort(): void;
  getResponseHeader(name: string): string | null;
  readonly status: number;
  readonly responseText: string;
  withCredentials: boolean;
  timeout: number;
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  ontimeout: (() => void) | null;
}

export type XhrFactory = () => XhrLike;

export const browserXhr: XhrFactory = () => new XMLHttpRequest() as unknown as XhrLike;

export interface XhrUploadRequest {
  readonly url: string;
  readonly body: FormData;
  readonly csrf: string | null;
  /** Bytes sent / total (total may be 0 when unknown). */
  readonly onProgress?: (loaded: number, total: number) => void;
  readonly signal?: AbortSignal;
  /** 0 = no timeout (default: large files on slow links). */
  readonly timeoutMs?: number;
  readonly xhr?: XhrFactory;
}

export function xhrUpload<T>(request: XhrUploadRequest): Promise<ApiResponse<T>> {
  return new Promise((resolve, reject) => {
    const signal = request.signal;
    if (signal?.aborted === true) {
      reject(new ApiError({ code: 'aborted', message: 'Request aborted', status: 0 }));
      return;
    }
    const xhr = (request.xhr ?? browserXhr)();
    const onAbortSignal = (): void => xhr.abort();
    const cleanup = (): void => signal?.removeEventListener('abort', onAbortSignal);

    xhr.open('POST', request.url);
    xhr.withCredentials = true;
    xhr.timeout = request.timeoutMs ?? 0;
    xhr.setRequestHeader('Accept', 'application/json');
    if (request.csrf !== null) xhr.setRequestHeader('X-CSRF-Token', request.csrf);

    xhr.upload.onprogress = (event) => {
      request.onProgress?.(event.loaded, event.lengthComputable ? event.total : 0);
    };
    xhr.onload = () => {
      cleanup();
      try {
        resolve(
          parseEnvelope<T>(
            xhr.status,
            xhr.responseText,
            xhr.getResponseHeader('X-Request-Id'),
            xhr.getResponseHeader('Retry-After'),
          ),
        );
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(new ApiError({ code: 'network_error', message: 'Network error', status: 0 }));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(new ApiError({ code: 'timeout', message: 'Upload timed out', status: 0 }));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new ApiError({ code: 'aborted', message: 'Request aborted', status: 0 }));
    };
    signal?.addEventListener('abort', onAbortSignal, { once: true });
    xhr.send(request.body);
  });
}
