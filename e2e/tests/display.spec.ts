import { expect, test } from "@playwright/test";
import { resetRateLimits } from "../helpers/db";
import { main } from "../helpers/env";
import {
  createDisplay,
  createGame,
  createMap,
  createSession,
  createTokenDef,
  deleteDisplay,
  openUser,
  placeOp,
  postOps,
  startSession,
  transition,
  uid,
  watchErrors,
} from "../helpers/sessions";

/**
 * P7d: the public /display page. A GM runs a session and creates a screen; an anonymous context
 * pairs with ?c=<code>, sees the table view, follows pause / resume, opens the discreet menu and
 * falls back to the pairing form when the GM revokes it.
 */

test.beforeAll(() => {
  resetRateLimits(main.dbName);
});

test("pairing by URL, table view, pause, menu and revocation", async ({ browser }) => {
  test.setTimeout(120_000);
  const gm = await openUser(browser, "gm-display");
  const gameId = await createGame(gm, []);
  const map = await createMap(gm, gameId);
  const pc = await createTokenDef(gm, gameId, "Aria", 10, "pc");
  const tokenUid = uid();
  await postOps(gm, map, [placeOp(map.floor, tokenUid, pc, [5, 5])]);
  const session = await createSession(gm, gameId, map.id);
  await startSession(gm, session.id);
  const display = await createDisplay(gm, session.id);

  // No account: a context of its own; the Wake Lock is stubbed (headless browsers).
  const context = await browser.newContext({ baseURL: main.baseURL, locale: "fr-FR" });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async () => ({ released: false, release: async () => undefined, addEventListener: () => undefined }),
      },
    });
  });
  const page = await context.newPage();
  const errors = watchErrors(page);
  try {
    await page.goto(`/display?c=${display.code}`);
    const root = page.getByTestId("display-page");
    await expect(root).toHaveAttribute("data-status", "running", { timeout: 30_000 });
    const viewport = page.getByTestId("display-viewport");
    await expect(viewport).toHaveAttribute("data-scene", "ready", { timeout: 30_000 });
    await expect(viewport).toHaveAttribute("data-viewers", new RegExp(tokenUid));
    await expect(viewport).toHaveAttribute("data-tokens", "on");
    expect(page.url()).not.toContain("c=");

    // Still paired after a reload.
    await page.reload();
    await expect(root).toHaveAttribute("data-status", "running", { timeout: 30_000 });
    await expect(page.getByTestId("display-pair-form")).toHaveCount(0);

    // Pause then resume.
    expect(await transition(gm, session.id, "pause")).toBe(200);
    await expect(page.getByTestId("display-pause")).toBeVisible({ timeout: 15_000 });
    expect(await transition(gm, session.id, "resume")).toBe(200);
    await expect(root).toHaveAttribute("data-status", "running", { timeout: 15_000 });
    await expect(page.getByTestId("display-viewport")).toHaveAttribute("data-scene", "ready", { timeout: 30_000 });

    // Discreet menu: M, rotation 90.
    await page.keyboard.press("m");
    await expect(page.getByTestId("display-menu")).toBeVisible();
    await page.getByTestId("display-menu-rotation-90").click();
    await expect(page.getByTestId("display-stage")).toHaveAttribute("data-rotation", "90");
    await page.getByTestId("display-menu-close").click();
    await expect(page.getByTestId("display-menu")).toHaveCount(0);

    expect(errors).toEqual([]);

    // Revocation: back to the pairing form within 5 s.
    await deleteDisplay(gm, display.id);
    await expect(page.getByTestId("display-pair-form")).toBeVisible({ timeout: 5_000 });
    await expect(root).toHaveAttribute("data-status", "unpaired");
    // Firefox logs the cut event stream of the revoked screen: only that is tolerated.
    expect(errors.filter((e) => !/api\/v1\/stream/.test(e))).toEqual([]);
  } finally {
    await context.close();
    await gm.context?.close();
  }
});
