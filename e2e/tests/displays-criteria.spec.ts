import { expect, test, type Browser } from "@playwright/test";
import { resetRateLimits } from "../helpers/db";
import {
  cellCssPx,
  listDisplays,
  openScreen,
  pairByForm,
  pairByUrl,
  patchSettings,
  screenErrors,
  waitScene,
  waitToken,
} from "../helpers/displays";
import { main } from "../helpers/env";
import {
  act,
  assign,
  createDisplay,
  createGame,
  createMap,
  createSession,
  createTokenDef,
  deleteDisplay,
  doorOp,
  joinSession,
  lightOp,
  openUser,
  placeOp,
  postOps,
  sleep,
  startSession,
  uid,
  wallOp,
  watchErrors,
  type Actor,
  type MapRef,
  type SessionRef,
} from "../helpers/sessions";

/**
 * P7f: one test per acceptance criterion of phase 7 (projet.md 23):
 * 1 pairing < 30 s, 2 only what is revealed, 3 25 mm per cell (+/- 2 %), 4 rotations, 5 immediate
 * revocation, 6 two screens, 7 automatic reconnection, 8 screen kept awake. The GM acts through the
 * API (and, for criterion 1, the console); the screens are real anonymous browser contexts.
 * The hour-long Wake Lock and the ruler measurement on a real device stay manual (docs/irl.md).
 */

test.beforeEach(() => {
  // Every browser runs from 127.0.0.1: the "pair" bucket allows 10 pairings a minute.
  resetRateLimits(main.dbName);
});

interface Base {
  gm: Actor;
  gameId: string;
  map: MapRef;
  session: SessionRef;
  pc: string;
  gobelin: string;
}

/** GM, a 14x10 map, an unassigned `pc` (viewer of the table) and a visible goblin; session running. */
async function buildBase(browser: Browser): Promise<Base> {
  const gm = await openUser(browser, "gm-crit", { hook: false });
  const gameId = await createGame(gm, []);
  const map = await createMap(gm, gameId);
  const pcDef = await createTokenDef(gm, gameId, "Aria", 8, "pc");
  const npcDef = await createTokenDef(gm, gameId, "Gobelin", 6, "npc");
  const pc = uid();
  const gobelin = uid();
  await postOps(gm, map, [placeOp(map.floor, pc, pcDef, [3.5, 3.5]), placeOp(map.floor, gobelin, npcDef, [5.5, 5.5])]);
  const session = await createSession(gm, gameId, map.id);
  await startSession(gm, session.id);
  return { gm, gameId, map, session, pc, gobelin };
}

test("1. pairing in less than 30 s (console to ready scene)", async ({ browser, browserName }) => {
  test.setTimeout(120_000);
  const b = await buildBase(browser);
  const screen = await openScreen(browser);
  const gmErrors = watchErrors(b.gm.page);
  try {
    await b.gm.page.goto(`/sessions/${b.session.id}`);
    await expect(b.gm.page.getByTestId("console-viewport")).toHaveAttribute("data-scene", "ready", { timeout: 30_000 });
    await b.gm.page.getByTestId("panel-tab-displays").click();
    await expect(b.gm.page.getByTestId("displays-panel")).toBeVisible();
    await b.gm.page.getByTestId("displays-add-name").fill("Table");

    const t0 = Date.now();
    await b.gm.page.getByTestId("displays-add").click();
    const item = b.gm.page.locator('[data-testid^="display-item-"]');
    await expect(item).toHaveCount(1);
    const id = (await item.getAttribute("data-testid"))!.replace("display-item-", "");
    const code = ((await b.gm.page.getByTestId(`display-code-${id}`).textContent()) ?? "").replace(/\s+/g, "");
    expect(code).toMatch(/^\d{6}$/);
    await pairByForm(screen.page, code);
    await waitScene(screen.page);
    const elapsed = Date.now() - t0;
    console.log(`[${browserName}] pairing: ${elapsed} ms (console click to ready scene)`);
    test.info().annotations.push({ type: "pairing_ms", description: String(elapsed) });
    expect(elapsed).toBeLessThan(30_000);
    await expect(b.gm.page.getByTestId(`display-item-${id}`)).toHaveAttribute("data-state", "active", { timeout: 20_000 });
    expect(gmErrors).toEqual([]);
    expect(screenErrors(screen.errors)).toEqual([]);
  } finally {
    await screen.context.close();
    await b.gm.context?.close();
  }
});

test("2. the screen shows only what is revealed", async ({ browser }) => {
  test.setTimeout(150_000);
  const gm = await openUser(browser, "gm-leak", { hook: false });
  const player = await openUser(browser, "joueuse-leak");
  const screen = await openScreen(browser);
  const other = await openScreen(browser);
  try {
    const gameId = await createGame(gm, [{ name: player.name }]);
    const map = await createMap(gm, gameId, 70, 10);
    const ids = { spectre: uid(), follow: uid(), gmLight: uid(), secret: uid(), far: uid(), farWall: uid() };
    const wall = uid();
    const assigned = uid();
    const pc = uid();
    const gobelin = uid();
    const aria = await createTokenDef(gm, gameId, "Aria", 6, "pc");
    const ally = await createTokenDef(gm, gameId, "Borin", 6, "pc");
    const npc = await createTokenDef(gm, gameId, "Gobelin", 6, "npc");
    const spectre = await createTokenDef(gm, gameId, "Spectre", 6, "npc");
    const distant = await createTokenDef(gm, gameId, "Sentinelle", 6, "npc");
    await postOps(gm, map, [
      wallOp(map.floor, [[7, 0], [7, 10]], wall),
      placeOp(map.floor, assigned, aria, [3.5, 3.5]),
      placeOp(map.floor, pc, ally, [3.5, 4.5]),
      placeOp(map.floor, gobelin, npc, [5.5, 5.5]),
      placeOp(map.floor, ids.spectre, spectre, [4.5, 6.5], true),
      lightOp(map.floor, ids.follow, [4.5, 6.5], { follows: ids.spectre }),
      lightOp(map.floor, ids.gmLight, [6, 6], { visibility: "gm" }),
      doorOp(map.floor, ids.secret, [3, 9], [4, 9], { secret: true }),
      placeOp(map.floor, ids.far, distant, [60.5, 5.5]),
      wallOp(map.floor, [[58, 0], [58, 10]], ids.farWall),
    ]);
    const session = await createSession(gm, gameId, map.id);
    await joinSession(player, session.code);
    await assign(gm, session.id, aria, player.id);
    await startSession(gm, session.id);
    const display = await createDisplay(gm, session.id);
    const sid = session.id;

    const seen: string[] = [];
    screen.page.on("response", async (res) => {
      try {
        if (res.url().includes("/api/v1/") && !res.url().includes("/stream")) {
          seen.push(`${res.url()}\n${(await res.body()).toString("latin1")}`);
        }
      } catch {
        /* body gone (navigation) */
      }
    });
    await pairByUrl(screen.page, display.code);
    await waitScene(screen.page);
    // Controls: the assigned token and the unassigned pc are viewers of the table.
    await expect(screen.page.getByTestId("display-viewport")).toHaveAttribute("data-viewers", new RegExp(assigned));
    await expect(screen.page.getByTestId("display-viewport")).toHaveAttribute("data-viewers", new RegExp(pc));

    const gmDo = async (): Promise<void> => {
      await act(gm, sid, [{ type: "token.move", uid: ids.spectre, x: 5.5, y: 6.5 }]);
      await act(gm, sid, [{ type: "light.toggle", uid: ids.follow, enabled: false }]);
      await act(gm, sid, [{ type: "light.toggle", uid: ids.gmLight, enabled: false }]);
      await act(gm, sid, [{ type: "door.toggle", uid: ids.secret, state: "open" }]);
      await act(gm, sid, [{ type: "token.move", uid: ids.far, x: 61.5, y: 5.5 }]);
      await act(gm, sid, [{ type: "token.move", uid: gobelin, x: 6.5, y: 5.5 }]);
    };
    await gmDo();
    await sleep(1500);
    const get = async (path: string, params?: Record<string, string>): Promise<string> => {
      const res = await screen.request.get(`/api/v1${path}`, { params: { as: "display", ...(params ?? {}) } });
      expect(res.ok(), `${path} -> ${res.status()}`).toBeTruthy();
      return `${path}\n${(await res.body()).toString("latin1")}`;
    };
    seen.push(await get(`/sessions/${sid}/snapshot`));
    seen.push(await get(`/sessions/${sid}/preload`));
    seen.push(await get(`/maps/${map.id}/chunks`, { floor: map.floor, layers: "ground,terrain,decor" }));
    seen.push(await get(`/maps/${map.id}/fog`, { floor: map.floor }));
    const events = await get("/events", { channels: `session:${sid}`, since: "0", wait: "0" });
    seen.push(events);
    expect(events).toContain('"events"');
    await gmDo();
    await act(gm, sid, [{ type: "token.move", uid: gobelin, x: 5.5, y: 5.5 }]);
    await sleep(1500);
    seen.push(await get("/events", { channels: `session:${sid}`, since: "0", wait: "0" }));
    const finalSnapshot = await get(`/sessions/${sid}/snapshot`);
    seen.push(finalSnapshot);
    const all = seen.join("\n");
    expect(seen.length).toBeGreaterThan(8);

    for (const [name, value] of Object.entries(ids)) {
      // The light following the hidden token stays, unlinked: only the token uid must not leak.
      if (name === "secret" || name === "follow") continue;
      const where = seen.filter((x) => x.includes(value)).map((x) => x.split("\n")[0]);
      expect(where, `${name} (${value}) leaked in`).toEqual([]);
    }
    expect(all.includes(session.code), "session code leaked").toBe(false);
    expect(all.includes(player.name), "player username leaked").toBe(false);
    expect(all).not.toContain('"secret":true');
    for (const body of seen.filter((x) => x.includes(ids.secret))) {
      expect(body, "secret door shown").not.toMatch(
        new RegExp(`${ids.secret}[^}]*"type":"door"|"type":"door"[^}]*${ids.secret}`),
      );
    }
    // Controls: the visible goblin and the unassigned pc (viewer D5) are there; assignments without name.
    expect(finalSnapshot.includes(gobelin), "goblin missing").toBe(true);
    expect(finalSnapshot.includes(pc), "unassigned pc missing").toBe(true);
    expect(finalSnapshot).toContain('"role":"display"');
    expect(finalSnapshot).toContain('"players":[]');

    // A screen of another session cannot read the first one.
    const gameB = await createGame(gm, []);
    const mapB = await createMap(gm, gameB);
    const sessionB = await createSession(gm, gameB, mapB.id);
    await startSession(gm, sessionB.id);
    const displayB = await createDisplay(gm, sessionB.id, "Autre");
    await pairByForm(other.page, displayB.code);
    await waitScene(other.page);
    const snap = await other.request.get(`/api/v1/sessions/${sid}/snapshot`, { params: { as: "display" } });
    expect(snap.status()).toBe(404);
    const chunks = await other.request.get(`/api/v1/maps/${map.id}/chunks`, {
      params: { as: "display", floor: map.floor, layers: "ground,terrain,decor" },
    });
    expect(chunks.status()).toBe(404);
    expect(screenErrors(screen.errors)).toEqual([]);
  } finally {
    await screen.context.close();
    await other.context.close();
    await player.context?.close();
    await gm.context?.close();
  }
});

test("3. a cell measures 25 mm (+/- 2 %)", async ({ browser, browserName }) => {
  test.setTimeout(150_000);
  const b = await buildBase(browser);
  const display = await createDisplay(b.gm, b.session.id);
  const screen = await openScreen(browser, {
    viewport: { width: 1280, height: 720 },
    screen: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });
  try {
    await pairByUrl(screen.page, display.code);
    await waitScene(screen.page);
    const reported = await screen.page.evaluate(() => ({ w: window.screen.width, h: window.screen.height }));
    const within = (value: number, expected: number): void => {
      expect(Math.abs(value - expected) / expected, `${value} vs ${expected}`).toBeLessThan(0.02);
    };
    const viewport = screen.page.getByTestId("display-viewport");
    const measure = async (expected: number): Promise<number> => {
      await expect
        .poll(async () => Math.abs((await cellCssPx(screen.page)) - expected) / expected, { timeout: 15_000 })
        .toBeLessThan(0.02);
      return cellCssPx(screen.page);
    };

    if (reported.w === 1920 && reported.h === 1080) {
      // 1) diagonal 24" -> hypot(1920, 1080) / (24 x 25.4) px/mm x 25 mm.
      await patchSettings(b.gm, display.id, { diagonal_in: 24, px_per_mm: null });
      const expected = (Math.hypot(1920, 1080) / (24 * 25.4)) * 25;
      const px = await measure(expected);
      console.log(`[${browserName}] diagonal 24": expected ${expected.toFixed(2)} px, measured ${px}`);
      test.info().annotations.push({ type: "cell_px_diagonal", description: `${expected.toFixed(2)} / ${px}` });
      within(px, expected);

      // 2) the GM zoom is ignored (only the centre follows).
      await act(b.gm, b.session.id, [
        { type: "camera.set", x: 6, y: 5, zoom: 3, floor_id: b.map.floor, follow: true },
      ]);
      await sleep(2000);
      within(await cellCssPx(screen.page), expected);
      await expect(viewport).toHaveAttribute("data-cell-css-px", /\d/);
    } else {
      // The browser does not emulate window.screen: only px_per_mm is used (no diagonal measure).
      console.log(`[${browserName}] window.screen is ${reported.w}x${reported.h}: diagonal step skipped, px_per_mm only`);
      test.info().annotations.push({ type: "screen_emulation", description: `${reported.w}x${reported.h}: diagonal step replaced by px_per_mm` });
      await patchSettings(b.gm, display.id, { px_per_mm: 3.6144, diagonal_in: null });
      await measure(3.6144 * 25);
      await act(b.gm, b.session.id, [
        { type: "camera.set", x: 6, y: 5, zoom: 3, floor_id: b.map.floor, follow: true },
      ]);
      await sleep(2000);
      within(await cellCssPx(screen.page), 3.6144 * 25);
    }

    // 3) ruler calibration through the assistant: 400 px for 100 mm = 4 px/mm -> 100 px per cell.
    await screen.page.keyboard.press("m");
    await expect(screen.page.getByTestId("display-menu")).toBeVisible();
    await screen.page.getByTestId("display-menu-calibrate").click();
    await expect(screen.page.getByTestId("display-calibration")).toBeVisible();
    await screen.page.getByTestId("display-cal-ruler").click();
    await screen.page.getByTestId("display-cal-range").fill("400");
    await expect(screen.page.getByTestId("display-cal-line")).toHaveAttribute("data-px", "400");
    await screen.page.getByTestId("display-cal-save").click();
    const ruler = await measure(100);
    console.log(`[${browserName}] ruler 4 px/mm: expected 100 px, measured ${ruler}`);
    test.info().annotations.push({ type: "cell_px_ruler", description: `100 / ${ruler}` });
    await screen.page.getByTestId("display-cal-close").click().catch(() => undefined);
    await screen.page.keyboard.press("Escape");

    // 4) 30 mm per cell -> 120 px; px_per_mm wins over the diagonal.
    await patchSettings(b.gm, display.id, { mm_per_cell: 30, diagonal_in: 24 });
    const thirty = await measure(120);
    console.log(`[${browserName}] 30 mm per cell: expected 120 px, measured ${thirty}`);
    expect(screenErrors(screen.errors)).toEqual([]);
  } finally {
    await screen.context.close();
    await b.gm.context?.close();
  }
});

test("4. rotations 0 / 90 / 180 / 270 and mirror", async ({ browser }) => {
  test.setTimeout(150_000);
  const b = await buildBase(browser);
  const display = await createDisplay(b.gm, b.session.id);
  const screen = await openScreen(browser, { viewport: { width: 1280, height: 720 } });
  try {
    await pairByUrl(screen.page, display.code);
    await waitScene(screen.page);
    const stage = screen.page.getByTestId("display-stage");
    const root = screen.page.getByTestId("display-page");

    /** Linear part of getComputedStyle(stage).transform and the stage / page sizes. */
    const read = () =>
      stage.evaluate((el) => {
        const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        const page = (el.closest('[data-testid="display-page"]') as HTMLElement) ?? document.body;
        return {
          m: [m.a, m.b, m.c, m.d],
          w: (el as HTMLElement).offsetWidth,
          h: (el as HTMLElement).offsetHeight,
          pw: page.clientWidth,
          ph: page.clientHeight,
        };
      });
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const check = async (rotation: number, mirror: boolean): Promise<void> => {
      await expect(stage).toHaveAttribute("data-rotation", String(rotation), { timeout: 15_000 });
      await expect(stage).toHaveAttribute("data-mirror", String(mirror), { timeout: 15_000 });
      await expect(screen.page.getByTestId("display-viewport")).toHaveAttribute("data-scene", "ready");
      const r = await read();
      const c = Math.cos(rad(rotation));
      const s = Math.sin(rad(rotation));
      const expected = mirror ? [-c, s, s, c] : [c, s, -s, c];
      r.m.forEach((v, i) => expect(Math.abs(v - expected[i]!), `matrix[${i}] ${r.m} vs ${expected}`).toBeLessThan(0.02));
      if (rotation === 90 || rotation === 270) {
        expect({ w: r.w, h: r.h }, "swapped").toEqual({ w: r.ph, h: r.pw });
      } else {
        expect({ w: r.w, h: r.h }, "same as viewport").toEqual({ w: r.pw, h: r.ph });
      }
    };

    for (const rotation of [90, 180, 270, 0]) {
      await patchSettings(b.gm, display.id, { rotation });
      await check(rotation, false);
    }
    await patchSettings(b.gm, display.id, { rotation: 90, mirror: true });
    await check(90, true);
    await patchSettings(b.gm, display.id, { rotation: 0, mirror: true });
    await check(0, true);
    await patchSettings(b.gm, display.id, { mirror: false });
    await check(0, false);

    // Then through the menu of the screen.
    await expect(root).toBeVisible();
    for (const rotation of [90, 180, 270, 0]) {
      await screen.page.keyboard.press("m");
      await expect(screen.page.getByTestId("display-menu")).toBeVisible();
      await screen.page.getByTestId(`display-menu-rotation-${rotation}`).click();
      await screen.page.getByTestId("display-menu-close").click();
      await check(rotation, false);
    }
    await screen.page.keyboard.press("m");
    await screen.page.getByTestId("display-menu-mirror").click();
    await screen.page.getByTestId("display-menu-close").click();
    await check(0, true);
    expect(screenErrors(screen.errors)).toEqual([]);
  } finally {
    await screen.context.close();
    await b.gm.context?.close();
  }
});

test("5. revocation is immediate", async ({ browser, browserName }) => {
  test.setTimeout(150_000);
  const b = await buildBase(browser);
  const display = await createDisplay(b.gm, b.session.id);
  const screen = await openScreen(browser);
  const second = await openScreen(browser);
  try {
    await pairByUrl(screen.page, display.code);
    await waitScene(screen.page);
    await expect.poll(async () => (await listDisplays(b.gm, b.session.id)).find((d) => d.id === display.id)?.state).toBe("active");

    const t0 = Date.now();
    await deleteDisplay(b.gm, display.id);
    await expect(screen.page.getByTestId("display-pair-form")).toBeVisible({ timeout: 10_000 });
    const elapsed = Date.now() - t0;
    console.log(`[${browserName}] revocation: ${elapsed} ms (delete to pairing form)`);
    test.info().annotations.push({ type: "revocation_ms", description: String(elapsed) });
    expect(elapsed, `revocation took ${elapsed} ms`).toBeLessThan(2000);

    const me = await screen.request.get("/api/v1/display/me", { params: { as: "display" } });
    expect(me.status()).toBe(401);
    const events = await screen.request.get("/api/v1/events", {
      params: { as: "display", channels: `session:${b.session.id}`, since: "0", wait: "0" },
    });
    expect(events.status()).toBe(401);
    expect((await listDisplays(b.gm, b.session.id)).some((d) => d.id === display.id)).toBe(false);

    // Variant: the screen quits through its menu.
    const again = await createDisplay(b.gm, b.session.id, "Menu");
    await pairByUrl(second.page, again.code);
    await waitScene(second.page);
    await expect.poll(async () => (await listDisplays(b.gm, b.session.id)).some((d) => d.id === again.id)).toBe(true);
    await second.page.keyboard.press("m");
    await second.page.getByTestId("display-menu-unpair").click();
    await second.page.getByTestId("display-menu-unpair-confirm").click();
    await expect(second.page.getByTestId("display-pair-form")).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => (await listDisplays(b.gm, b.session.id)).some((d) => d.id === again.id)).toBe(false);
    expect(screenErrors(screen.errors)).toEqual([]);
    expect(screenErrors(second.errors)).toEqual([]);
  } finally {
    await screen.context.close();
    await second.context.close();
    await b.gm.context?.close();
  }
});

test("6. two screens at once, each with its own settings", async ({ browser }) => {
  test.setTimeout(150_000);
  const b = await buildBase(browser);
  const da = await createDisplay(b.gm, b.session.id, "A");
  const db = await createDisplay(b.gm, b.session.id, "B");
  const a = await openScreen(browser);
  const c = await openScreen(browser);
  try {
    await pairByUrl(a.page, da.code);
    await pairByUrl(c.page, db.code);
    await waitScene(a.page);
    await waitScene(c.page);
    await patchSettings(b.gm, da.id, { rotation: 0, show_tokens: true });
    await patchSettings(b.gm, db.id, { rotation: 90, mirror: true, show_tokens: false });
    await expect(a.page.getByTestId("display-stage")).toHaveAttribute("data-rotation", "0", { timeout: 15_000 });
    await expect(c.page.getByTestId("display-stage")).toHaveAttribute("data-rotation", "90", { timeout: 15_000 });
    await expect(c.page.getByTestId("display-stage")).toHaveAttribute("data-mirror", "true");
    await expect(a.page.getByTestId("display-viewport")).toHaveAttribute("data-tokens", "on");
    await expect(c.page.getByTestId("display-viewport")).toHaveAttribute("data-tokens", "off");

    await act(b.gm, b.session.id, [{ type: "token.move", uid: b.gobelin, x: 6.5, y: 5.5 }]);
    await Promise.all([waitToken(a.page, b.gobelin, 6.5, 5.5), waitToken(c.page, b.gobelin, 6.5, 5.5)]);
    await act(b.gm, b.session.id, [{ type: "token.move", uid: b.gobelin, x: 5.5, y: 5.5 }]);
    await Promise.all([waitToken(a.page, b.gobelin, 5.5, 5.5), waitToken(c.page, b.gobelin, 5.5, 5.5)]);

    // Each keeps its own attributes.
    await expect(a.page.getByTestId("display-stage")).toHaveAttribute("data-rotation", "0");
    await expect(a.page.getByTestId("display-stage")).toHaveAttribute("data-mirror", "false");
    await expect(c.page.getByTestId("display-stage")).toHaveAttribute("data-rotation", "90");
    await expect(c.page.getByTestId("display-viewport")).toHaveAttribute("data-tokens", "off");

    await expect
      .poll(async () => {
        const rows = await listDisplays(b.gm, b.session.id);
        return rows.filter((d) => [da.id, db.id].includes(d.id) && d.state === "active" && d.online).length;
      }, { timeout: 30_000 })
      .toBe(2);
    expect(screenErrors(a.errors)).toEqual([]);
    expect(screenErrors(c.errors)).toEqual([]);
  } finally {
    await a.context.close();
    await c.context.close();
    await b.gm.context?.close();
  }
});

test("7. automatic reconnection after a network cut", async ({ browser, browserName }) => {
  test.setTimeout(180_000);
  const b = await buildBase(browser);
  const display = await createDisplay(b.gm, b.session.id);
  const screen = await openScreen(browser);
  try {
    await pairByUrl(screen.page, display.code);
    await waitScene(screen.page);
    await act(b.gm, b.session.id, [{ type: "token.move", uid: b.gobelin, x: 6.5, y: 5.5 }]);
    await waitToken(screen.page, b.gobelin, 6.5, 5.5);

    await screen.context.setOffline(true);
    // Deviation from the 15 s of the brief: setOffline does not cut an event stream already open (a
    // move made right after would still arrive), but the server closes a stream after 25 s. The GM
    // moves the token once that stream is surely gone, so the cut is real and the catch-up after
    // the return is what is measured.
    await sleep(27_000);
    await act(b.gm, b.session.id, [{ type: "token.move", uid: b.gobelin, x: 4.5, y: 5.5 }]);
    await sleep(3000);
    // The cut is real: the final position has not reached the screen yet.
    const during = await screen.page.evaluate((u) => (window as any).__jdrTest?.tokens?.[u], b.gobelin);
    console.log(`[${browserName}] token seen while offline: ${JSON.stringify(during)}`);
    expect(during).toEqual([6.5, 5.5]);
    const t0 = Date.now();
    await screen.context.setOffline(false);
    await waitToken(screen.page, b.gobelin, 4.5, 5.5, 30_000);
    const elapsed = Date.now() - t0;
    console.log(`[${browserName}] reconnection: final position applied ${elapsed} ms after the network came back`);
    test.info().annotations.push({ type: "reconnect_ms", description: String(elapsed) });
    expect(elapsed).toBeLessThanOrEqual(30_000);
    await expect(screen.page.getByTestId("display-page")).toHaveAttribute("data-status", "running", { timeout: 15_000 });
    await expect(screen.page.getByTestId("display-pair-form")).toHaveCount(0);

    // A reload keeps the pairing.
    await screen.page.reload();
    await waitScene(screen.page);
    await expect(screen.page.getByTestId("display-pair-form")).toHaveCount(0);

    // So does closing and reopening a page in the same context.
    await screen.page.close();
    const page = await screen.context.newPage();
    await page.goto("/display");
    await waitScene(page);
    await expect(page.getByTestId("display-pair-form")).toHaveCount(0);
  } finally {
    await screen.context.close();
    await b.gm.context?.close();
  }
});

test("8. the screen stays awake (Wake Lock, fallback)", async ({ browser, browserName }) => {
  test.setTimeout(150_000);
  // The real duration (one hour without sleep) is a manual check on the device (docs/irl.md).
  const b = await buildBase(browser);
  const display = await createDisplay(b.gm, b.session.id);
  const counting = await openScreen(browser, { wake: "count" });
  const bare = await openScreen(browser, { wake: "none" });
  try {
    await pairByUrl(counting.page, display.code);
    await waitScene(counting.page);
    const root = counting.page.getByTestId("display-page");
    await expect(root).toHaveAttribute("data-wake", "active", { timeout: 15_000 });
    const calls = () => counting.page.evaluate(() => (window as any).__wake.calls as number);
    const first = await calls();
    expect(first).toBeGreaterThanOrEqual(1);

    // The lock is lost (released by the system), then the page becomes visible again.
    await counting.page.evaluate(() => {
      const w = window as any;
      w.__wake.sentinels[w.__wake.sentinels.length - 1].fire();
      const set = (value: string) => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
        Object.defineProperty(document, "hidden", { configurable: true, get: () => value === "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      };
      set("hidden");
      set("visible");
    });
    await expect.poll(calls, { timeout: 15_000 }).toBeGreaterThan(first);
    await expect(root).toHaveAttribute("data-wake", "active", { timeout: 15_000 });
    console.log(`[${browserName}] wake lock: requests ${first} then ${await calls()}, state active`);

    // No Wake Lock at all: video fallback, or the banner.
    const display2 = await createDisplay(b.gm, b.session.id, "Sans wake lock");
    await pairByUrl(bare.page, display2.code);
    await waitScene(bare.page);
    const rootBare = bare.page.getByTestId("display-page");
    await expect(rootBare).toHaveAttribute("data-wake", /video|unsupported/, { timeout: 15_000 });
    const state = await rootBare.getAttribute("data-wake");
    console.log(`[${browserName}] without navigator.wakeLock: data-wake=${state}`);
    test.info().annotations.push({ type: "wake_without_api", description: String(state) });
    if (state === "unsupported") await expect(bare.page.getByTestId("display-wake-banner")).toBeVisible();
    expect(screenErrors(counting.errors)).toEqual([]);
    expect(screenErrors(bare.errors)).toEqual([]);
  } finally {
    await counting.context.close();
    await bare.context.close();
    await b.gm.context?.close();
  }
});
