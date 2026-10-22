import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { AdminApi, login } from "../helpers/app";
import { resetRateLimits } from "../helpers/db";
import { main, unique, userPassword } from "../helpers/env";

/**
 * Maps P4b (projet.md 15.1, 13.5, 23 P4): Maps tab, server save, reload, brutal close of the
 * tab (≤ 1.5 s lost; the IndexedDB queue is sent again), offline then back online (no loss,
 * no duplicate). Elements are found through data-testid / data-* attributes (translations of
 * i18n/_pending until merged). Without WebGPU / WebGL 2 the scenario is skipped.
 */

const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures/uploads",
);

test.beforeAll(() => {
  resetRateLimits(main.dbName);
});

// page.route() does not see the requests of a page controlled by a service worker (WebKit):
// the brutal-close scenario blocks /ops with a route, so the worker is left out here.
test.use({ serviceWorkers: "block" });

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    // Failed requests while offline / blocked are expected in these scenarios.
    if (
      msg.type() === "error" &&
      !/Failed to load resource|NetworkError|net::ERR/i.test(msg.text())
    ) {
      errors.push(msg.text());
    }
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

/** A GM with a tile in their library and a new game; ends on the game page (Maps tab). */
async function gmWithGame(page: Page): Promise<string> {
  const gm = unique("Cartographe");
  const api = await AdminApi.open(main.baseURL);
  await api.send("post", "/admin/users", {
    email: `${gm.toLowerCase()}@example.test`,
    username: gm,
    role: "user",
    password: userPassword,
  });
  await api.close();
  await login(page, gm, userPassword);
  await page.goto("/library");
  await page.locator("section.upload").getByLabel("Type").selectOption("tile");
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.join(fixtures, "valid_png_opaque.png"));
  await expect(page.locator("ul.queue li.item-done")).toHaveCount(1, {
    timeout: 20_000,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Nouvelle partie" }).click();
  await page.locator('input[name="name"]').fill(unique("Campagne "));
  await page.getByRole("button", { name: "Créer la partie" }).click();
  await expect(page).toHaveURL(/\/games\/\d+$/);
  return new URL(page.url()).pathname.split("/").pop() as string;
}

/** Creates a map from the Maps tab; the editor opens. Returns the map id, or null without GPU. */
async function createMap(
  page: Page,
  gameId: string,
  name: string,
  width: number,
  height: number,
  folder = "",
): Promise<string | null> {
  await expect(page.getByTestId("map-new")).toBeVisible();
  await page.getByTestId("map-new").click();
  const form = page.getByTestId("map-create-form");
  await expect(form).toBeVisible();
  await form.locator('input[name="name"]').fill(name);
  await form.locator('input[name="folder"]').fill(folder);
  await form.locator('input[name="width"]').fill(String(width));
  await form.locator('input[name="height"]').fill(String(height));
  await page.getByTestId("map-create").click();
  await expect(page).toHaveURL(new RegExp(`/games/${gameId}/maps/\\d+/edit$`));
  const mapId = new URL(page.url()).pathname.split("/")[4] as string;
  return (await editorReady(page)) ? mapId : null;
}

/** Waits for the engine and the map content; false when no GPU renderer is available. */
async function editorReady(page: Page): Promise<boolean> {
  const viewport = page.getByTestId("editor-viewport");
  await expect(viewport).toHaveAttribute(
    "data-state",
    /^(ready|unsupported|error)$/,
    {
      timeout: 30_000,
    },
  );
  if ((await viewport.getAttribute("data-state")) === "unsupported")
    return false;
  await expect(viewport).toHaveAttribute("data-state", "ready");
  await expectSaved(page);
  return true;
}

async function expectSaved(page: Page, timeout = 15_000): Promise<void> {
  await expect(page.getByTestId("save-status")).toHaveAttribute(
    "data-state",
    "saved",
    { timeout },
  );
}

async function addTile(page: Page): Promise<void> {
  await page.getByTestId("palette-add").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("button.tile").first()).toBeVisible({
    timeout: 10_000,
  });
  await dialog.locator("button.tile").first().click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("palette-item-1")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

async function centre(page: Page): Promise<{ x: number; y: number }> {
  const box = (await page.getByTestId("editor-viewport").boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function stroke(
  page: Page,
  dx: number,
  dy: number,
  length = 120,
): Promise<void> {
  const c = await centre(page);
  await page.mouse.move(c.x + dx, c.y + dy);
  await page.mouse.down();
  await page.mouse.move(c.x + dx + length, c.y + dy, { steps: 8 });
  await page.mouse.up();
}

/* ---- Server side (REST API with the page's session cookie) ------------------------------- */

interface MapState {
  revision: number;
  /** Non-empty cells per layer. */
  cells: Record<string, number>;
}

const LAYERS = ["ground", "terrain", "decor"];

async function mapState(
  request: APIRequestContext,
  mapId: string,
): Promise<MapState> {
  const meta = await request.get(`/api/v1/maps/${mapId}`);
  expect(meta.ok()).toBeTruthy();
  const revision = Number((await meta.json()).data.revision);
  const res = await request.get(`/api/v1/maps/${mapId}/chunks`);
  expect(res.ok()).toBeTruthy();
  const bytes = Buffer.from(await res.body());
  const cells: Record<string, number> = { ground: 0, terrain: 0, decor: 0 };
  let o = 0;
  while (o < bytes.length) {
    const layer = LAYERS[bytes.readUInt8(o + 4)]!;
    const len = bytes.readUInt32LE(o + 5);
    const raw = inflateRawSync(bytes.subarray(o + 9, o + 9 + len));
    expect(raw.length).toBe(4104);
    for (let i = 8; i < raw.length; i += 4)
      if (raw.readUInt16LE(i) !== 0) cells[layer]!++;
    o += 9 + len;
  }
  return { revision, cells };
}

/** Pipette on the centre of the map: the painted tile becomes the selected palette item. */
async function expectTileAtCentre(page: Page, dx = 0, dy = 0): Promise<void> {
  await expect(page.getByTestId("palette-item-1")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.getByTestId("tool-pipette").click();
  const c = await centre(page);
  const item = page.getByTestId("palette-item-1");
  // After a reload the fitted view can move by a pixel or two between engines: the stroke row
  // may then sit just beside the exact centre line, so probe a few points across the row.
  for (const offset of [0, 4, -4]) {
    await page.mouse.click(c.x + dx, c.y + dy + offset);
    if ((await item.getAttribute("aria-pressed")) === "true") break;
  }
  await expect(item).toHaveAttribute("aria-pressed", "true");
}

function opsIds(page: Page): Set<string> {
  const ids = new Set<string>();
  page.on("response", (response) => {
    const req = response.request();
    if (
      req.method() === "POST" &&
      /\/maps\/\d+\/ops$/.test(req.url()) &&
      response.ok()
    ) {
      ids.add((req.postDataJSON() as { client_op_id: string }).client_op_id);
    }
  });
  return ids;
}

/* ---- Scenarios ----------------------------------------------------------------------------- */

test("Maps tab: create, rename, duplicate, trash and restore; the drawing survives a reload", async ({
  page,
  browserName,
}) => {
  const errors = watchErrors(page);
  const gameId = await gmWithGame(page);
  await expect(page.getByTestId("maps-empty")).toBeVisible();
  const mapId = await createMap(
    page,
    gameId,
    "Crypte",
    40,
    30,
    "Acte 1/Crypte",
  );
  test.skip(
    mapId === null,
    `${browserName}: neither WebGPU nor WebGL 2 in this headless browser`,
  );

  await addTile(page);
  await stroke(page, -60, 0);
  await expect(page.getByTestId("save-status")).toHaveAttribute(
    "data-state",
    /saving|saved/,
  );
  await expectSaved(page);
  const saved = await mapState(page.request, mapId!);
  expect(saved.revision).toBeGreaterThanOrEqual(1);
  expect(saved.cells.ground).toBeGreaterThan(0);

  await page.reload();
  expect(await editorReady(page)).toBe(true);
  await expectTileAtCentre(page);
  expect(await mapState(page.request, mapId!)).toEqual(saved);

  // Back to the Maps tab: folder, rename / move, duplicate, trash, restore.
  await page.goto(`/games/${gameId}?tab=maps`);
  const card = page.getByTestId("map-card").filter({ hasText: "Crypte" });
  await expect(card).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "Acte 1/Crypte" }),
  ).toBeVisible();
  await card.getByTestId("map-edit").click();
  const edit = page.getByTestId("map-edit-form");
  await edit.locator('input[name="name"]').fill("Crypte basse");
  await edit.locator('input[name="folder"]').fill("");
  await edit.locator('button[type="submit"]').click();
  await expect(edit).toBeHidden();
  const renamed = page
    .getByTestId("map-card")
    .filter({ hasText: "Crypte basse" });
  await expect(renamed).toHaveCount(1);
  await renamed.getByTestId("map-duplicate").click();
  await expect(page.getByTestId("map-card")).toHaveCount(2);
  await renamed.first().getByTestId("map-trash").click();
  await expect(page.getByTestId("map-card")).toHaveCount(1);
  await page.getByTestId("maps-view-trash").click();
  await expect(page.getByTestId("map-card")).toHaveCount(1);
  await page.getByTestId("map-restore").click();
  await expect(page.getByTestId("maps-empty")).toBeVisible();
  await page.getByTestId("maps-view-active").click();
  await expect(page.getByTestId("map-card")).toHaveCount(2);

  // The duplicate carries the drawing.
  const ids = await page
    .getByTestId("map-card")
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-map-id") as string),
    );
  const copy = ids.find((id) => id !== mapId)!;
  expect((await mapState(page.request, copy)).cells).toEqual(saved.cells);
  expect(errors).toEqual([]);
});

test("P4: 10 000 cells then brutal close of the tab ⇒ nothing older than 1.5 s is lost", async ({
  page,
  context,
  browserName,
}) => {
  const gameId = await gmWithGame(page);
  const mapId = await createMap(page, gameId, "Grande salle", 100, 100);
  test.skip(
    mapId === null,
    `${browserName}: neither WebGPU nor WebGL 2 in this headless browser`,
  );
  await addTile(page);
  await expectSaved(page);

  // 1. The ops cannot reach the server: they only live in IndexedDB when the tab dies (a
  // keepalive request sent while the page closes may still get through: that is allowed).
  let blocked = 0;
  await page.route("**/api/v1/maps/*/ops", (route) => {
    blocked++;
    void route.abort("failed");
  });
  await page.getByTestId("tool-fill").click();
  const c = await centre(page);
  await page.mouse.click(c.x, c.y);
  await expect(page.getByTestId("status-history")).toHaveAttribute(
    "data-count",
    "1",
  );
  await page.waitForTimeout(2000);
  expect(blocked).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId("save-status")).not.toHaveAttribute(
    "data-state",
    "saved",
  );
  await page.close({ runBeforeUnload: false });

  const page2 = await context.newPage();
  const sent = opsIds(page2);
  await page2.goto(`/games/${gameId}/maps/${mapId}/edit`);
  expect(await editorReady(page2)).toBe(true);
  await expect.poll(() => sent.size).toBeGreaterThanOrEqual(1);
  const afterReplay = await mapState(page2.request, mapId!);
  expect(afterReplay.cells.ground).toBe(10_000);

  // 2. Normal network: fill another layer, close 1.6 s later.
  await page2.getByTestId("editor-viewport").focus();
  await page2.keyboard.press("2");
  await expect(page2.getByTestId("layer-activate-terrain")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page2.getByTestId("palette-item-1").click();
  await page2.getByTestId("tool-fill").click();
  const c2 = await centre(page2);
  await page2.mouse.click(c2.x, c2.y);
  await page2.waitForTimeout(1600);
  await page2.close({ runBeforeUnload: false });

  const page3 = await context.newPage();
  await page3.goto(`/games/${gameId}/maps/${mapId}/edit`);
  expect(await editorReady(page3)).toBe(true);
  const final = await mapState(page3.request, mapId!);
  expect(final.cells).toEqual({ ground: 10_000, terrain: 10_000, decor: 0 });
});

test("offline: ops wait locally, then sync once without loss or duplicate", async ({
  page,
  context,
  browserName,
}) => {
  const errors = watchErrors(page);
  const gameId = await gmWithGame(page);
  const mapId = await createMap(page, gameId, "Forêt", 40, 30);
  test.skip(
    mapId === null,
    `${browserName}: neither WebGPU nor WebGL 2 in this headless browser`,
  );
  await addTile(page);
  await expectSaved(page);
  const sent = opsIds(page);
  const before = await mapState(page.request, mapId!);

  await context.setOffline(true);
  await stroke(page, -60, 0);
  const status = page.getByTestId("save-status");
  await expect(status).toHaveAttribute("data-state", "offline", {
    timeout: 10_000,
  });
  await expect(status).not.toHaveAttribute("data-pending", "0");
  await stroke(page, -60, 70);
  await page.waitForTimeout(3000);
  await expect(status).toHaveAttribute("data-state", "offline");
  const pending = Number(await status.getAttribute("data-pending"));
  expect(pending).toBeGreaterThan(0);

  await context.setOffline(false);
  await expectSaved(page, 45_000);
  const after = await mapState(page.request, mapId!);
  // Each batch applied exactly once: one revision per distinct client_op_id.
  expect(after.revision).toBe(before.revision + sent.size);
  expect(after.cells.ground).toBe(pending);

  await page.reload();
  expect(await editorReady(page)).toBe(true);
  expect(await mapState(page.request, mapId!)).toEqual(after);
  await expectTileAtCentre(page, -30, 0);
  expect(errors).toEqual([]);
});
