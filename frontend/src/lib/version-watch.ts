/**
 * Detects a site update while a page stays open (IRL screen, player view): GET /version gives the
 * build currently served; when it differs from the boot one, the page is out of date (old chunks
 * gone, new API). Checked every few minutes, when the tab comes back, when the network returns and
 * when a lazy chunk fails to load. Nothing is reported during the maintenance of the update.
 */

export interface ServedVersion {
  readonly build: string;
  readonly maintenance: boolean;
}

export interface VersionWatchOptions {
  /** Build of the running page ("" = unknown, nothing is watched). */
  readonly current: string;
  readonly fetchVersion: () => Promise<ServedVersion>;
  /** Called once, with the new build. */
  readonly onNewVersion: (build: string) => void;
  readonly window: Pick<
    Window,
    'addEventListener' | 'removeEventListener' | 'setInterval' | 'clearInterval'
  >;
  readonly document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  readonly intervalMs?: number;
}

export const VERSION_CHECK_MS = 5 * 60_000;

/** Starts watching; returns the stop function. */
export function watchVersion(options: VersionWatchOptions): () => void {
  const { current, window: win, document: doc } = options;
  if (current === '') return () => {};
  let stopped = false;
  let checking = false;

  const check = (): void => {
    if (stopped || checking) return;
    checking = true;
    options
      .fetchVersion()
      .then((served) => {
        if (stopped || served.maintenance || served.build === '' || served.build === current)
          return;
        stop();
        options.onNewVersion(served.build);
      })
      .catch(() => {
        // Offline or server busy: the next trigger tries again.
      })
      .finally(() => {
        checking = false;
      });
  };
  const onVisibility = (): void => {
    if (doc.visibilityState === 'visible') check();
  };

  const timer = win.setInterval(check, options.intervalMs ?? VERSION_CHECK_MS);
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('online', check);
  win.addEventListener('vite:preloadError', check);

  function stop(): void {
    stopped = true;
    win.clearInterval(timer);
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('online', check);
    win.removeEventListener('vite:preloadError', check);
  }
  return stop;
}

/** Pages reloaded without asking (state rebuilt from the server); elsewhere a banner offers it. */
const AUTO_RELOAD_ROUTES: ReadonlySet<string> = new Set(['display', 'session', 'join']);

export function autoReloadRoute(routeName: string | null | undefined): boolean {
  return routeName != null && AUTO_RELOAD_ROUTES.has(routeName);
}

/** True while the user types in a field: the reload waits. */
export function isEditing(active: Element | null): boolean {
  if (active === null) return false;
  const tag = active.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (active as HTMLElement).isContentEditable === true
  );
}

const RELOADED_KEY = 'jdr-reloaded-for';

/**
 * Remembers the build a reload was made for; false when a reload was already made for it (the
 * server or a proxy still gives the old page): no reload loop, the banner takes over.
 */
export function claimReload(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  build: string,
): boolean {
  try {
    if (storage === null || storage.getItem(RELOADED_KEY) === build) return false;
    storage.setItem(RELOADED_KEY, build);
    return true;
  } catch {
    return false;
  }
}
