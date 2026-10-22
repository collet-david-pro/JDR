/**
 * Import of a map file into a game (Maps tab, P4c): the file is read and checked in the
 * browser first (preview: name, size, assets; problems explained before any upload), then
 * uploaded with a progress bar; the answer lists the assets the server could not resolve.
 */
import type { MapsClient } from './maps-client';
import { newClientOpId } from '../../editor/sync/OpsQueue';
import type { MapImportResult } from '../types';
import { MapFileError, readMapFile, type MapFilePreview } from '../../formats/map-document-file';

export type ImportStep = 'choose' | 'reading' | 'preview' | 'invalid' | 'uploading' | 'done';

export class MapImportModel {
  step = $state<ImportStep>('choose');
  preview = $state.raw<MapFilePreview | null>(null);
  /** Why the chosen file cannot be imported (step "invalid"). */
  fileError = $state.raw<MapFileError | null>(null);
  /** Upload progress, 0..1 (null when the total is unknown). */
  progress = $state<number | null>(0);
  result = $state.raw<MapImportResult | null>(null);
  /** Server refusal of the upload (the preview stays shown). */
  error = $state.raw<unknown>(null);

  private file: Blob | null = null;
  /** client_op_id of the chosen file: kept after a network loss, renewed after an answer. */
  private clientOpId = '';
  private fileName = '';
  private token = 0;
  private abort: AbortController | null = null;

  constructor(
    private readonly client: Pick<MapsClient, 'importFile'>,
    readonly gameId: string,
    private readonly read: typeof readMapFile = readMapFile,
    private readonly newId: () => string = newClientOpId,
  ) {}

  /** A file was chosen: read and check it. */
  async choose(file: Blob, fileName: string): Promise<void> {
    const token = ++this.token;
    this.abort?.abort();
    this.file = file;
    this.fileName = fileName;
    this.clientOpId = this.newId();
    this.step = 'reading';
    this.preview = null;
    this.fileError = null;
    this.result = null;
    this.error = null;
    try {
      const preview = await this.read(file, fileName);
      if (token !== this.token) return;
      this.preview = preview;
      this.step = 'preview';
    } catch (error) {
      if (token !== this.token) return;
      this.fileError = error instanceof MapFileError ? error : new MapFileError('not_json');
      if (!(error instanceof MapFileError)) console.error(error);
      this.step = 'invalid';
    }
  }

  /** Uploads the previewed file. Resolves with the result (null when cancelled or refused). */
  async upload(): Promise<MapImportResult | null> {
    if (this.step !== 'preview' || this.file === null) return null;
    const token = ++this.token;
    const abort = new AbortController();
    this.abort = abort;
    this.step = 'uploading';
    this.progress = 0;
    this.error = null;
    try {
      const result = await this.client.importFile(this.gameId, this.file, this.fileName, {
        signal: abort.signal,
        clientOpId: this.clientOpId,
        onProgress: (loaded, total) => {
          if (token === this.token) this.progress = total > 0 ? Math.min(1, loaded / total) : null;
        },
      });
      if (token !== this.token) return null;
      this.result = result;
      this.step = 'done';
      return result;
    } catch (error) {
      if (token !== this.token) return null;
      this.step = 'preview';
      // A server answer is final: a new attempt is a new import. Network losses keep the id.
      const status = (error as { status?: unknown } | null)?.status;
      if (typeof status === 'number' && status > 0) this.clientOpId = this.newId();
      if (!abort.signal.aborted) this.error = error;
      return null;
    } finally {
      if (this.abort === abort) this.abort = null;
    }
  }

  /** Stops an upload in progress (back to the preview). */
  cancel(): void {
    if (this.step !== 'uploading') return;
    this.abort?.abort();
  }

  /** Back to the start (dialog closed). */
  reset(): void {
    this.token++;
    this.abort?.abort();
    this.abort = null;
    this.file = null;
    this.fileName = '';
    this.step = 'choose';
    this.preview = null;
    this.fileError = null;
    this.progress = 0;
    this.result = null;
    this.error = null;
  }
}
