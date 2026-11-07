import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AdminApi, login } from "../helpers/app";
import { resetRateLimits } from "../helpers/db";
import { main, unique, userPassword } from "../helpers/env";

/**
 * P14 images on the map: a new map made from an image (background, locked), a wall drawn over it,
 * the player view gets the background (signed URL in its snapshot); a library object placed with
 * the image tool, moved, the move undone. Controls are found through data-testid (the texts are
 * still in i18n/_pending). Without WebGPU / WebGL 2 the scenario is skipped.
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

async function createUser(prefix: string): Promise<string> {
  const name = unique(prefix);
  const api = await AdminApi.open(main.baseURL);
  await api.send("post", "/admin/users", {
    email: `${name.toLowerCase()}@example.test`,
    username: name,
    role: "user",
    password: userPassword,
  });
  await api.close();
  return name;
}

async function csrf(
  request: APIRequestContext,
): Promise<Record<string, string>> {
  const res = await request.get("/api/v1/auth/me");
  expect(res.ok()).toBeTruthy();
  const data = (await res.json()).data;
  return { "X-CSRF-Token": data.csrf as string, Accept: "application/json" };
}

interface MapObjectLike {
  uid: string;
  type: string;
  geometry: Record<string, number>;
  props: Record<string, unknown>;
  locked: boolean;
}

async function mapObjects(
  request: APIRequestContext,
  mapId: string,
): Promise<MapObjectLike[]> {
  const res = await request.get(`/api/v1/maps/${mapId}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data.objects as MapObjectLike[];
}

/** Waits for the editor engine; false when the browser has no GPU API. */
async function editorReady(page: Page): Promise<boolean> {
  const viewport = page.getByTestId("editor-viewport");
  await expect(viewport).toHaveAttribute(
    "data-state",
    /^(ready|unsupported|error)$/,
    { timeout: 30_000 },
  );
  const state = await viewport.getAttribute("data-state");
  if (state === "unsupported") return false;
  expect(state).toBe("ready");
  await expect(page.getByTestId("save-status")).toHaveAttribute(
    "data-state",
    "saved",
    { timeout: 15_000 },
  );
  return true;
}

async function historyCount(page: Page): Promise<string | null> {
  return page.getByTestId("status-history").getAttribute("data-count");
}

test("new map from an image: background, a wall over it, the player view gets the background", async ({
  page,
  browser,
  browserName,
}) => {
  const errors = watchErrors(page);
  const gmName = await createUser("Peintre");
  const playerName = await createUser("Joueur");
  await login(page, gmName, userPassword);
  const headers = await csrf(page.request);
  const game = await page.request.post("/api/v1/games", {
    headers,
    data: { name: unique("Fonds ") },
  });
  expect(game.ok(), await game.text()).toBeTruthy();
  const gameId = (await game.json()).data.id as string;
  const member = await page.request.post(`/api/v1/games/${gameId}/members`, {
    headers,
    data: { identifier: playerName, role: "player" },
  });
  expect(member.ok(), await member.text()).toBeTruthy();
  // Without fog_strict the player sees the whole map (no token needed for this check).
  const settings = await page.request.patch(`/api/v1/games/${gameId}`, {
    headers,
    data: { settings: { fog_strict: false } },
  });
  expect(settings.ok(), await settings.text()).toBeTruthy();

  // Maps tab, new map, "from an image": upload, 8 px per cell (fixture 64 x 48 px => 8 x 6 cells).
  await page.goto(`/games/${gameId}?tab=maps`);
  await page.getByTestId("map-new").click();
  const form = page.getByTestId("map-create-form");
  await expect(form).toBeVisible();
  await page
    .getByTestId("map-from-image-upload")
    .setInputFiles(path.join(fixtures, "valid_png_opaque.png"));
  await expect(page.getByTestId("map-from-image-name")).toBeVisible({
    timeout: 20_000,
  });
  await form.locator('input[name="image_cell_px"]').fill("8");
  await expect(form.locator('input[name="width"]')).toHaveValue("8");
  await expect(form.locator('input[name="height"]')).toHaveValue("6");
  await form.locator('input[name="name"]').fill(unique("Battlemap "));
  await page.getByTestId("map-create").click();
  await expect(page).toHaveURL(new RegExp(`/games/${gameId}/maps/\\d+/edit$`));
  const mapId = new URL(page.url()).pathname.split("/").at(-2) as string;

  const [background] = (await mapObjects(page.request, mapId)).filter(
    (o) => o.type === "image",
  );
  expect(background).toMatchObject({
    locked: true,
    geometry: { x: 0, y: 0, w: 8, h: 6, rotation: 0 },
    props: { placement: "background" },
  });
  const ready = await editorReady(page);
  test.skip(
    !ready,
    `${browserName}: neither WebGPU nor WebGL 2 in this headless browser`,
  );

  // A wall over the background (wall tool, two clicks, Enter).
  await page.getByTestId("tool-wall").click();
  const box = (await page.getByTestId("editor-viewport").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx - 60, cy);
  await page.mouse.click(cx + 60, cy);
  await page.keyboard.press("Enter");
  await expect.poll(() => historyCount(page)).toBe("1");
  await expect(page.getByTestId("save-status")).toHaveAttribute(
    "data-state",
    "saved",
    { timeout: 15_000 },
  );
  await expect
    .poll(async () =>
      (await mapObjects(page.request, mapId)).map((o) => o.type).sort(),
    )
    .toEqual(["image", "wall"]);

  // The player view: the background and its signed URL are in the player's snapshot.
  const session = await page.request.post(`/api/v1/games/${gameId}/sessions`, {
    headers,
    data: { name: "Séance", map_id: mapId },
  });
  expect(session.ok(), await session.text()).toBeTruthy();
  const { id: sessionId, code } = (await session.json()).data as {
    id: string;
    code: string;
  };
  const context = await browser.newContext({
    baseURL: main.baseURL,
    locale: "fr-FR",
  });
  const guest = await context.newPage();
  try {
    await login(guest, playerName, userPassword);
    await guest.goto("/join");
    await guest.getByTestId("join-code").fill(code);
    await guest.getByTestId("join-submit").click();
    await expect(guest).toHaveURL(new RegExp(`/sessions/${sessionId}$`));
    const start = await page.request.post(
      `/api/v1/sessions/${sessionId}/start`,
      { headers, data: {} },
    );
    expect(start.ok(), await start.text()).toBeTruthy();
    await expect(guest.getByTestId("play-view")).toBeVisible({
      timeout: 20_000,
    });
    await expect(guest.getByTestId("play-viewport")).toHaveAttribute(
      "data-scene",
      "ready",
      { timeout: 20_000 },
    );
    const snap = (
      await (
        await guest.request.get(`/api/v1/sessions/${sessionId}/snapshot`)
      ).json()
    ).data;
    expect(snap.map.objects.map((o: MapObjectLike) => o.type).sort()).toEqual([
      "image",
      "wall",
    ]);
    expect(snap.map.images).toHaveLength(1);
    expect(snap.map.images[0]).toMatchObject({
      asset_id: background!.props["asset_id"],
      name: "",
    });
    expect(String(snap.map.images[0].url)).toMatch(/\/files\/[0-9a-f-]+\?/);
    const file = await guest.request.get(String(snap.map.images[0].url));
    expect(file.ok()).toBeTruthy();
  } finally {
    await context.close();
  }
  expect(errors).toEqual([]);
});

test("an object image placed with the image tool, moved, the move undone", async ({
  page,
  browserName,
}) => {
  const errors = watchErrors(page);
  const gmName = await createUser("Decorateur");
  await login(page, gmName, userPassword);
  const headers = await csrf(page.request);
  // An object image in the GM's library (through the library page, like a GM would).
  await page.goto("/library");
  await page
    .locator("section.upload")
    .getByLabel("Type")
    .selectOption("object");
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.join(fixtures, "valid_png_transparent.png"));
  await expect(page.locator("ul.queue li.item-done")).toHaveCount(1, {
    timeout: 20_000,
  });
  const game = await page.request.post("/api/v1/games", {
    headers,
    data: { name: unique("Objets ") },
  });
  const gameId = (await game.json()).data.id as string;
  const created = await page.request.post(`/api/v1/games/${gameId}/maps`, {
    headers,
    data: { name: "Salle", width: 20, height: 14 },
  });
  const mapId = (await created.json()).data.id as string;
  await page.goto(`/games/${gameId}/maps/${mapId}/edit`);
  const ready = await editorReady(page);
  test.skip(
    !ready,
    `${browserName}: neither WebGPU nor WebGL 2 in this headless browser`,
  );

  await page.getByTestId("tool-image").click();
  await expect(page.getByTestId("tool-image")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("image-choose").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("button.tile").first()).toBeVisible({
    timeout: 10_000,
  });
  await dialog.locator("button.tile").first().click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("image-current")).toBeVisible();

  const box = (await page.getByTestId("editor-viewport").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => historyCount(page)).toBe("1");
  await expect(page.getByTestId("properties-image")).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveAttribute(
    "data-state",
    "saved",
    { timeout: 15_000 },
  );
  const placed = (await mapObjects(page.request, mapId)).find(
    (o) => o.type === "image",
  );
  expect(placed).toBeDefined();

  // Drag it (from its centre) by about two cells, then undo the move.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 150, cy + 80, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => historyCount(page)).toBe("2");
  await expect(page.getByTestId("save-status")).toHaveAttribute(
    "data-state",
    "saved",
    { timeout: 15_000 },
  );
  const moved = (await mapObjects(page.request, mapId)).find(
    (o) => o.uid === placed!.uid,
  )!;
  expect(moved.geometry["x"]).toBeGreaterThan(placed!.geometry["x"]!);
  await page.getByTestId("editor-viewport").focus();
  // Same platform detection as the page (src/editor/shortcuts.ts): Cmd on Apple, Ctrl elsewhere.
  const mod = await page.evaluate(() => {
    const nav = navigator as Navigator & {
      userAgentData?: { platform?: string };
    };
    const s = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent;
    return /mac|iphone|ipad|ipod/i.test(s) ? "Meta" : "Control";
  });
  await page.keyboard.press(`${mod}+z`);
  await expect.poll(() => historyCount(page)).toBe("1");
  await expect(page.getByTestId("save-status")).toHaveAttribute(
    "data-state",
    "saved",
    { timeout: 15_000 },
  );
  await expect
    .poll(
      async () =>
        (await mapObjects(page.request, mapId)).find(
          (o) => o.uid === placed!.uid,
        )?.geometry,
    )
    .toEqual(placed!.geometry);
  expect(errors).toEqual([]);
});

test("background set from the size of the map wanted: the map is resized to the image proportions", async ({
  page,
  browserName,
}) => {
  const errors = watchErrors(page);
  const gmName = await createUser("Arpenteur");
  await login(page, gmName, userPassword);
  const headers = await csrf(page.request);
  const game = await page.request.post("/api/v1/games", {
    headers,
    data: { name: unique("Taille ") },
  });
  const gameId = (await game.json()).data.id as string;
  const created = await page.request.post(`/api/v1/games/${gameId}/maps`, {
    headers,
    data: { name: "Plaine", width: 10, height: 10 },
  });
  const mapId = (await created.json()).data.id as string;
  await page.goto(`/games/${gameId}/maps/${mapId}/edit`);
  const ready = await editorReady(page);
  test.skip(
    !ready,
    `${browserName}: neither WebGPU nor WebGL 2 in this headless browser`,
  );

  // Image tool, "Image de fond…", upload the 64 x 48 px fixture, mode "map size": 40 cells wide (4x the map, beyond what one object op allows).
  await page.getByTestId("tool-image").click();
  await page.getByTestId("image-background").click();
  const dialog = page.getByTestId("background-dialog");
  await expect(dialog).toBeVisible();
  await page
    .getByTestId("background-upload")
    .setInputFiles(path.join(fixtures, "valid_png_opaque.png"));
  await expect(page.getByTestId("background-asset")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId("background-mode-map").check();
  await page.getByTestId("background-map-axis").selectOption("width");
  await page.getByTestId("background-map-cells").fill("40");
  const result = page.getByTestId("background-map-result");
  await expect(result).toHaveAttribute("data-width", "40");
  await expect(result).toHaveAttribute("data-height", "30");
  await page.getByTestId("background-apply").click();

  // Saved, resized (the editor reloads): 40 x 30 cells, the image covering the whole map.
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/v1/maps/${mapId}`);
        const grid = (await res.json()).data.grid as Record<string, number>;
        return [grid["width"], grid["height"]];
      },
      { timeout: 20_000 },
    )
    .toEqual([40, 30]);
  const [background] = (await mapObjects(page.request, mapId)).filter(
    (o) => o.type === "image",
  );
  expect(background).toMatchObject({
    locked: true,
    geometry: { x: 0, y: 0, w: 40, h: 30, rotation: 0 },
    props: { placement: "background" },
  });
  expect(await editorReady(page)).toBe(true);
  expect(errors).toEqual([]);
});
