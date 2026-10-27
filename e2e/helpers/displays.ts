import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { main } from './env';
import { watchErrors, type Actor } from './sessions';

/**
 * P7f: helpers of the projection-screen specs (an anonymous browser context that pairs to a
 * session, GM-side settings, Wake Lock stubs). `createDisplay` / `deleteDisplay` live in sessions.ts.
 */

export type WakeMode = 'stub' | 'count' | 'none';

export interface ScreenOptions {
  viewport?: { width: number; height: number };
  /** window.screen size (the scale comes from it when only the diagonal is known). */
  screen?: { width: number; height: number };
  deviceScaleFactor?: number;
  /** stub = a Wake Lock that always works; count = it counts the requests (window.__wake); none = no Wake Lock. */
  wake?: WakeMode;
}

export interface Screen {
  context: BrowserContext;
  page: Page;
  errors: string[];
  request: APIRequestContext;
}

/** A context without account (the screen), the E2E hook on, the Wake Lock stubbed per `wake`. */
export async function openScreen(browser: Browser, o: ScreenOptions = {}): Promise<Screen> {
  const context = await browser.newContext({
    baseURL: main.baseURL,
    locale: 'fr-FR',
    ...(o.viewport ? { viewport: o.viewport } : {}),
    ...(o.screen ? { screen: o.screen } : {}),
    ...(o.deviceScaleFactor ? { deviceScaleFactor: o.deviceScaleFactor } : {}),
  });
  const wake = o.wake ?? 'stub';
  await context.addInitScript((mode: WakeMode) => {
    try {
      window.localStorage.setItem('jdr.test', '1');
    } catch {
      /* no storage */
    }
    const w = window as any;
    if (mode === 'none') {
      try {
        delete (Navigator.prototype as any).wakeLock;
      } catch {
        /* not configurable */
      }
      try {
        Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
      } catch {
        /* ignore */
      }
      return;
    }
    w.__wake = { calls: 0, sentinels: [] as any[] };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async (type: string) => {
          w.__wake.calls++;
          const listeners: Array<() => void> = [];
          const sentinel: any = {
            released: false,
            type,
            release: async () => {
              sentinel.released = true;
              listeners.forEach((fn) => fn());
            },
            addEventListener: (name: string, fn: () => void) => {
              if (name === 'release') listeners.push(fn);
            },
            removeEventListener: () => undefined,
            fire: () => {
              sentinel.released = true;
              listeners.forEach((fn) => fn());
              if (typeof sentinel.onrelease === 'function') sentinel.onrelease();
            },
          };
          w.__wake.sentinels.push(sentinel);
          return sentinel;
        },
      },
    });
  }, wake);
  const page = await context.newPage();
  return { context, page, errors: watchErrors(page), request: context.request };
}

/** Errors that matter: the cut event stream of a revoked or offline screen is tolerated. */
export const screenErrors = (errors: string[]): string[] => errors.filter((e) => !/api\/v1\/stream/.test(e));

/** Pairs through the form of /display. */
export async function pairByForm(page: Page, code: string): Promise<void> {
  await page.goto('/display');
  await page.getByTestId('display-code').fill(code);
  await page.getByTestId('display-pair').click();
}

/** Pairs through the ?c= link. */
export async function pairByUrl(page: Page, code: string): Promise<void> {
  await page.goto(`/display?c=${code}`);
}

/** The screen is paired, the session runs and the scene is drawn. */
export async function waitScene(page: Page, timeout = 30_000): Promise<void> {
  await expect(page.getByTestId('display-page')).toHaveAttribute('data-status', 'running', { timeout });
  await expect(page.getByTestId('display-viewport')).toHaveAttribute('data-scene', 'ready', { timeout });
}

/** GM side: partial settings patch (and optional name). */
export async function patchSettings(gm: Actor, displayId: string, settings: Record<string, unknown>): Promise<void> {
  const res = await gm.request.patch(`/api/v1/displays/${displayId}`, { headers: gm.headers, data: { settings } });
  expect(res.ok(), `PATCH display -> ${res.status()} ${await res.text()}`).toBeTruthy();
}

export interface DisplayRow {
  id: string;
  state: 'pending' | 'active';
  online: boolean;
  settings: Record<string, any>;
}

/** GM side: the screens of a session. */
export async function listDisplays(gm: Actor, sessionId: string): Promise<DisplayRow[]> {
  const res = await gm.request.get(`/api/v1/sessions/${sessionId}/displays`, { headers: gm.headers });
  expect(res.ok(), `GET displays -> ${res.status()}`).toBeTruthy();
  return (await res.json()).data.displays as DisplayRow[];
}

/** The page applied a move of `uid` to (x, y) (window.__jdrTest hook); returns the time of detection. */
export async function waitToken(page: Page, id: string, x: number, y: number, timeout = 30_000): Promise<number> {
  await page.waitForFunction(
    ([u, px, py]) => {
      const t = (window as any).__jdrTest?.tokens?.[u as string];
      return t !== undefined && t[0] === px && t[1] === py;
    },
    [id, x, y] as const,
    { polling: 20, timeout },
  );
  return Date.now();
}

/** Size in CSS px of a cell as drawn (display-viewport[data-cell-css-px]). */
export async function cellCssPx(page: Page): Promise<number> {
  const raw = await page.getByTestId('display-viewport').getAttribute('data-cell-css-px');
  return Number(raw);
}
