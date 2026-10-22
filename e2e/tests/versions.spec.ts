import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { AdminApi, login } from "../helpers/app";
import { resetRateLimits } from "../helpers/db";
import { main, unique, userPassword } from "../helpers/env";

/**
 * P4c (projet.md 2.5, 11.4 "Versions", 12.1, 23 P4 "restauration de version"): named snapshot
 * (Cmd/Ctrl+Shift+S), restoration (the later drawing disappears, a `pre_restore` version
 * exists), JSON export then import into the same game (identical tile blocks), thumbnail shown
 * in the Maps tab. Without WebGPU / WebGL 2 the scenario is skipped.
 */

const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures/uploads",
);

test.beforeAll(() => {
  resetRateLimits(main.dbName);
});

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
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
  const gm = unique("Archiviste");
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

async function editorReady(page: Page): Promise<boolean> {
  const viewport = page.getByTestId("editor-viewport");
  await expect(viewport).toHaveAttribute(
    "data-state",
    /^(ready|unsupported|error)$/,
    { timeout: 30_000 },
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

async function createMap(page: Page, gameId: string): Promise<string | null> {
  await page.getByTestId("map-new").click();
  const form = page.getByTestId("map-create-form");
  await expect(form).toBeVisible();
  await form.locator('input[name="name"]').fill("Crypte versionnée");
  await form.locator('input[name="width"]').fill("40");
  await form.locator('input[name="height"]').fill("30");
  await page.getByTestId("map-create").click();
  await expect(page).toHaveURL(new RegExp(`/games/${gameId}/maps/\\d+/edit$`));
  const mapId = new URL(page.url()).pathname.split("/")[4] as string;
  return (await editorReady(page)) ? mapId : null;
}

async function addTile(page: Page): Promise<void> {
  await page.getByTestId("palette-add").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("button.tile").first()).toBeVisible({
    timeout: 10_000,
  });
  await dialog.locator("button.tile").first().click();
  await expect(dialog).toBeHidden();
}

async function stroke(page: Page, dy: number): Promise<void> {
  const box = (await page.getByTestId("editor-viewport").boundingBox())!;
  const x = box.x + box.width / 2 - 60;
  const y = box.y + box.height / 2 + dy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y, { steps: 8 });
  await page.mouse.up();
}

/** Decoded tile blocks of a map: "cx:cy:layer" → raw block (hex), plus the painted cells. */
async function blocks(
  request: APIRequestContext,
  mapId: string,
): Promise<{ blocks: Record<string, string>; cells: number }> {
  const res = await request.get(`/api/v1/maps/${mapId}/chunks`);
  expect(res.ok()).toBeTruthy();
  const bytes = Buffer.from(await res.body());
  const out: Record<string, string> = {};
  let cells = 0;
  let o = 0;
  while (o < bytes.length) {
    const cx = bytes.readUInt16LE(o);
    const cy = bytes.readUInt16LE(o + 2);
    const layer = bytes.readUInt8(o + 4);
    const len = bytes.readUInt32LE(o + 5);
    const raw = inflateRawSync(bytes.subarray(o + 9, o + 9 + len));
    for (let i = 8; i < raw.length; i += 4) if (raw.readUInt16LE(i) !== 0) cells++;
    out[`${cx}:${cy}:${layer}`] = raw.toString("hex");
    o += 9 + len;
  }
  return { blocks: out, cells };
}

async function versions(
  request: APIRequestContext,
  mapId: string,
): Promise<{ kind: string; label: string | null }[]> {
  const res = await request.get(`/api/v1/maps/${mapId}/versions`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data;
}

test("P4: named snapshot, restoration, JSON export / import and thumbnail", async ({
  page,
  browserName,
}, testInfo) => {
  const errors = watchErrors(page);
  const gameId = await gmWithGame(page);
  const mapId = await createMap(page, gameId);
  test.skip(
    mapId === null,
    `${browserName}: neither WebGPU nor WebGL 2 in this headless browser`,
  );

  // 1. First drawing, saved.
  await addTile(page);
  await stroke(page, -40);
  await expectSaved(page);
  const before = await blocks(page.request, mapId!);
  expect(before.cells).toBeGreaterThan(0);

  // 2. Named snapshot with Cmd/Ctrl+Shift+S.
  await page.getByTestId("editor-history").click();
  const panel = page.getByTestId("history-panel");
  await expect(panel).toBeVisible();
  const mod = await page.evaluate(() => {
    const nav = navigator as Navigator & {
      userAgentData?: { platform?: string };
    };
    const s = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent;
    return /mac|iphone|ipad|ipod/i.test(s) ? "Meta" : "Control";
  });
  await page.getByTestId("editor-viewport").focus();
  await page.keyboard.press(`${mod}+Shift+S`);
  const form = page.getByTestId("snapshot-form");
  await expect(form).toBeVisible();
  await form.locator('input[name="label"]').fill("Avant le couloir");
  await page.getByTestId("snapshot-submit").click();
  await expect(form).toBeHidden();
  const manual = panel
    .getByTestId("history-version")
    .filter({ hasText: "Avant le couloir" });
  await expect(manual).toHaveAttribute("data-kind", "manual");

  // 3. More drawing after the snapshot.
  await stroke(page, 60);
  await expectSaved(page);
  const after = await blocks(page.request, mapId!);
  expect(after.cells).toBeGreaterThan(before.cells);

  // 4. Restore the snapshot: the later drawing disappears, a pre_restore version exists.
  await manual.getByTestId("history-restore").click();
  const confirm = page.getByRole("dialog");
  await expect(confirm).toBeVisible();
  // (texts of i18n/_pending are not in the build until merged: buttons by role / type)
  await confirm.locator('button[type="submit"]').click();
  // The editor reloads the map: new session, empty undo / redo stack.
  await expect(page.getByTestId("editor-undo")).toBeDisabled({ timeout: 30_000 });
  await expect(page.getByTestId("editor-viewport")).toHaveAttribute(
    "data-state",
    "ready",
    { timeout: 30_000 },
  );
  await expectSaved(page);
  await expect
    .poll(async () => (await blocks(page.request, mapId!)).blocks)
    .toEqual(before.blocks);
  const kinds = (await versions(page.request, mapId!)).map((v) => v.kind);
  expect(kinds).toContain("pre_restore");
  expect(kinds).toContain("manual");

  // 5. JSON export from the editor menu.
  await page.getByTestId("editor-export").click();
  const downloading = page.waitForEvent("download");
  await page.getByTestId("export-json").click();
  const download = await downloading;
  const file = testInfo.outputPath("export.json");
  await download.saveAs(file);
  const doc = JSON.parse(readFileSync(file, "utf8"));
  expect(doc).toMatchObject({ format: "jdr-map", format_version: 1 });
  expect(doc.name).toBe("Crypte versionnée");

  // 6. Thumbnail of the map in the Maps tab (sent after the confirmed saves).
  await page.goto(`/games/${gameId}?tab=maps`);
  const card = page.locator(`[data-testid="map-card"][data-map-id="${mapId}"]`);
  await expect(card).toHaveCount(1);
  await expect
    .poll(
      async () => {
        await page.reload();
        await expect(card).toHaveCount(1);
        return card.locator(".thumb img").count();
      },
      { timeout: 30_000, intervals: [1000, 2000, 3000] },
    )
    .toBe(1);
  const thumbUrl = await card.locator(".thumb img").getAttribute("src");
  const thumb = await page.request.get(thumbUrl!);
  expect(thumb.ok()).toBeTruthy();
  expect(thumb.headers()["content-type"]).toMatch(/^image\/(png|webp)/);

  // 7. Import the exported file into the same game: a new identical map.
  await page.getByTestId("map-import").click();
  const dialog = page.getByTestId("map-import-dialog");
  await dialog.getByTestId("map-import-file").setInputFiles(file);
  await expect(dialog.getByTestId("map-import-name")).toHaveText(
    "Crypte versionnée",
  );
  await dialog.getByTestId("map-import-submit").click();
  await expect(dialog.getByTestId("map-import-done")).toBeVisible({
    timeout: 20_000,
  });
  await expect(dialog.getByTestId("map-import-missing")).toHaveCount(0);
  await page.getByRole("button", { name: "Fermer" }).first().click();
  await expect(page.getByTestId("map-card")).toHaveCount(2);
  const ids = await page
    .getByTestId("map-card")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-map-id")!));
  const copy = ids.find((id) => id !== mapId)!;
  expect((await blocks(page.request, copy)).blocks).toEqual(before.blocks);

  // The imported map opens in the editor.
  await page
    .locator(`[data-testid="map-card"][data-map-id="${copy}"]`)
    .getByTestId("map-open")
    .click();
  expect(await editorReady(page)).toBe(true);
  expect(errors).toEqual([]);
});
