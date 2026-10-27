/**
 * Keeps a projection screen awake (D12), independent of Svelte.
 *
 * 1. Screen Wake Lock API: `navigator.wakeLock.request('screen')`, requested again at every
 *    `visibilitychange` to visible and after a release (the browser releases the lock when the
 *    tab is hidden);
 * 2. fallback: a muted looping `<video>` fed by `canvas.captureStream()` (a 2×2 canvas redrawn
 *    every few seconds), which keeps most browsers from sleeping;
 * 3. otherwise `unsupported` (the page shows a banner).
 *
 * State: `active` (wake lock held), `video` (fallback), `unsupported`, `idle` (not started or
 * stopped). Every dependency is injectable (tests); `browserWakeLockDeps()` gives the real ones.
 */
export type WakeLockState = 'active' | 'video' | 'unsupported' | 'idle';

export interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

/** A started fallback: `play()` is called again when the page becomes visible. */
export interface VideoFallback {
  play(): void;
  stop(): void;
}

export interface WakeLockDeps {
  /** null: the browser has no Wake Lock API. */
  request: (() => Promise<WakeLockSentinelLike>) | null;
  /** Starts the video fallback; null / throws: not available. */
  startVideo: (() => VideoFallback | null) | null;
  isVisible(): boolean;
  /** Registers a visibilitychange listener; returns its removal. */
  onVisibility(listener: () => void): () => void;
}

export class WakeLockManager {
  private current: WakeLockState = 'idle';
  private sentinel: WakeLockSentinelLike | null = null;
  private video: VideoFallback | null = null;
  private stopListening: (() => void) | null = null;
  private running = false;
  private acquiring = false;

  constructor(
    private readonly deps: WakeLockDeps,
    private readonly onChange: (state: WakeLockState) => void = () => undefined,
  ) {}

  get state(): WakeLockState {
    return this.current;
  }

  start(): Promise<void> {
    if (this.running) return Promise.resolve();
    this.running = true;
    this.stopListening = this.deps.onVisibility(() => {
      if (!this.running || !this.deps.isVisible()) return;
      this.video?.play();
      void this.acquire();
    });
    return this.acquire();
  }

  stop(): void {
    this.running = false;
    this.stopListening?.();
    this.stopListening = null;
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel !== null && !sentinel.released) void sentinel.release().catch(() => undefined);
    this.video?.stop();
    this.video = null;
    this.set('idle');
  }

  private set(state: WakeLockState): void {
    if (state === this.current) return;
    this.current = state;
    this.onChange(state);
  }

  /** Gets the wake lock when none is held (falls back to the video when it is refused). */
  private async acquire(): Promise<void> {
    if (!this.running || this.acquiring) return;
    if (this.sentinel !== null && !this.sentinel.released) return;
    if (this.deps.request !== null && this.deps.isVisible()) {
      this.acquiring = true;
      try {
        const sentinel = await this.deps.request();
        if (!this.running) {
          void sentinel.release().catch(() => undefined);
          return;
        }
        this.sentinel = sentinel;
        sentinel.addEventListener('release', () => {
          if (this.sentinel !== sentinel) return;
          this.sentinel = null;
          if (this.running) {
            this.set('idle');
            void this.acquire();
          }
        });
        this.video?.stop();
        this.video = null;
        this.set('active');
        return;
      } catch {
        // Refused (battery saver, permissions policy...): use the fallback.
      } finally {
        this.acquiring = false;
      }
    } else if (this.deps.request !== null) {
      // Hidden: a wake lock cannot be taken now, the next visibilitychange asks again.
      return;
    }
    this.fallback();
  }

  private fallback(): void {
    if (this.video !== null) {
      this.set('video');
      return;
    }
    try {
      this.video = this.deps.startVideo?.() ?? null;
    } catch {
      this.video = null;
    }
    this.set(this.video === null ? 'unsupported' : 'video');
  }
}

/** Real dependencies from the browser globals. */
export function browserWakeLockDeps(): WakeLockDeps {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const wakeLock = nav !== null && 'wakeLock' in nav ? nav.wakeLock : null;
  return {
    request: wakeLock === null ? null : () => wakeLock.request('screen'),
    startVideo: typeof document === 'undefined' ? null : startCanvasVideo,
    isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    onVisibility: (listener) => {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
  };
}

const REDRAW_MS = 4000;

/** Video fed by a 2×2 canvas that is redrawn now and then, kept out of sight. */
function startCanvasVideo(): VideoFallback | null {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext('2d');
  if (ctx === null || typeof canvas.captureStream !== 'function') return null;
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute('aria-hidden', 'true');
  video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
  let tick = 0;
  const draw = (): void => {
    tick += 1;
    ctx.fillStyle = tick % 2 === 0 ? '#000' : '#010101';
    ctx.fillRect(0, 0, 2, 2);
  };
  draw();
  video.srcObject = canvas.captureStream(1);
  document.body.append(video);
  const play = (): void => void video.play().catch(() => undefined);
  play();
  const timer = setInterval(draw, REDRAW_MS);
  return {
    play,
    stop: () => {
      clearInterval(timer);
      video.pause();
      video.srcObject = null;
      video.remove();
    },
  };
}
