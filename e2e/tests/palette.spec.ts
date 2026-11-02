import { expect, test, type Page } from "@playwright/test";
import { resetRateLimits } from "../helpers/db";
import { main } from "../helpers/env";
import { createGame, createMap, createSession, openUser, startSession, watchErrors } from "../helpers/sessions";

/**
 * P9c2: the Cmd/Ctrl+K command palette, in the editor and in the GM console. Commands are searched by
 * their id ("editor.undo", "console.pause"): the ids are stable whatever the translation says.
 */

test.beforeEach(() => {
  resetRateLimits(main.dbName);
});

/** Same detection as the app (detectPlatform): Chromium's profile hides the host, the others do not. */
async function paletteModifier(page: Page): Promise<string> {
  const mac = await page.evaluate(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent);
  });
  return mac ? "Meta" : "Control";
}

async function openPalette(page: Page) {
  await page.keyboard.press(`${await paletteModifier(page)}+k`);
  const palette = page.getByTestId("command-palette");
  await expect(palette).toBeVisible();
  await expect(palette.getByRole("combobox")).toBeFocused();
  return palette;
}

async function run(page: Page, query: string) {
  const palette = await openPalette(page);
  await palette.getByRole("combobox").fill(query);
  await expect(palette.getByTestId("palette-item").first()).toHaveAttribute("data-command", query);
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
}

test("1. editor: search a tool, run it, undo through the palette", async ({ browser, browserName }) => {
  test.setTimeout(120_000);
  const gm = await openUser(browser, "palette-editeur", { hook: false });
  const page = gm.page;
  const errors = watchErrors(page);
  try {
    const gameId = await createGame(gm, []);
    const map = await createMap(gm, gameId, 20, 15);
    await page.goto(`/games/${gameId}/maps/${map.id}/edit`);
    const viewport = page.getByTestId("editor-viewport");
    await expect(viewport).toHaveAttribute("data-state", /^(ready|unsupported|error)$/, { timeout: 30_000 });
    test.skip((await viewport.getAttribute("data-state")) === "unsupported", `${browserName}: no WebGPU / WebGL 2`);
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved", { timeout: 15_000 });

    // Escape closes, Ctrl+K again too.
    const palette = await openPalette(page);
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    await openPalette(page);
    await page.keyboard.press(`${await paletteModifier(page)}+k`);
    await expect(palette).toBeHidden();

    // A tool without a shortcut, found by search and run with Enter.
    await run(page, "editor.tool.stairs");
    await expect(page.getByTestId("tool-stairs")).toHaveAttribute("aria-pressed", "true");
    await run(page, "editor.tool.pipette");
    await expect(page.getByTestId("tool-pipette")).toHaveAttribute("aria-pressed", "true");

    // Undo is offered only once something can be undone.
    const before = await page.getByTestId("editor-theme").inputValue();
    await page.getByTestId("editor-theme").selectOption("slate");
    await expect(page.getByTestId("editor-undo")).toBeEnabled();
    await run(page, "editor.undo");
    await expect(page.getByTestId("editor-theme")).toHaveValue(before);
    await expect(page.getByTestId("editor-undo")).toBeDisabled();
    const again = await openPalette(page);
    await again.getByRole("combobox").fill("editor.undo");
    await expect(again.getByTestId("palette-item").filter({ has: page.locator('[data-command="editor.undo"]') })).toHaveCount(0);
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
  } finally {
    await gm.context.close();
  }
});

test("2. console: pause through the palette, end only asks for confirmation", async ({ browser }) => {
  test.setTimeout(120_000);
  const gm = await openUser(browser, "palette-console", { hook: false });
  const page = gm.page;
  const errors = watchErrors(page);
  try {
    const gameId = await createGame(gm, []);
    const map = await createMap(gm, gameId, 20, 15);
    const session = await createSession(gm, gameId, map.id);
    await startSession(gm, session.id);
    await page.goto(`/sessions/${session.id}`);
    await expect(page.getByTestId("console-viewport")).toHaveAttribute("data-scene", "ready", { timeout: 45_000 });
    await expect(page.getByTestId("session-state")).toHaveAttribute("data-state", "running");

    await run(page, "console.pause");
    await expect(page.getByTestId("session-state")).toHaveAttribute("data-state", "paused", { timeout: 15_000 });

    // Ending: the existing confirmation appears, nothing is ended.
    await run(page, "console.end");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("session-state")).toHaveAttribute("data-state", "paused");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("session-state")).toHaveAttribute("data-state", "paused");

    // Going to a tab.
    await run(page, "console.tab.maps");
    await expect(page.getByTestId("panel-tab-maps")).toHaveAttribute("aria-selected", "true");
    expect(errors).toEqual([]);
  } finally {
    await gm.context.close();
  }
});
