import { describeError } from '../lib/errors';
import { t } from '../lib/i18n';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
  /** Server request id of an error (helps the administrator find the log entry). */
  readonly requestId: string | null;
}

const DURATION_MS: Record<ToastKind, number> = { info: 5000, success: 4000, error: 10000 };
const MAX_TOASTS = 5;

/** Non-blocking notifications (projet.md 18.2), announced through an aria-live region. */
export class ToastStore {
  items = $state.raw<readonly Toast[]>([]);
  private nextId = 1;
  // Timers are bookkeeping, not displayed state: a plain Map is intended.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  show(kind: ToastKind, message: string, requestId: string | null = null): number {
    const id = this.nextId++;
    this.items = [...this.items, { id, kind, message, requestId }].slice(-MAX_TOASTS);
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), DURATION_MS[kind]),
    );
    return id;
  }

  success(message: string): number {
    return this.show('success', message);
  }

  info(message: string): number {
    return this.show('info', message);
  }

  /** Error toast from any thrown value (message + request id). */
  error(error: unknown): number {
    const { message, requestId } = describeError(error, t);
    return this.show('error', message, requestId);
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(id);
    this.items = this.items.filter((toast) => toast.id !== id);
  }
}

export const toasts = new ToastStore();
