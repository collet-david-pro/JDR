import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { AdminApi, login } from "../helpers/app";
import { resetRateLimits } from "../helpers/db";
import { main, unique, userPassword } from "../helpers/env";

/**
 * PNG export (projet.md 17, 23 P4): ×1 / ×2 / ×4 at the announced size, 8 000 × 8 000 px without
 * crash (time and memory measured), and the exported pixels match the editor preview.
 *
 * Output: Chromium has showSaveFilePicker; headless it cannot show a dialog, so the tests either
 * remove it (download path: Blob + <a download>) or replace it by an OPFS file handle (streamed
 * path, 8 000 px test on Chromium). Without WebGPU / WebGL 2 (no editor) the scenario is skipped.
 */

const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures/uploads",
);

test.beforeAll(() => {
  resetRateLimits(main.dbName);
});

test.use({ serviceWorkers: "block" });

/* ---- PNG reading (reference decoder: node:zlib) ------------------------------------------ */

interface Png {
  width: number;
  height: number;
  channels: number;
  rgba: Uint8Array;
}

function ihdr(head: Buffer): {
  width: number;
  height: number;
  colorType: number;
} {
  expect([...head.subarray(0, 8)]).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  expect(head.subarray(12, 16).toString("latin1")).toBe("IHDR");
  return {
    width: head.readUInt32BE(16),
    height: head.readUInt32BE(20),
    colorType: head[25]!,
  };
}

function decodePng(buf: Buffer): Png {
  const { width, height, colorType } = ihdr(buf);
  const channels = colorType === 6 ? 4 : 3;
  const idat: Buffer[] = [];
  let o = 8;
  let end = false;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.subarray(o + 4, o + 8).toString("latin1");
    if (type === "IDAT") idat.push(buf.subarray(o + 8, o + 8 + len));
    if (type === "IEND") end = true;
    o += 12 + len;
  }
  expect(end).toBe(true);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  expect(raw.length).toBe(height * (stride + 1));
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i]!;
      const a = i >= channels ? out[y * stride + i - channels]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + i]! : 0;
      const c =
        y > 0 && i >= channels ? out[(y - 1) * stride + i - channels]! : 0;
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + i] = (x + p) & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba.set(out.subarray(i * channels, i * channels + 3), i * 4);
    rgba[i * 4 + 3] = channels === 4 ? out[i * channels + 3]! : 255;
  }
  return { width, height, channels, rgba };
}

const px = (img: Png, x: number, y: number): number[] => {
  const i = (Math.floor(y) * img.width + Math.floor(x)) * 4;
  return [...img.rgba.subarray(i, i + 4)];
};

/* ---- Editor helpers (same flow as maps.spec.ts) ------------------------------------------ */

async function gmWithGame(page: Page): Promise<string> {
  const gm = unique("Graveur");
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

/** Creates a map and opens the editor; false without a GPU renderer. */
async function createMap(
  page: Page,
  gameId: string,
  name: string,
  w: number,
  h: number,
): Promise<boolean> {
  await page.goto(`/games/${gameId}?tab=maps`);
  await page.getByTestId("map-new").click();
  const form = page.getByTestId("map-create-form");
  await form.locator('input[name="name"]').fill(name);
  await form.locator('input[name="width"]').fill(String(w));
  await form.locator('input[name="height"]').fill(String(h));
  await page.getByTestId("map-create").click();
  await expect(page).toHaveURL(new RegExp(`/games/${gameId}/maps/\\d+/edit$`));
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

async function expectSaved(page: Page): Promise<void> {
  await expect(page.getByTestId("save-status")).toHaveAttribute(
    "data-state",
    "saved",
    { timeout: 15_000 },
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

async function viewportBox(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
  return (await page.getByTestId("editor-viewport").boundingBox())!;
}

async function clickAt(page: Page, fx: number, fy: number): Promise<void> {
  const b = await viewportBox(page);
  await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
}

async function openExport(page: Page): Promise<void> {
  await page.getByTestId("editor-export").click();
  await page.getByTestId("export-png").click();
  await expect(page.getByTestId("export-png-form")).toBeVisible();
}

async function announced(
  page: Page,
): Promise<{ width: number; height: number }> {
  const size = page.getByTestId("export-size");
  return {
    width: Number(await size.getAttribute("data-width")),
    height: Number(await size.getAttribute("data-height")),
  };
}

/** No native picker: the export goes through Blob + download. */
async function forceDownload(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      value: undefined,
      configurable: true,
    });
  });
}

/** Exports through the download path; returns the saved file. */
async function exportToDownload(page: Page): Promise<string> {
  const download = page.waitForEvent("download", { timeout: 170_000 });
  await page.getByTestId("export-start").click();
  const file = await download;
  const target = test
    .info()
    .outputPath(`${Date.now()}-${file.suggestedFilename()}`);
  await file.saveAs(target);
  await expect(page.getByTestId("export-progress")).toHaveAttribute(
    "data-state",
    "done",
    { timeout: 30_000 },
  );
  return target;
}

/** Sum of the resident memory of the Playwright browser processes (KB). */
function browserRssKb(): number {
  const out = execSync("ps -A -o rss=,command=", {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return out
    .split("\n")
    .filter((l) => l.includes("ms-playwright"))
    .reduce((sum, l) => sum + (Number.parseInt(l.trim(), 10) || 0), 0);
}

/* ---- Scenarios ---------------------------------------------------------------------------- */

test("export ×1, ×2 and ×4: downloaded PNG decodes at the announced size", async ({
  page,
  browserName,
}) => {
  test.setTimeout(120_000);
  await forceDownload(page);
  const gameId = await gmWithGame(page);
  const ok = await createMap(page, gameId, "Export petit", 12, 8);
  test.skip(
    !ok,
    `${browserName}: neither WebGPU nor WebGL 2 in this headless browser`,
  );
  await addTile(page);
  await page.getByTestId("tool-fill").click();
  await clickAt(page, 0.5, 0.5);
  await expectSaved(page);

  await openExport(page);
  for (const factor of [1, 2, 4]) {
    await page.getByTestId(`export-factor-${factor}`).check();
    const size = await announced(page);
    expect(size).toEqual({ width: 12 * 70 * factor, height: 8 * 70 * factor });
    const file = await exportToDownload(page);
    await expect(page.getByTestId("export-progress")).toHaveAttribute(
      "data-where",
      "worker",
    );
    expect(path.basename(file)).toMatch(/Export petit\.png$/);
    const png = decodePng(readFileSync(file));
    expect([png.width, png.height]).toEqual([size.width, size.height]);
    expect(png.channels).toBe(3); // opaque background ⇒ RGB
  }
});

test("export of 8 000 × 8 000 px without crash (time, memory)", async ({
  page,
  browserName,
}) => {
  test.setTimeout(240_000);
  const streamed = browserName === "chromium";
  if (streamed) {
    // Streamed path: showSaveFilePicker replaced by an OPFS file (same writable stream API).
    await page.addInitScript(() => {
      (
        window as unknown as { showSaveFilePicker: unknown }
      ).showSaveFilePicker = async (o: { suggestedName: string }) =>
        (await navigator.storage.getDirectory()).getFileHandle(
          o.suggestedName,
          { create: true },
        );
    });
  } else {
    await forceDownload(page);
  }
  const gameId = await gmWithGame(page);
  const ok = await createMap(page, gameId, "Export geant", 100, 100);
  test.skip(
    !ok,
    `${browserName}: neither WebGPU nor WebGL 2 in this headless browser`,
  );
  await addTile(page);
  await page.getByTestId("tool-fill").click();
  await clickAt(page, 0.5, 0.5);
  await expectSaved(page);

  await openExport(page);
  await page.getByTestId("export-mode").selectOption("width");
  await page.getByTestId("export-width").fill("8000");
  expect(await announced(page)).toEqual({ width: 8000, height: 8000 });
  await expect(page.getByTestId("export-warning-large")).toHaveCount(0); // 64 Mpx < 100

  const rssBefore = browserRssKb();
  let rssPeak = rssBefore;
  const sampler = setInterval(() => {
    rssPeak = Math.max(rssPeak, browserRssKb());
  }, 250);
  const started = Date.now();
  let head: Buffer;
  let size: number;
  let tail: Buffer;
  try {
    if (streamed) {
      await page.getByTestId("export-start").click();
      await expect(page.getByTestId("export-progress")).toHaveAttribute(
        "data-state",
        "done",
        {
          timeout: 200_000,
        },
      );
      const file = await page.evaluate(async () => {
        const dir = await navigator.storage.getDirectory();
        const f = await (await dir.getFileHandle("Export geant.png")).getFile();
        const bytes = async (a: number, b: number) =>
          Array.from(new Uint8Array(await f.slice(a, b).arrayBuffer()));
        return {
          size: f.size,
          head: await bytes(0, 33),
          tail: await bytes(f.size - 12, f.size),
        };
      });
      head = Buffer.from(file.head);
      tail = Buffer.from(file.tail);
      size = file.size;
    } else {
      const target = await exportToDownload(page);
      const all = readFileSync(target);
      head = all.subarray(0, 33);
      tail = all.subarray(all.length - 12);
      size = statSync(target).size;
    }
  } finally {
    clearInterval(sampler);
  }
  const seconds = (Date.now() - started) / 1000;
  const h = ihdr(head);
  expect([h.width, h.height]).toEqual([8000, 8000]);
  expect(tail.subarray(4, 8).toString("latin1")).toBe("IEND");
  expect(size).toBeGreaterThan(10_000);
  const peakMb = Math.round((rssPeak - rssBefore) / 1024);
  test.info().annotations.push({
    type: "measure",
    description: `${browserName} ${streamed ? "stream" : "blob"}: ${seconds.toFixed(1)} s, ${(size / 1e6).toFixed(1)} MB, browser RSS +${peakMb} MB (peak)`,
  });
  console.log(
    `[export-png] ${browserName} 8000×8000 ${streamed ? "stream" : "blob"}: ${seconds.toFixed(1)} s, file ${(size / 1e6).toFixed(1)} MB, browser RSS peak +${peakMb} MB`,
  );
  // Raw RGBA of the image alone is 256 MB: band rendering must stay well below it.
  expect(peakMb).toBeLessThan(600);
  // The page survived (no crash) and still responds.
  await expect(page.getByTestId("export-start")).toBeEnabled();
  await expect(page.getByTestId("export-progress")).toHaveAttribute(
    "data-where",
    "worker",
  );

  // Clean cancellation: the worker stops, nothing is downloaded, an existing file is intact.
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.getByTestId("export-start").click();
  await expect
    .poll(async () =>
      Number(
        await page.getByTestId("export-progress").getAttribute("data-done"),
      ),
    )
    .toBeGreaterThan(0);
  await page.getByTestId("export-cancel").click();
  await expect(page.getByTestId("export-progress")).toHaveAttribute(
    "data-state",
    "cancelled",
  );
  await page.waitForTimeout(1000);
  expect(downloads).toBe(0);
  expect(
    page.workers().filter((w) => w.url().includes("export.worker")),
  ).toHaveLength(0);
  if (streamed) {
    const after = await page.evaluate(async () => {
      const dir = await navigator.storage.getDirectory();
      return (await (await dir.getFileHandle("Export geant.png")).getFile())
        .size;
    });
    expect(after).toBe(size);
  }
});

test("without the worker, the export runs on the main thread", async ({
  page,
  browserName,
}) => {
  test.setTimeout(120_000);
  await forceDownload(page);
  // Worker script unavailable ⇒ probe fails ⇒ band rendering on the main thread.
  await page
    .context()
    .route(/export\.worker-[^/]*\.js/, (route) => route.abort());
  const gameId = await gmWithGame(page);
  const ok = await createMap(page, gameId, "Export repli", 30, 20);
  test.skip(
    !ok,
    `${browserName}: neither WebGPU nor WebGL 2 in this headless browser`,
  );
  await addTile(page);
  await page.getByTestId("tool-fill").click();
  await clickAt(page, 0.5, 0.5);
  await expectSaved(page);
  await openExport(page);
  await page.getByTestId("export-factor-2").check();
  const file = await exportToDownload(page);
  await expect(page.getByTestId("export-progress")).toHaveAttribute(
    "data-where",
    "main",
  );
  const png = decodePng(readFileSync(file));
  expect([png.width, png.height]).toEqual([30 * 140, 20 * 140]);
});

test("exported pixels match the editor preview", async ({
  page,
  browserName,
}) => {
  test.setTimeout(120_000);
  await forceDownload(page);
  const gameId = await gmWithGame(page);
  const ok = await createMap(page, gameId, "Export apercu", 6, 4);
  test.skip(
    !ok,
    `${browserName}: neither WebGPU nor WebGL 2 in this headless browser`,
  );
  await addTile(page);
  // Paint a few cells (brush clicks) so that both tiles and empty cells are compared.
  for (const [fx, fy] of [
    [0.3, 0.3],
    [0.5, 0.5],
    [0.62, 0.5],
    [0.75, 0.7],
  ] as const) {
    await clickAt(page, fx, fy);
  }
  await expectSaved(page);
  // P5: the GM view veils the unexplored fog; the export below has no fog nor lighting, so
  // the preview compared with it is the plain view (same options).
  await page.getByTestId("view-fog").uncheck();
  await page.getByTestId("view-lighting").uncheck();
  // Pointer away (no brush preview), let the engine settle, capture the preview.
  await page.mouse.move(1, 1);
  await page.waitForTimeout(500);
  const shot = decodePng(
    await page.getByTestId("editor-viewport").screenshot(),
  );

  await openExport(page);
  await page.getByTestId("export-factor-1").check();
  const png = decodePng(readFileSync(await exportToDownload(page)));
  expect([png.width, png.height]).toEqual([420, 280]);

  // Map on screen: along the centre row and column, the first / last pixels that are not the
  // "outside" colour of the parchment theme (#cbbd9c) are the 2 px map border.
  const outside = [0xcb, 0xbd, 0x9c];
  const isOutside = (x: number, y: number): boolean => {
    const c = px(shot, x, y);
    return (
      Math.abs(c[0]! - outside[0]!) +
        Math.abs(c[1]! - outside[1]!) +
        Math.abs(c[2]! - outside[2]!) <=
      24
    );
  };
  const midY = Math.floor(shot.height / 2);
  const midX = Math.floor(shot.width / 2);
  let x0 = 0;
  while (isOutside(x0, midY)) x0++;
  let x1 = shot.width - 1;
  while (isOutside(x1, midY)) x1--;
  let y0 = 0;
  while (isOutside(midX, y0)) y0++;
  let y1 = shot.height - 1;
  while (isOutside(midX, y1)) y1--;
  const border = 2;
  const mapX = x0 + border;
  const mapY = y0 + border;
  const cell = (x1 + 1 - border - mapX) / 6;
  expect((y1 + 1 - border - mapY) / 4).toBeCloseTo(cell, 0);

  // Compare 4 points per cell, away from cell edges and grid lines.
  // Tolerance: GPU (Pixi, bilinear at the preview zoom) vs Canvas 2D (export at 70 px/cell)
  // sample the same tile image at different scales ⇒ small differences on its gradient.
  let total = 0;
  let worst = 0;
  let samples = 0;
  for (let cy = 0; cy < 4; cy++) {
    for (let cx = 0; cx < 6; cx++) {
      for (const [u, v] of [
        [0.3, 0.3],
        [0.7, 0.3],
        [0.3, 0.7],
        [0.7, 0.7],
      ] as const) {
        const a = px(shot, mapX + (cx + u) * cell, mapY + (cy + v) * cell);
        const e = px(png, (cx + u) * 70, (cy + v) * 70);
        for (let k = 0; k < 3; k++) {
          const d = Math.abs(a[k]! - e[k]!);
          total += d;
          worst = Math.max(worst, d);
        }
        samples += 3;
      }
    }
  }
  const mean = total / samples;
  console.log(
    `[export-png] ${browserName} preview vs export: mean |Δ| ${mean.toFixed(2)}, max ${worst} (cell ${cell.toFixed(1)} px on screen)`,
  );
  expect(mean).toBeLessThanOrEqual(6);
  expect(worst).toBeLessThanOrEqual(32);
});
