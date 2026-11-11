import { TOURS, isTourId, presentSteps, type TourId, type TourStep } from '../lib/tour/tours';

/** Account side of the tours (the auth store, wired in main.ts). */
export interface TourAccount {
  /** Signed-in user, or null (no tour while signed out). */
  userId(): string | null;
  /** `tours` account preference: `{ home: true, ... }`. */
  remote(): unknown;
  /** Writes the `tours` preference (null removes it). */
  save(value: Readonly<Record<string, true>> | null): void;
}

/** Device copy of the seen tours, per user: `{ "<user id>": ["home", ...] }`. */
export const TOURS_STORAGE_KEY = 'jdr.tours';
/** "1" turns the tours off on this device (automated tests, kiosks). */
export const TOURS_OFF_KEY = 'jdr.tours.off';

export interface ActiveTour {
  readonly id: TourId;
  readonly steps: readonly TourStep[];
  readonly index: number;
}

/** Steps present on screen: visible elements only. */
function onScreen(selector: string): boolean {
  const element = document.querySelector(selector);
  if (element === null) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Guided tours: a page offers its tour once it is drawn; the tour starts if the user has not
 * seen it yet (account preference, plus a copy on the device for the offline case). Finishing
 * or skipping marks it seen; leaving the page mid-way does not.
 */
export class TourStore {
  active = $state.raw<ActiveTour | null>(null);

  constructor(
    private account: TourAccount | null = null,
    private storage: Storage | null = null,
  ) {}

  connect(account: TourAccount, storage: Storage | null): void {
    this.account = account;
    this.storage = storage;
  }

  /** Starts the tour if it was never seen. Returns true when it started. */
  offer(id: TourId, isPresent: (selector: string) => boolean = onScreen): boolean {
    if (this.active !== null || this.off()) return false;
    const user = this.account?.userId() ?? null;
    if (user === null || this.seen(user).has(id)) return false;
    return this.start(id, isPresent);
  }

  /** Starts the tour even if already seen. */
  start(id: TourId, isPresent: (selector: string) => boolean = onScreen): boolean {
    const steps = presentSteps(TOURS[id], isPresent);
    if (steps.length === 0) return false;
    this.active = { id, steps, index: 0 };
    return true;
  }

  next(): void {
    const active = this.active;
    if (active === null) return;
    if (active.index >= active.steps.length - 1) this.finish();
    else this.active = { ...active, index: active.index + 1 };
  }

  previous(): void {
    const active = this.active;
    if (active !== null && active.index > 0) this.active = { ...active, index: active.index - 1 };
  }

  /** Last step done or tour skipped: never offered again. */
  finish(): void {
    const active = this.active;
    if (active === null) return;
    this.active = null;
    const user = this.account?.userId() ?? null;
    if (user === null) return;
    const seen = this.seen(user);
    seen.add(active.id);
    this.writeLocal(user, [...seen]);
    this.account?.save(Object.fromEntries([...seen].map((tour) => [tour, true as const])));
  }

  /** Page left mid-way: closed, offered again next time. */
  cancel(): void {
    this.active = null;
  }

  /** Every tour is offered again (profile). */
  reset(): void {
    this.active = null;
    const user = this.account?.userId() ?? null;
    if (user === null) return;
    this.writeLocal(user, []);
    this.account?.save(null);
  }

  /** Tours seen by the user: account preference and device copy. */
  seen(user: string): Set<TourId> {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- computed on demand, not state
    const seen = new Set<TourId>();
    const remote = this.account?.remote();
    if (remote !== null && typeof remote === 'object' && !Array.isArray(remote)) {
      for (const [key, value] of Object.entries(remote)) {
        if (value === true && isTourId(key)) seen.add(key);
      }
    }
    for (const key of this.readLocal()[user] ?? []) if (isTourId(key)) seen.add(key);
    return seen;
  }

  private off(): boolean {
    try {
      return this.storage?.getItem(TOURS_OFF_KEY) === '1';
    } catch {
      return false;
    }
  }

  private readLocal(): Record<string, string[]> {
    try {
      const parsed: unknown = JSON.parse(this.storage?.getItem(TOURS_STORAGE_KEY) ?? '{}');
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out: Record<string, string[]> = {};
      for (const [user, list] of Object.entries(parsed)) {
        if (Array.isArray(list)) out[user] = list.filter((v): v is string => typeof v === 'string');
      }
      return out;
    } catch {
      return {};
    }
  }

  private writeLocal(user: string, tours: readonly string[]): void {
    try {
      const all = this.readLocal();
      all[user] = [...tours];
      this.storage?.setItem(TOURS_STORAGE_KEY, JSON.stringify(all));
    } catch {
      // Kept on the account only.
    }
  }
}

/** Store of the guided tours. */
export const tour = new TourStore();

/** Offers a tour once the page is drawn (two frames: children and layout are in place). */
export function offerTour(id: TourId): void {
  requestAnimationFrame(() => requestAnimationFrame(() => tour.offer(id)));
}
