import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { AdminApi, login } from "../helpers/app";
import { resetRateLimits } from "../helpers/db";
import { main, unique, userPassword } from "../helpers/env";

/**
 * P8 (projet.md 23 P8, D11-D14): procedural generation from the editor. Criteria: same seed, same
 * fingerprint in every browser (golden values of the unit tests); one undo restores the map
 * (and a pre_generate snapshot exists); a generation can be cancelled while it runs; a new map
 * receives the generation and remembers it; a selection is the only thing replaced; a texture is
 * saved to the library (source generated). UI labels live in i18n/_pending until merged, so
 * everything is selected by data-testid. The map is painted through the API (pack tiles + a wall).
 * Without WebGPU / WebGL 2 in the headless browser the scenarios are skipped.
 */

const golden = (generator: string): Record<string, string> =>
  JSON.parse(
    readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        `../../frontend/tests/procgen/golden/${generator}.v1.json`,
      ),
      "utf8",
    ),
  ) as Record<string, string>;

test.beforeAll(() => {
  resetRateLimits(main.dbName);
});

const uid = (): string => randomUUID().replace(/-/g, "").slice(0, 21);

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

interface Gm {
  headers: Record<string, string>;
  gameId: string;
}

/** A GM signed in with a new game (through the API). */
async function gmWithGame(page: Page): Promise<Gm> {
  const name = unique("Cartographe");
  const admin = await AdminApi.open(main.baseURL);
  await admin.send("post", "/admin/users", {
    email: `${name.toLowerCase()}@example.test`,
    username: name,
    role: "user",
    password: userPassword,
  });
  await admin.close();
  await login(page, name, userPassword);
  const me = await page.request.get("/api/v1/auth/me");
  const csrf = (await me.json()).data.csrf as string;
  const headers = { "X-CSRF-Token": csrf, Accept: "application/json" };
  const game = await page.request.post("/api/v1/games", {
    headers,
    data: { name: unique("Campagne ") },
  });
  expect(game.ok(), await game.text()).toBeTruthy();
  return { headers, gameId: String((await game.json()).data.id) };
}

async function createMap(
  page: Page,
  gm: Gm,
  width: number,
  height: number,
): Promise<string> {
  const res = await page.request.post(`/api/v1/games/${gm.gameId}/maps`, {
    headers: gm.headers,
    data: { name: unique("Carte "), width, height },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return String((await res.json()).data.id);
}

async function mapDetail(page: Page, mapId: string) {
  const res = await page.request.get(`/api/v1/maps/${mapId}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data;
}

/** Paints a block of pack ground tiles and one wall (the "hand-made" map). */
async function paintMap(
  page: Page,
  gm: Gm,
  mapId: string,
  rect: { x: number; y: number; w: number; h: number },
): Promise<void> {
  const pack = await page.request.get("/api/v1/procgen/pack");
  const stone = (await pack.json()).data.assets["floor.stone"]
    .asset_id as string;
  const detail = await mapDetail(page, mapId);
  const floor = detail.floors[0].id as string;
  const batches: number[][][] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    const row: number[][] = [];
    for (let x = rect.x; x < rect.x + rect.w; x++) row.push([x, y, 1, 0, 0]);
    batches.push(row); // one op per row: the server limits the cells of an op
  }
  const res = await page.request.post(`/api/v1/maps/${mapId}/ops`, {
    headers: gm.headers,
    data: {
      base_revision: detail.revision,
      client_op_id: uid(),
      ops: [
        { type: "palette.add", index: 1, asset_id: stone },
        ...batches.map((cells) => ({
          type: "tiles.set",
          floor,
          layer: "ground",
          cells,
        })),
        {
          type: "object.add",
          object: {
            uid: uid(),
            floor,
            layer: "walls",
            visibility: "all",
            locked: false,
            sort_order: 0,
            rev: 1,
            type: "wall",
            geometry: {
              points: [
                [rect.x, rect.y],
                [rect.x + rect.w, rect.y],
              ],
              closed: false,
            },
            props: {
              kind: "stone",
              thickness: 0.2,
              blocks_vision: true,
              blocks_light: true,
              blocks_move: true,
              texture_asset: null,
              height: null,
            },
          },
        },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Non-empty cells of a map, "layer:x,y" -> palette index, from the tile blocks. */
async function cellsOf(
  page: Page,
  mapId: string,
): Promise<Map<string, number>> {
  const res = await page.request.get(`/api/v1/maps/${mapId}/chunks`);
  expect(res.ok()).toBeTruthy();
  const bytes = Buffer.from(await res.body());
  const out = new Map<string, number>();
  let o = 0;
  while (o < bytes.length) {
    const cx = bytes.readUInt16LE(o);
    const cy = bytes.readUInt16LE(o + 2);
    const layer = bytes.readUInt8(o + 4);
    const len = bytes.readUInt32LE(o + 5);
    const raw = inflateRawSync(bytes.subarray(o + 9, o + 9 + len));
    for (let i = 0; i < 1024; i++) {
      const index = raw.readUInt16LE(8 + i * 4);
      if (index !== 0) {
        out.set(
          `${layer}:${cx * 32 + (i % 32)},${cy * 32 + Math.floor(i / 32)}`,
          index,
        );
      }
    }
    o += 9 + len;
  }
  return out;
}

/** Objects of a map reduced to what an undo must restore. */
async function objectsOf(page: Page, mapId: string): Promise<string[]> {
  const detail = await mapDetail(page, mapId);
  return (detail.objects as Record<string, unknown>[])
    .map((o) =>
      JSON.stringify([o["uid"], o["type"], o["geometry"], o["props"]]),
    )
    .sort();
}

async function expectSaved(page: Page, timeout = 20_000): Promise<void> {
  await expect(page.getByTestId("save-status")).toHaveAttribute(
    "data-state",
    "saved",
    { timeout },
  );
}

/** Opens the editor of a map; false when the browser has neither WebGPU nor WebGL 2. */
async function openEditor(page: Page, gm: Gm, mapId: string): Promise<boolean> {
  await page.goto(`/games/${gm.gameId}/maps/${mapId}/edit`);
  return editorReady(page);
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

async function openPanel(page: Page): Promise<void> {
  await page.getByTestId("editor-generate").click();
  await expect(page.getByTestId("generate-panel")).toBeVisible();
}

const preview = (page: Page) => page.getByTestId("gen-preview");
const fingerprint = (page: Page) => page.getByTestId("gen-fingerprint");

async function modKey(page: Page): Promise<string> {
  return page.evaluate(() => {
    const nav = navigator as Navigator & {
      userAgentData?: { platform?: string };
    };
    const s = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent;
    return /mac|iphone|ipad|ipod/i.test(s) ? "Meta" : "Control";
  });
}

async function drag(
  page: Page,
  from: [number, number],
  to: [number, number],
): Promise<void> {
  const box = (await page.getByTestId("editor-viewport").boundingBox())!;
  await page.mouse.move(
    box.x + box.width * from[0],
    box.y + box.height * from[1],
  );
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], {
    steps: 10,
  });
  await page.mouse.up();
}

test.describe("P8 generation", () => {
  test("same seed, same fingerprint (golden values), whatever the browser", async ({
    page,
    browserName,
  }) => {
    const errors = watchErrors(page);
    const gm = await gmWithGame(page);
    const sizes = { dungeon: 60, cave: 60, outdoor: 80, village: 70 } as const;
    for (const [generator, size] of Object.entries(sizes)) {
      const mapId = await createMap(page, gm, size, size);
      const ready = await openEditor(page, gm, mapId);
      test.skip(
        !ready,
        `${browserName}: neither WebGPU nor WebGL 2 in this headless browser`,
      );
      await openPanel(page);
      await page.getByTestId("gen-generator").selectOption(generator);
      await expect(page.getByTestId("gen-target-map")).toBeChecked();
      const gold = golden(generator);
      for (const seed of ["or-01", "or-02"]) {
        await page.getByTestId("gen-seed").fill(seed);
        await expect(preview(page)).toHaveAttribute("data-state", "ready", {
          timeout: 30_000,
        });
        await expect(fingerprint(page)).toHaveAttribute(
          "data-fingerprint",
          gold[seed]!,
        );
      }
    }
    expect(errors).toEqual([]);
  });

  test("a generation is undone in one step and leaves a pre_generate snapshot", async ({
    page,
    browserName,
  }) => {
    const errors = watchErrors(page);
    const gm = await gmWithGame(page);
    const mapId = await createMap(page, gm, 60, 60);
    await paintMap(page, gm, mapId, { x: 5, y: 5, w: 6, h: 6 });
    const before = await cellsOf(page, mapId);
    const objectsBefore = await objectsOf(page, mapId);
    expect(before.size).toBe(36);
    const ready = await openEditor(page, gm, mapId);
    test.skip(
      !ready,
      `${browserName}: neither WebGPU nor WebGL 2 in this headless browser`,
    );

    await openPanel(page);
    await page.getByTestId("gen-seed").fill("or-01");
    await expect(preview(page)).toHaveAttribute("data-state", "ready", {
      timeout: 30_000,
    });
    await page.getByTestId("gen-apply").click();
    await page.getByTestId("gen-confirm").click(); // content to replace: confirmation
    await expect
      .poll(async () => (await cellsOf(page, mapId)).size, { timeout: 20_000 })
      .not.toBe(36);
    await expectSaved(page);
    expect((await objectsOf(page, mapId)).length).toBeGreaterThan(1);

    const detail = await mapDetail(page, mapId);
    expect(detail.generation).toMatchObject({
      generator: "dungeon",
      seed: "or-01",
    });
    const versions = await (
      await page.request.get(`/api/v1/maps/${mapId}/versions`)
    ).json();
    expect(
      versions.data.filter((v: { kind: string }) => v.kind === "pre_generate"),
    ).toHaveLength(1);
    await page.getByTestId("editor-history").click();
    await expect(
      page
        .getByTestId("history-version")
        .and(page.locator('[data-kind="pre_generate"]')),
    ).toHaveCount(1);

    // One Ctrl/Cmd+Z restores tiles and objects; nothing else is left to undo.
    await page.getByTestId("editor-viewport").focus();
    await page.keyboard.press(`${await modKey(page)}+z`);
    await expect(page.getByTestId("editor-undo")).toBeDisabled();
    await expectSaved(page);
    await expect
      .poll(
        async () =>
          [...(await cellsOf(page, mapId)).entries()].sort().join("|"),
        {
          timeout: 20_000,
        },
      )
      .toBe([...before.entries()].sort().join("|"));
    expect(await objectsOf(page, mapId)).toEqual(objectsBefore);
    expect(errors).toEqual([]);
  });

  test("a generation in progress can be cancelled: nothing is applied", async ({
    page,
    browserName,
  }) => {
    const errors = watchErrors(page);
    const gm = await gmWithGame(page);
    const mapId = await createMap(page, gm, 400, 400);
    const ready = await openEditor(page, gm, mapId);
    test.skip(
      !ready,
      `${browserName}: neither WebGPU nor WebGL 2 in this headless browser`,
    );

    await openPanel(page);
    await page.getByTestId("gen-param-rooms").fill("200");
    await page.getByTestId("gen-apply").click(); // empty map: no confirmation, the run starts
    const progress = page.getByTestId("gen-progress");
    await expect(progress).toBeVisible();
    test.skip(
      (await page.getByTestId("gen-cancel-unavailable").count()) > 0,
      `${browserName}: no worker, a generation cannot be cancelled`,
    );
    await page.getByTestId("gen-cancel").click();
    await expect(progress).toBeHidden();
    await expect(page.getByTestId("gen-apply")).toBeEnabled();
    await expect(page.getByTestId("gen-error")).toHaveCount(0);
    // Nothing applied: no tile, no object, no history entry, no snapshot, no stored generation.
    await expect(page.getByTestId("editor-undo")).toBeDisabled();
    expect((await cellsOf(page, mapId)).size).toBe(0);
    expect(await objectsOf(page, mapId)).toEqual([]);
    expect((await mapDetail(page, mapId)).generation ?? null).toBeNull();
    expect(errors).toEqual([]);
  });

  test("a new map receives the generation and remembers its settings", async ({
    page,
    browserName,
  }) => {
    const errors = watchErrors(page);
    const gm = await gmWithGame(page);
    const mapId = await createMap(page, gm, 40, 40);
    const ready = await openEditor(page, gm, mapId);
    test.skip(
      !ready,
      `${browserName}: neither WebGPU nor WebGL 2 in this headless browser`,
    );

    await openPanel(page);
    await page.getByTestId("gen-generator").selectOption("cave");
    await page.getByTestId("gen-seed").fill("grotte-42");
    await page.getByTestId("gen-target-new").check();
    await page.getByTestId("gen-new-name").fill("Grotte générée");
    await expect(preview(page)).toHaveAttribute("data-state", "ready", {
      timeout: 30_000,
    });
    await page.getByTestId("gen-apply").click();

    await expect(page).toHaveURL(
      new RegExp(`/games/${gm.gameId}/maps/(?!${mapId}/)\\d+/edit$`),
    );
    const newId = new URL(page.url()).pathname.split("/")[4]!;
    expect(newId).not.toBe(mapId);
    expect(await editorReady(page)).toBe(true);
    await expect
      .poll(async () => (await cellsOf(page, newId)).size, { timeout: 20_000 })
      .toBeGreaterThan(0);
    await expectSaved(page);
    await expect
      .poll(
        async () => (await mapDetail(page, newId)).generation?.seed ?? null,
        { timeout: 20_000 },
      )
      .toBe("grotte-42");
    expect((await mapDetail(page, newId)).generation).toMatchObject({
      generator: "cave",
    });

    await openPanel(page); // pre-filled from maps.generation
    await expect(page.getByTestId("gen-generator")).toHaveValue("cave");
    await expect(page.getByTestId("gen-seed")).toHaveValue("grotte-42");
    expect(errors).toEqual([]);
  });

  test("a generation in a selection replaces only the selected rectangle", async ({
    page,
    browserName,
  }) => {
    const errors = watchErrors(page);
    const gm = await gmWithGame(page);
    const mapId = await createMap(page, gm, 80, 80);
    await paintMap(page, gm, mapId, { x: 2, y: 2, w: 76, h: 76 });
    const before = await cellsOf(page, mapId);
    const ready = await openEditor(page, gm, mapId);
    test.skip(
      !ready,
      `${browserName}: neither WebGPU nor WebGL 2 in this headless browser`,
    );

    await page.getByTestId("editor-viewport").focus();
    await page.keyboard.press("v");
    await drag(page, [0.35, 0.35], [0.65, 0.65]);
    await page.keyboard.press("Shift+G"); // opens the panel
    await expect(page.getByTestId("generate-panel")).toBeVisible();
    await page.getByTestId("gen-seed").fill("zone-7");
    await page.getByTestId("gen-target-selection").check();
    const size = page.getByTestId("gen-size");
    await expect(size).toHaveAttribute("data-selection", /^\d+,\d+,\d+,\d+$/);
    const [rx, ry, rw, rh] = (await size.getAttribute("data-selection"))!
      .split(",")
      .map(Number) as [number, number, number, number];
    expect(rw).toBeGreaterThanOrEqual(8);
    await expect(preview(page)).toHaveAttribute("data-state", "ready", {
      timeout: 30_000,
    });
    await page.getByTestId("gen-apply").click();
    await page.getByTestId("gen-confirm").click();
    await expect
      .poll(
        async () =>
          [...(await cellsOf(page, mapId)).entries()].sort().join("|"),
        {
          timeout: 20_000,
        },
      )
      .not.toBe([...before.entries()].sort().join("|"));
    await expectSaved(page);

    const after = await cellsOf(page, mapId);
    let changedInside = 0;
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const [, xy] = key.split(":") as [string, string];
      const [x, y] = xy.split(",").map(Number) as [number, number];
      const inside = x >= rx && x < rx + rw && y >= ry && y < ry + rh;
      if (inside) {
        if (before.get(key) !== after.get(key)) changedInside++;
      } else {
        expect(after.get(key), `cell ${key} outside the selection`).toBe(
          before.get(key),
        );
      }
    }
    expect(changedInside).toBeGreaterThan(0);
    // A selection is a touch-up: the generation of the map is not stored.
    expect((await mapDetail(page, mapId)).generation ?? null).toBeNull();
    expect(errors).toEqual([]);
  });

  test("a texture is saved to the library with the source generated", async ({
    page,
    browserName,
  }) => {
    const errors = watchErrors(page);
    const gm = await gmWithGame(page);
    const mapId = await createMap(page, gm, 30, 30);
    const ready = await openEditor(page, gm, mapId);
    test.skip(
      !ready,
      `${browserName}: neither WebGPU nor WebGL 2 in this headless browser`,
    );

    await openPanel(page);
    await page.getByTestId("generate-tab-textures").click();
    await page.getByTestId("texture-material").selectOption("wood");
    await page.getByTestId("texture-size").selectOption("128");
    await page.getByTestId("texture-seed").fill("planches-1");
    await expect(page.getByTestId("texture-canvas")).toBeVisible();
    await page.getByTestId("texture-save").click();
    await expect(page.getByTestId("texture-saved")).toBeVisible({
      timeout: 20_000,
    });

    const res = await page.request.get("/api/v1/assets?kind=texture");
    expect(res.ok()).toBeTruthy();
    const assets = (await res.json()).data as {
      name: string;
      source: string;
      kind: string;
    }[];
    const saved = assets.find((a) => a.name.includes("planches-1"));
    expect(saved).toBeDefined();
    expect(saved).toMatchObject({ source: "generated", kind: "texture" });
    expect(errors).toEqual([]);
  });
});
