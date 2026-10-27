/**
 * Reactive model of the projection screens of the console (P7e): list, screens of a previous
 * session that can be reused, pairing codes (kept only while the page lives: the server gives
 * them once), presence refreshed every 15 s and by the `display.*` events (raw events of the
 * subscription: they do not go through the session reducer).
 */
import type { DisplaysClient } from '../../displays/displays-client';
import type {
  DisplayInfo,
  DisplayPatch,
  DisplayUpdatedPayload,
  PairingInfo,
} from '../../displays/types';
import type { WireEvent } from '../../realtime/types';

export const REFRESH_MS = 15_000;

export type DisplaysApi = Pick<
  DisplaysClient,
  'create' | 'list' | 'update' | 'remove' | 'regenerateCode'
>;

export interface DisplaysModelOptions {
  readonly sessionId: string;
  readonly api: DisplaysApi;
  readonly onError?: (error: unknown) => void;
  readonly refreshMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class DisplaysModel {
  displays = $state.raw<readonly DisplayInfo[]>([]);
  loaded = $state(false);
  /** Pairing codes received on creation / regeneration, by screen id. */
  pairings = $state.raw<Readonly<Record<string, PairingInfo>>>({});

  readonly activeCount = $derived(this.displays.filter((d) => d.state === 'active').length);

  private timer: ReturnType<typeof setInterval> | null = null;
  private token = 0;
  private stopped = false;
  private controller: AbortController | null = null;

  constructor(private readonly o: DisplaysModelOptions) {}

  /** Loads the list, then refreshes it every 15 s. */
  start(): void {
    this.stopped = false;
    void this.refresh();
    if (this.timer === null) {
      this.timer = setInterval(() => void this.refresh(), this.o.refreshMs ?? REFRESH_MS);
    }
  }

  stop(): void {
    this.stopped = true;
    this.controller?.abort();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh(): Promise<void> {
    const token = ++this.token;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    try {
      const list = await this.o.api.list(this.o.sessionId, controller.signal);
      if (this.stopped || token !== this.token) return;
      this.displays = list.displays;
      this.loaded = true;
      this.dropStalePairings();
    } catch (error) {
      if (this.stopped || token !== this.token) return;
      if (!(isRecord(error) && error['code'] === 'aborted')) this.o.onError?.(error);
    }
  }

  /** A raw event of the session channel; only `display.*` count. */
  onEvent(event: WireEvent): void {
    if (event.type === 'display.revoked') {
      const id = isRecord(event.payload) ? event.payload['display_id'] : undefined;
      if (typeof id === 'string') this.remove(id);
      return;
    }
    if (event.type !== 'display.paired' && event.type !== 'display.updated') return;
    const display = (event.payload as Partial<DisplayUpdatedPayload> | null)?.display;
    if (!isRecord(display) || typeof display['id'] !== 'string') {
      void this.refresh();
      return;
    }
    const patch = display as unknown as Partial<DisplayInfo> & { id: string };
    const known = this.displays.some((d) => d.id === patch.id);
    if (known) {
      this.displays = this.displays.map((d) =>
        d.id === patch.id ? { ...d, ...patch, pairing: null } : d,
      );
    }
    // Presence and anything the event does not carry: read the list again.
    if (!known || event.type === 'display.paired') void this.refresh();
    if (patch.state === 'active') this.forgetPairing(patch.id);
  }

  async add(name: string): Promise<DisplayInfo> {
    const created = await this.o.api.create(this.o.sessionId, name);
    this.upsert(created);
    return created;
  }

  async save(id: string, patch: DisplayPatch): Promise<DisplayInfo> {
    const updated = await this.o.api.update(id, patch);
    this.upsert(updated);
    return updated;
  }

  async revoke(id: string): Promise<void> {
    await this.o.api.remove(id);
    this.remove(id);
  }

  async newCode(id: string): Promise<DisplayInfo> {
    const updated = await this.o.api.regenerateCode(id);
    this.upsert(updated);
    return updated;
  }

  private upsert(info: DisplayInfo): void {
    const { pairing, ...rest } = info;
    const display: DisplayInfo = { ...rest, pairing: null };
    this.displays = this.displays.some((d) => d.id === info.id)
      ? this.displays.map((d) => (d.id === info.id ? display : d))
      : [...this.displays, display];
    if (pairing !== null && info.state === 'pending') {
      this.pairings = { ...this.pairings, [info.id]: pairing };
    } else if (info.state === 'active') {
      this.forgetPairing(info.id);
    }
  }

  private remove(id: string): void {
    this.displays = this.displays.filter((d) => d.id !== id);
    this.forgetPairing(id);
  }

  private forgetPairing(id: string): void {
    if (!(id in this.pairings)) return;
    const { [id]: _gone, ...rest } = this.pairings;
    this.pairings = rest;
  }

  private dropStalePairings(): void {
    const pending = this.displays.filter((d) => d.state === 'pending').map((d) => d.id);
    for (const id of Object.keys(this.pairings)) if (!pending.includes(id)) this.forgetPairing(id);
  }
}
