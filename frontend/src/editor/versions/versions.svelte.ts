/**
 * History panel of the editor (projet.md 2.5, 11.4 "Versions", 18.1 p.5): the snapshots of the
 * map, manual named snapshots and restoration. Plain values only ($state.raw arrays replaced as
 * a whole); the component shows the errors thrown by the actions.
 *
 * Restoration order (no lost work, no op applied on top of the restored state):
 * 1. the pending ops are sent and confirmed (`settle`); if some cannot be (offline, refused),
 *    the restoration is refused with `PendingOpsError`;
 * 2. POST …/versions/{vid}/restore (the server snapshots the current state as `pre_restore`
 *    first, then writes the snapshot as a new revision; `client_op_id` makes a retry harmless);
 * 3. `onRestored`: the page reloads the map (new document, empty undo/redo stack).
 */
import type { MapsClient } from '../../lib/maps/maps-client';
import type { MapRestoreResult, MapVersion } from '../../lib/types';
import { newClientOpId } from '../sync/OpsQueue';

export const VERSION_LABEL_MAX = 120;

export type VersionsStatus = 'idle' | 'loading' | 'ready' | 'error';
export type VersionsBusy = 'snapshot' | 'restore' | null;

/** Some modifications could not be confirmed by the server (offline, refused). */
export class PendingOpsError extends Error {
  override readonly name = 'PendingOpsError';
  readonly code = 'pending_ops';
  constructor() {
    super('Unconfirmed modifications');
  }
}

export interface VersionsModelOptions {
  readonly mapId: string;
  readonly client: Pick<MapsClient, 'versions' | 'createVersion' | 'restoreVersion'>;
  /** Sends the pending ops; resolves true when nothing is left unconfirmed. */
  readonly settle: () => Promise<boolean>;
  /** Blocks (false) or allows (true) edits while a restoration runs. */
  readonly setEditable?: (editable: boolean) => void;
  /** The snapshot is restored: reload the map in the editor. */
  readonly onRestored: (result: MapRestoreResult, version: MapVersion) => void;
  readonly newId?: () => string;
}

/** Label typed by the user: trimmed, null when empty, at most VERSION_LABEL_MAX characters. */
export function normalizeVersionLabel(label: string | null | undefined): string | null {
  const text = (label ?? '').trim();
  if (text === '') return null;
  return [...text].slice(0, VERSION_LABEL_MAX).join('');
}

export class VersionsModel {
  status = $state<VersionsStatus>('idle');
  error = $state.raw<unknown>(null);
  versions = $state.raw<readonly MapVersion[]>([]);
  busy = $state<VersionsBusy>(null);

  private token = 0;
  /** client_op_id of a restoration not yet answered, per version (identical retry). */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal, not shown
  private readonly restoreIds = new Map<string, string>();
  private readonly newId: () => string;

  constructor(private readonly options: VersionsModelOptions) {
    this.newId = options.newId ?? newClientOpId;
  }

  async load(): Promise<void> {
    const token = ++this.token;
    this.status = 'loading';
    this.error = null;
    try {
      const versions = await this.options.client.versions(this.options.mapId);
      if (token !== this.token) return;
      this.versions = versions;
      this.status = 'ready';
    } catch (error) {
      if (token !== this.token) return;
      this.error = error;
      this.status = 'error';
    }
  }

  /** Manual snapshot of the saved state (pending ops are sent first). */
  async snapshot(label: string | null): Promise<MapVersion> {
    if (this.busy !== null) throw new Error('Busy');
    this.busy = 'snapshot';
    try {
      if (!(await this.options.settle())) throw new PendingOpsError();
      const version = await this.options.client.createVersion(
        this.options.mapId,
        normalizeVersionLabel(label),
      );
      this.token++; // a list loading meanwhile would miss the new version
      this.versions = [version, ...this.versions.filter((v) => v.id !== version.id)];
      this.status = 'ready';
      return version;
    } finally {
      this.busy = null;
    }
  }

  /** Restores a snapshot (see the module comment for the order of the steps). */
  async restore(version: MapVersion): Promise<MapRestoreResult> {
    if (this.busy !== null) throw new Error('Busy');
    this.busy = 'restore';
    this.options.setEditable?.(false);
    let restored = false;
    try {
      if (!(await this.options.settle())) throw new PendingOpsError();
      let id = this.restoreIds.get(version.id);
      if (id === undefined) {
        id = this.newId();
        this.restoreIds.set(version.id, id);
      }
      let result: MapRestoreResult;
      try {
        result = await this.options.client.restoreVersion(this.options.mapId, version.id, id);
      } catch (error) {
        // A server answer is final: a new attempt gets a new id. Network failures keep it.
        const status = (error as { status?: unknown } | null)?.status;
        if (typeof status === 'number' && status > 0) this.restoreIds.delete(version.id);
        throw error;
      }
      this.restoreIds.delete(version.id);
      restored = true;
      this.options.onRestored(result, version);
      return result;
    } finally {
      this.busy = null;
      if (!restored) this.options.setEditable?.(true);
    }
  }
}
