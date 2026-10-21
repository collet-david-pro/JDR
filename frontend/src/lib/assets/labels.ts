/** Translated labels of asset enumerations (literal keys, checked by tests/i18n-keys). */

import { t } from '../i18n';
import type { AssetKind } from '../types';
import type { UploadStatus } from './upload-queue.svelte';

export function kindLabel(kind: string): string {
  switch (kind as AssetKind) {
    case 'tile':
      return t('library.kinds.tile');
    case 'object':
      return t('library.kinds.object');
    case 'token':
      return t('library.kinds.token');
    case 'texture':
      return t('library.kinds.texture');
    case 'background':
      return t('library.kinds.background');
    default:
      return kind;
  }
}

export function statusLabel(status: UploadStatus): string {
  switch (status) {
    case 'pending':
      return t('library.upload.status.pending');
    case 'preparing':
      return t('library.upload.status.preparing');
    case 'reducing':
      return t('library.upload.status.reducing');
    case 'uploading':
      return t('library.upload.status.uploading');
    case 'waiting':
      return t('library.upload.status.waiting');
    case 'done':
      return t('library.upload.status.done');
    case 'error':
      return t('library.upload.status.error');
    case 'cancelled':
      return t('library.upload.status.cancelled');
  }
}

/** "PNG", "GIF"... from a MIME type. */
export function formatLabel(mime: string): string {
  return (mime.split('/')[1] ?? mime).toUpperCase();
}
