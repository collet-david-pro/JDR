import { expect, test } from "@playwright/test";
import { resetRateLimits } from "../helpers/db";
import { main } from "../helpers/env";
import {
  createGame,
  createMap,
  createSession,
  createTokenDef,
  openUser,
  placeOp,
  postOps,
  startSession,
  uid,
  watchErrors,
} from "../helpers/sessions";

/**
 * P7e: the GM console "Screens" panel. The GM adds a screen (code + QR), an anonymous context pairs
 * it, then the GM changes its settings, locks the view, edits the pause screen and revokes it.
 */

test.beforeAll(() => {
  resetRateLimits(main.dbName);
});

test("GM adds, drives and revokes a projection screen", async ({ browser }) => {
  test.setTimeout(150_000);
  const gm = await openUser(browser, "gm-screens");
  const gameId = await createGame(gm, []);
  const map = await createMap(gm, gameId);
  const pc = await createTokenDef(gm, gameId, "Aria", 10, "pc");
  await postOps(gm, map, [placeOp(map.floor, uid(), pc, [5, 5])]);
  const session = await createSession(gm, gameId, map.id);
  await startSession(gm, session.id);

  const errors = watchErrors(gm.page);
  const context = await browser.newContext({ baseURL: main.baseURL, locale: "fr-FR" });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async () => ({ released: false, release: async () => undefined, addEventListener: () => undefined }),
      },
    });
  });
  const screen = await context.newPage();
  try {
    await gm.page.goto(`/sessions/${session.id}`);
    await expect(gm.page.getByTestId("console-viewport")).toHaveAttribute("data-scene", "ready", { timeout: 30_000 });
    await expect(gm.page.getByTestId("console-viewport")).toHaveAttribute("data-table-viewers", "");

    // Add a screen: code (6 digits) and QR.
    await gm.page.getByTestId("panel-tab-displays").click();
    await expect(gm.page.getByTestId("displays-panel")).toBeVisible();
    await gm.page.getByTestId("displays-add-name").fill("Table");
    await gm.page.getByTestId("displays-add").click();
    const item = gm.page.locator('[data-testid^="display-item-"]');
    await expect(item).toHaveCount(1);
    const id = (await item.getAttribute("data-testid"))!.replace("display-item-", "");
    await expect(item).toHaveAttribute("data-state", "pending");
    const code = ((await gm.page.getByTestId(`display-code-${id}`).textContent()) ?? "").replace(/\s+/g, "");
    expect(code).toMatch(/^\d{6}$/);
    await expect(gm.page.getByTestId(`display-qr-${id}`).locator("svg")).toBeVisible();
    await expect(gm.page.getByTestId(`display-link-${id}`)).toContainText("/display");

    // The anonymous context pairs with the code.
    await screen.goto("/display");
    await screen.getByTestId("display-code").fill(code);
    await screen.getByTestId("display-pair").click();
    await expect(screen.getByTestId("display-page")).toHaveAttribute("data-status", "running", { timeout: 30_000 });
    const active = gm.page.getByTestId(`display-item-${id}`);
    await expect(active).toHaveAttribute("data-state", "active", { timeout: 20_000 });
    await expect(active).toHaveAttribute("data-online", "true", { timeout: 20_000 });
    await expect(gm.page.getByTestId(`display-code-${id}`)).toHaveCount(0);
    // An active screen on a running session: the table is explored by the console.
    await expect(gm.page.getByTestId("console-viewport")).toHaveAttribute("data-table-viewers", /\w+/, { timeout: 15_000 });

    // Rotation 180.
    await gm.page.getByTestId(`display-rotation-${id}`).selectOption("180");
    await gm.page.getByTestId(`display-save-${id}`).click();
    await expect(screen.getByTestId("display-stage")).toHaveAttribute("data-rotation", "180", { timeout: 15_000 });

    // Tokens hidden.
    await gm.page.getByTestId(`display-tokens-${id}`).uncheck();
    await gm.page.getByTestId(`display-save-${id}`).click();
    await expect(screen.getByTestId("display-viewport")).toHaveAttribute("data-tokens", "off", { timeout: 15_000 });

    // Lock the view here.
    await gm.page.getByTestId(`display-lock-${id}`).click();
    await expect(gm.page.getByTestId(`display-unlock-${id}`)).toBeVisible();
    const list = await gm.request.get(`/api/v1/sessions/${session.id}/displays`, { headers: gm.headers });
    const listed = (await list.json()).data.displays.find((d: { id: string }) => d.id === id);
    expect(listed.settings.view_lock).not.toBeNull();

    // Camera broadcast switch.
    const broadcast = gm.page.getByTestId("console-broadcast-camera");
    await broadcast.check();
    await expect(broadcast).toHaveAttribute("data-on", "true");
    await broadcast.uncheck();
    await expect(broadcast).toHaveAttribute("data-on", "false");

    // Pause screen text, then pause / resume.
    await gm.page.getByTestId("console-pause-screen").click();
    await gm.page.getByTestId("pause-screen-text").fill("Pause : revenez dans dix minutes");
    await gm.page.getByTestId("pause-screen-save").click();
    await expect(gm.page.getByTestId("pause-screen-dialog")).toHaveCount(0);
    await gm.page.getByTestId("session-pause").click();
    await expect(screen.getByTestId("display-pause")).toContainText("revenez dans dix minutes", { timeout: 15_000 });
    await gm.page.getByTestId("session-resume").click();
    await expect(screen.getByTestId("display-page")).toHaveAttribute("data-status", "running", { timeout: 15_000 });

    expect(errors).toEqual([]);

    // Revocation.
    await gm.page.getByTestId(`display-revoke-${id}`).click();
    await gm.page.getByTestId(`display-revoke-confirm-${id}`).click();
    await expect(screen.getByTestId("display-pair-form")).toBeVisible({ timeout: 5_000 });
    await expect(gm.page.getByTestId(`display-item-${id}`)).toHaveCount(0);
  } finally {
    await context.close();
    await gm.context?.close();
  }
});
