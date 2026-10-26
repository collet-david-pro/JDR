import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { inflateSync, inflateRawSync } from "node:zlib";
import { AdminApi, login } from "../helpers/app";
import { resetRateLimits } from "../helpers/db";
import { main, unique, userPassword } from "../helpers/env";

/**
 * P5 (projet.md 2.5, 14.2, 23 P5): a room of walls with a door, a light and a placed token;
 * a wall stops the light (dark pixel behind it, bright in front); opening the door (double
 * click) updates the vision in < 100 ms (engine stats.visionMs); "see as the player"; fog
 * revealed with the F tool is the same after a reload; everything saves without error.
 * Controls are found through data-testid (editor texts are in i18n/_pending until merged).
 * Without WebGPU / WebGL 2 the scenario is skipped.
 */

test.beforeAll(() => {
  resetRateLimits(main.dbName);
});

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource|NetworkError|net::ERR/i.test(msg.text())) {
      errors.push(msg.text());
    }
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

// ---- Minimal PNG decoder (8-bit RGB / RGBA, non-interlaced: what screenshots are) ----------

interface Image {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly data: Buffer;
}

function decodePng(png: Buffer): Image {
  let o = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (o < png.length) {
    const len = png.readUInt32BE(o);
    const type = png.toString("ascii", o + 4, o + 8);
    const body = png.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0) throw new Error("unsupported PNG");
      colorType = body[9]!;
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (channels === 0) throw new Error(`unsupported PNG colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[y * stride + x - channels]! : 0;
      const b = y > 0 ? data[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y > 0 ? data[(y - 1) * stride + x - channels]! : 0;
      let v = line[x]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      data[y * stride + x] = v & 255;
    }
  }
  return { width, height, channels, data };
}

/** Mean luminance (0-255) of a 5×5 square around (x, y) of the image (sample cell centres:
 * grid lines are drawn on integer coordinates). */
function brightness(img: Image, x: number, y: number): number {
  let sum = 0;
  let n = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const px = Math.round(x) + dx;
      const py = Math.round(y) + dy;
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
      const i = (py * img.width + px) * img.channels;
      sum += 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
      n++;
    }
  }
  return sum / n;
}

// ---- Editor helpers --------------------------------------------------------------------------

async function csrfOf(request: APIRequestContext): Promise<string> {
  const me = await request.get("/api/v1/auth/me");
  expect(me.ok()).toBeTruthy();
  return (await me.json()).data.csrf as string;
}

/** A GM with a game holding one PC token; ends on the game page. */
async function gmWithGameAndToken(page: Page): Promise<{ gameId: string; tokenId: string }> {
  const gm = unique("Eclaireur");
  const api = await AdminApi.open(main.baseURL);
  await api.send("post", "/admin/users", {
    email: `${gm.toLowerCase()}@example.test`,
    username: gm,
    role: "user",
    password: userPassword,
  });
  await api.close();
  await login(page, gm, userPassword);
  await page.goto("/");
  await page.getByRole("button", { name: "Nouvelle partie" }).click();
  await page.locator('input[name="name"]').fill(unique("Donjon "));
  await page.getByRole("button", { name: "Créer la partie" }).click();
  await expect(page).toHaveURL(/\/games\/\d+$/);
  const gameId = new URL(page.url()).pathname.split("/").pop() as string;
  const res = await page.request.post(`/api/v1/games/${gameId}/tokens`, {
    headers: { "X-CSRF-Token": await csrfOf(page.request), Accept: "application/json" },
    data: {
      name: "Aria",
      asset_id: null,
      kind: "pc",
      size_w: 1,
      size_h: 1,
      default_owner_user_id: null,
      vision: { enabled: true, range: 12, dark: 0 },
      light: null,
      ring_color: null,
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const tokenId = (await res.json()).data.id as string;
  return { gameId, tokenId };
}

async function expectSaved(page: Page, timeout = 15_000): Promise<void> {
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved", { timeout });
}

async function editorReady(page: Page): Promise<boolean> {
  const viewport = page.getByTestId("editor-viewport");
  await expect(viewport).toHaveAttribute("data-state", /^(ready|unsupported|error)$/, {
    timeout: 30_000,
  });
  if ((await viewport.getAttribute("data-state")) === "unsupported") return false;
  await expect(viewport).toHaveAttribute("data-state", "ready");
  await expectSaved(page);
  return true;
}

/** Screen ⇄ cell mapping, measured from the pointer position shown by the status bar. */
interface Mapping {
  toScreen(x: number, y: number): [number, number];
}

async function worldAt(page: Page, sx: number, sy: number): Promise<[number, number]> {
  await page.mouse.move(sx, sy);
  const cell = page.getByTestId("status-cell");
  await expect(cell).not.toHaveAttribute("data-wx", "");
  await page.waitForTimeout(50);
  return [Number(await cell.getAttribute("data-wx")), Number(await cell.getAttribute("data-wy"))];
}

async function calibrate(page: Page): Promise<Mapping> {
  const box = (await page.getByTestId("editor-viewport").boundingBox())!;
  const sx = box.x + box.width / 2;
  const sy = box.y + box.height / 2;
  const a = await worldAt(page, sx, sy);
  const b = await worldAt(page, sx + 100, sy + 80);
  const kx = 100 / (b[0] - a[0]);
  const ky = 80 / (b[1] - a[1]);
  return { toScreen: (x, y) => [sx + (x - a[0]) * kx, sy + (y - a[1]) * ky] };
}

async function clickCell(page: Page, m: Mapping, x: number, y: number): Promise<void> {
  const [px, py] = m.toScreen(x, y);
  await page.mouse.click(px, py);
}

async function dragCells(page: Page, m: Mapping, from: [number, number], to: [number, number]) {
  const [ax, ay] = m.toScreen(...from);
  const [bx, by] = m.toScreen(...to);
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(bx, by, { steps: 10 });
  await page.mouse.up();
}

/** Screenshot of the map (pointer moved away), with a cell → image pixel sampler. */
async function shot(page: Page, m: Mapping): Promise<(x: number, y: number) => number> {
  const viewport = page.getByTestId("editor-viewport");
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(box.x - 40 > 0 ? box.x - 40 : 2, 2);
  await page.waitForTimeout(400);
  const img = decodePng(await viewport.screenshot());
  const sx = img.width / box.width;
  const sy = img.height / box.height;
  return (x, y) => {
    const [px, py] = m.toScreen(x, y);
    return brightness(img, (px - box.x) * sx, (py - box.y) * sy);
  };
}

/** Explored fog bits of a floor, decoded: "cx:cy" → raw bitmap (hex). */
async function fogOf(request: APIRequestContext, mapId: string, floor: string) {
  const res = await request.get(`/api/v1/maps/${mapId}/fog`, { params: { floor } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const out: Record<string, Buffer> = {};
  for (const [cx, cy, data] of (await res.json()).data.chunks as [number, number, string][]) {
    out[`${cx}:${cy}`] = inflateRawSync(Buffer.from(data, "base64"));
  }
  return out;
}

/** Fog bit of the centre of a cell (4×4 sub-cells per cell, MSB first, 128 bits a row). */
function fogBit(fog: Record<string, Buffer>, x: number, y: number): boolean {
  const bits = fog[`${Math.floor(x / 32)}:${Math.floor(y / 32)}`];
  if (bits === undefined) return false;
  const sx = (x % 32) * 4 + 2;
  const sy = (y % 32) * 4 + 2;
  const i = sy * 128 + sx;
  return (bits[i >> 3]! & (0x80 >> (i & 7))) !== 0;
}

test("P5: walls stop the light, door opens fast, player view, fog kept after reload", async ({
  page,
  browserName,
}) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const { gameId, tokenId } = await gmWithGameAndToken(page);

  // New 20×14 map ⇒ editor.
  await page.getByTestId("map-new").click();
  const form = page.getByTestId("map-create-form");
  await form.locator('input[name="name"]').fill("Salle éclairée");
  await form.locator('input[name="width"]').fill("20");
  await form.locator('input[name="height"]').fill("14");
  await page.getByTestId("map-create").click();
  await expect(page).toHaveURL(new RegExp(`/games/${gameId}/maps/\\d+/edit$`));
  const mapId = new URL(page.url()).pathname.split("/")[4] as string;
  test.skip(!(await editorReady(page)), `${browserName}: neither WebGPU nor WebGL 2`);
  const floor = ((await (await page.request.get(`/api/v1/maps/${mapId}`)).json()).data.floors[0]
    .id) as string;
  const m = await calibrate(page);

  // Night: full darkness (lighting is what makes the difference).
  await page.getByTestId("ambient-darkness").fill("1");
  // 1. A room of walls (2,2)–(12,10), a door on the bottom wall, a torch, a token.
  await page.getByTestId("tool-wall").click();
  await page.getByTestId("wall-room").check();
  await dragCells(page, m, [2, 2], [12, 10]);
  await page.getByTestId("tool-door").click();
  await clickCell(page, m, 7, 10);
  await page.getByTestId("tool-light").click();
  await clickCell(page, m, 5, 6);
  await page.getByTestId(`token-def-${tokenId}`).click();
  await expect(page.getByTestId("tool-token")).toHaveAttribute("aria-pressed", "true");
  await clickCell(page, m, 9.4, 6.4);
  await expect(page.getByTestId("status-history")).toHaveAttribute("data-count", "5");
  await expectSaved(page);
  const saved = (await (await page.request.get(`/api/v1/maps/${mapId}`)).json()).data;
  expect(saved.objects.map((o: { type: string }) => o.type).sort()).toEqual([
    "door",
    "light",
    "wall",
  ]);
  expect(saved.tokens_placed).toHaveLength(1);
  expect(saved.tokens_placed[0]).toMatchObject({ token_id: tokenId, x: 9.5, y: 6.5 });

  // 2. A wall stops the light: bright inside near the torch, dark behind the bottom wall.
  await page.getByTestId("view-fog").uncheck();
  let sample = await shot(page, m);
  const inside = sample(5.5, 8.5);
  const behind = sample(5.5, 11.5);
  const belowDoor = sample(7.3, 11.5);
  expect(inside, `inside ${inside} vs behind ${behind}`).toBeGreaterThan(behind + 25);

  // 3. Opening the door (double click with the selection tool): the light goes through it,
  // and the vision update takes less than 100 ms (engine statistics).
  await page.getByTestId("tool-select").click();
  const vision = page.getByTestId("status-vision");
  const samplesBefore = Number((await vision.getAttribute("data-samples")) ?? 0);
  const [dx, dy] = m.toScreen(7, 10);
  await page.mouse.dblclick(dx, dy);
  await expect
    .poll(async () => Number(await vision.getAttribute("data-samples")), { timeout: 5_000 })
    .toBeGreaterThan(samplesBefore);
  const visionMs = Number(await vision.getAttribute("data-ms"));
  console.log(`[${browserName}] door opened ⇒ vision updated in ${visionMs} ms`);
  expect(visionMs).toBeLessThan(100);
  await expectSaved(page);
  const door = (await (await page.request.get(`/api/v1/maps/${mapId}`)).json()).data.objects.find(
    (o: { type: string }) => o.type === "door",
  );
  expect(door.props.state).toBe("open");
  sample = await shot(page, m);
  expect(sample(7.3, 11.5), `below the open door ${sample(7.3, 11.5)} vs ${belowDoor}`).toBeGreaterThan(
    belowDoor + 15,
  );

  // 4. "See as the player" (every PC): unexplored areas are black, the lit room is seen.
  await page.getByTestId("view-fog").check();
  await page.getByTestId("view-mode").selectOption("all_pcs");
  sample = await shot(page, m);
  expect(sample(16.5, 4.5)).toBeLessThan(12);
  expect(sample(5.5, 8.5)).toBeGreaterThan(sample(16.5, 4.5) + 25);
  await page.getByTestId("view-mode").selectOption("gm");

  // 5. Reveal fog with the F tool (rectangle outside the room), saved on the server.
  await page.getByTestId("tool-fog").click();
  await page.getByTestId("fog-shape-rect").check();
  await dragCells(page, m, [14, 2], [18.9, 6.9]);
  await expectSaved(page);
  const fog = await fogOf(page.request, mapId, floor);
  expect(fogBit(fog, 16, 4)).toBe(true);
  expect(fogBit(fog, 16, 12)).toBe(false);

  // 6. Reload: same fog on the server, and shown (player view, lighting off: explored areas
  // dimmed, unexplored black).
  await page.reload();
  expect(await editorReady(page)).toBe(true);
  expect(await fogOf(page.request, mapId, floor)).toEqual(fog);
  const m2 = await calibrate(page);
  await page.getByTestId("view-lighting").uncheck();
  await page.getByTestId("view-mode").selectOption("all_pcs");
  sample = await shot(page, m2);
  expect(sample(16.5, 4.5), `explored ${sample(16.5, 4.5)} vs unexplored ${sample(16.5, 12.5)}`).toBeGreaterThan(
    sample(16.5, 12.5) + 15,
  );
  await expectSaved(page);
  expect(errors).toEqual([]);
});
