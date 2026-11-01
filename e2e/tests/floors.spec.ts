import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { resetRateLimits } from "../helpers/db";
import { openScreen, pairByUrl, screenErrors, waitScene, type Screen } from "../helpers/displays";
import { main } from "../helpers/env";
import {
  assign,
  createDisplay,
  createGame,
  createMap,
  createSession,
  createTokenDef,
  doorOp,
  joinSession,
  openUser,
  placeOp,
  postOps,
  startSession,
  uid,
  watchErrors,
  type Actor,
  type MapRef,
  type SessionRef,
} from "../helpers/sessions";

/**
 * P9a2: floors, stairs, portals and links. The editor is driven through the page (floor selector,
 * brush, stairs tool, deletion and undo); the session is driven by the GM console ("Passages" panel,
 * the "Emprunter" dialog) with a player browser and a projection screen watching (data-map,
 * data-floor, data-placed of their viewports).
 */

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/uploads");

test.beforeEach(() => {
  resetRateLimits(main.dbName);
});

// ---- API helpers ------------------------------------------------------------------------------

async function detail(gm: Actor, mapId: string): Promise<any> {
  const res = await gm.request.get(`/api/v1/maps/${mapId}`);
  expect(res.ok(), `GET map -> ${res.status()}`).toBeTruthy();
  return (await res.json()).data;
}

/** Adds a floor by op and returns its server id. */
async function addFloor(gm: Actor, map: MapRef, floorUid: string, name: string, level: number): Promise<string> {
  await postOps(gm, map, [{ type: "floor.add", floor: { uid: floorUid, name, level } }]);
  const d = await detail(gm, map.id);
  return String(d.floors.find((f: any) => f.uid === floorUid).id);
}

function stairsOp(floor: string, id: string, g: { x: number; y: number; w: number; h: number }, toFloor: string): unknown {
  return {
    type: "object.add",
    object: {
      uid: id,
      floor,
      layer: "props",
      visibility: "all",
      locked: false,
      sort_order: 0,
      rev: 1,
      type: "stairs",
      geometry: g,
      props: { direction: "up", to_floor: toFloor },
    },
  };
}

function portalOp(floor: string, id: string, at: [number, number], link: unknown): unknown {
  return {
    type: "object.add",
    object: {
      uid: id,
      floor,
      layer: "props",
      visibility: "all",
      locked: false,
      sort_order: 0,
      rev: 1,
      type: "portal",
      geometry: { x: at[0], y: at[1] },
      props: { icon: "portal", color: "#7c4dff", label: "Vers la salle B", link },
    },
  };
}

interface World {
  gm: Actor;
  player: Actor;
  screen: Screen;
  gameId: string;
  a: MapRef;
  b: MapRef;
  /** Server id of the upper floor of map A. */
  upper: string;
  session: SessionRef;
  stairs: string;
  portal: string;
  linkedDoor: string;
  /** Placed token of the player. */
  pc: string;
  close(): Promise<void>;
}

/**
 * GM, player (token Aria assigned), a screen; map A (ground + upper floor, stairs to the upper floor,
 * a portal to map B at (6.5, 4.5), a door with a link) and map B; the session runs on A, everybody is in.
 */
async function buildWorld(browser: Browser): Promise<World> {
  const gm = await openUser(browser, "gm-floors", { hook: false });
  const player = await openUser(browser, "joueuse-floors");
  const screen = await openScreen(browser);
  const gameId = await createGame(gm, [{ name: player.name }]);
  const a = await createMap(gm, gameId, 14, 10);
  const b = await createMap(gm, gameId, 14, 10);
  const upper = await addFloor(gm, a, "upper", "Étage", 1);
  const aria = await createTokenDef(gm, gameId, "Aria", 8, "pc");
  const ids = { stairs: uid(), portal: uid(), door: uid(), pc: uid() };
  await postOps(gm, a, [
    stairsOp(a.floor, ids.stairs, { x: 2, y: 2, w: 2, h: 2 }, "upper"),
    portalOp(a.floor, ids.portal, [10.5, 4.5], { map_id: b.id, floor: null, x: 6.5, y: 4.5 }),
    { ...(doorOp(a.floor, ids.door, [1, 9], [2, 9]) as any) },
    placeOp(a.floor, ids.pc, aria, [3.5, 3.5]),
  ]);
  // The door leads to map B too (read back: the link is GM only).
  const d = await detail(gm, a.id);
  const door = d.objects.find((o: any) => o.uid === ids.door);
  await postOps(gm, a, [
    {
      type: "object.update",
      uid: ids.door,
      rev: door.rev,
      patch: { props: { ...door.props, link: { map_id: b.id, floor: null, x: 1.5, y: 1.5 } } },
    },
  ]);
  const session = await createSession(gm, gameId, a.id);
  await joinSession(player, session.code);
  await assign(gm, session.id, aria, player.id);
  await startSession(gm, session.id);
  const display = await createDisplay(gm, session.id);
  await player.page.goto(`/sessions/${session.id}`);
  await expect(player.page.getByTestId("play-viewport")).toHaveAttribute("data-scene", "ready", { timeout: 45_000 });
  await pairByUrl(screen.page, display.code);
  await waitScene(screen.page);
  return {
    gm,
    player,
    screen,
    gameId,
    a,
    b,
    upper,
    session,
    stairs: ids.stairs,
    portal: ids.portal,
    linkedDoor: ids.door,
    pc: ids.pc,
    close: async () => {
      await screen.context.close().catch(() => undefined);
      await player.context?.close().catch(() => undefined);
      await gm.context?.close().catch(() => undefined);
    },
  };
}

async function openConsole(w: World): Promise<Page> {
  const page = w.gm.page;
  await page.goto(`/sessions/${w.session.id}`);
  await expect(page.getByTestId("console-viewport")).toHaveAttribute("data-scene", "ready", { timeout: 45_000 });
  await page.getByTestId("panel-tab-maps").click();
  await expect(page.getByTestId("passages-panel")).toBeVisible();
  return page;
}

// ---- 1. editor -------------------------------------------------------------------------------

test("1. editor: second floor, paint, stairs, reload, delete and undo", async ({ browser, browserName }) => {
  test.setTimeout(180_000);
  const gm = await openUser(browser, "cartographe-floors", { hook: false });
  const page = gm.page;
  const errors = watchErrors(page);
  try {
    // A tile for the palette (own library).
    await page.goto("/library");
    await page.locator("section.upload").getByLabel("Type").selectOption("tile");
    await page.locator('input[type="file"]').setInputFiles(path.join(fixtures, "valid_png_opaque.png"));
    await expect(page.locator("ul.queue li.item-done")).toHaveCount(1, { timeout: 20_000 });

    const gameId = await createGame(gm, []);
    const map = await createMap(gm, gameId, 40, 30);
    await page.goto(`/games/${gameId}/maps/${map.id}/edit`);
    const viewport = page.getByTestId("editor-viewport");
    await expect(viewport).toHaveAttribute("data-state", /^(ready|unsupported|error)$/, { timeout: 30_000 });
    test.skip((await viewport.getAttribute("data-state")) === "unsupported", `${browserName}: no WebGPU / WebGL 2`);
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved", { timeout: 15_000 });
    const saved = () => expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });

    // A second floor.
    await page.getByTestId("floor-manage").click();
    await page.getByTestId("floor-new-name").fill("Étage");
    await page.getByTestId("floor-add").click();
    await expect(page.getByTestId("floor-select").locator("option")).toHaveCount(2);
    await page.getByTestId("floor-manage").click();

    // Paint on it.
    await page.getByTestId("palette-add").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("button.tile").first()).toBeVisible({ timeout: 10_000 });
    await dialog.locator("button.tile").first().click();
    await expect(dialog).toBeHidden();
    const box = (await viewport.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy, { steps: 6 });
    await page.mouse.up();
    // Stairs towards the other floor.
    await page.getByTestId("tool-stairs").click();
    await page.mouse.move(cx - 160, cy - 100);
    await page.mouse.down();
    await page.mouse.move(cx - 90, cy - 40, { steps: 5 });
    await page.mouse.up();
    // At least floor + stroke + stairs: on a loaded machine the stroke may exceed the merge window of the history.
    await expect
      .poll(async () => Number(await page.getByTestId("status-history").getAttribute("data-count")))
      .toBeGreaterThanOrEqual(3);
    await saved();

    const upperUid = await page.getByTestId("floor-select").inputValue();
    const chunks = async (floor: string): Promise<number> => {
      const res = await gm.request.get(`/api/v1/maps/${map.id}/chunks`, { params: { floor, layers: "ground,terrain,decor" } });
      expect(res.ok(), `chunks ${floor} -> ${res.status()}`).toBeTruthy();
      return (await res.body()).length;
    };
    const emptyBytes = await chunks(map.floor);
    const paintedBytes = await chunks(upperUid);
    expect(paintedBytes).toBeGreaterThan(emptyBytes);

    // Reload: everything is there.
    await page.reload();
    await expect(viewport).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await expect(page.getByTestId("floor-select").locator("option")).toHaveCount(2);
    let d = await detail(gm, map.id);
    expect(d.floors).toHaveLength(2);
    const upperId = String(d.floors.find((f: any) => f.uid === upperUid).id);
    const stairs = d.objects.filter((o: any) => o.type === "stairs");
    expect(stairs).toHaveLength(1);
    expect(String(stairs[0].floor)).toBe(upperId);
    expect(stairs[0].props.to_floor).toBe(d.floors.find((f: any) => f.id !== upperId && String(f.id) !== upperId).uid);

    // Delete the upper floor, then undo: the content comes back.
    await page.getByTestId("floor-select").selectOption(upperUid);
    await expect(page.getByTestId("floor-select")).toHaveValue(upperUid);
    await page.getByTestId("floor-manage").click();
    await page.getByTestId("floor-remove").click();
    await page.getByTestId("floor-remove-confirm").click();
    await expect(page.getByTestId("floor-select").locator("option")).toHaveCount(1);
    await saved();
    d = await detail(gm, map.id);
    expect(d.floors).toHaveLength(1);
    expect(d.objects.filter((o: any) => o.type === "stairs")).toHaveLength(0);

    await page.getByTestId("editor-undo").click();
    await expect(page.getByTestId("floor-select").locator("option")).toHaveCount(2);
    await saved();
    d = await detail(gm, map.id);
    expect(d.floors.map((f: any) => f.uid)).toContain(upperUid);
    expect(d.objects.filter((o: any) => o.type === "stairs")).toHaveLength(1);
    expect(await chunks(upperUid)).toBe(paintedBytes);
    expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
  } finally {
    await gm.context?.close();
  }
});

// ---- 2. stairs in a session -------------------------------------------------------------------

test("2. the GM takes the stairs: player and screen change floor without preloading again", async ({ browser }) => {
  test.setTimeout(240_000);
  const w = await buildWorld(browser);
  try {
    const { player, screen } = w;
    const playerView = player.page.getByTestId("play-viewport");
    const screenView = screen.page.getByTestId("display-viewport");
    await expect(playerView).toHaveAttribute("data-floor", w.a.floor);
    await expect(screenView).toHaveAttribute("data-floor", w.a.floor);
    // The lobby (preload screen) must never come back.
    await player.page.evaluate(() => {
      (window as any).__lobbySeen = false;
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="play-lobby"]')) (window as any).__lobbySeen = true;
      }).observe(document.body, { subtree: true, childList: true });
    });

    const console = await openConsole(w);
    await console.getByTestId(`passage-take-${w.stairs}`).click();
    await expect(console.getByTestId("travel-dialog")).toBeVisible();
    await expect(console.getByTestId("travel-destination")).toHaveAttribute("data-floor", "upper");
    await console.getByTestId("travel-confirm").click();

    await expect(playerView).toHaveAttribute("data-floor", w.upper, { timeout: 30_000 });
    await expect(screenView).toHaveAttribute("data-floor", w.upper, { timeout: 30_000 });
    await expect(console.getByTestId("console-viewport")).toHaveAttribute("data-floor", w.upper, { timeout: 30_000 });
    await expect(playerView).toHaveAttribute("data-map", w.a.id);
    expect(await player.page.evaluate(() => (window as any).__lobbySeen)).toBe(false);
    await expect(player.page.getByTestId("play-view")).toBeVisible();
    expect(screenErrors(screen.errors)).toEqual([]);
  } finally {
    await w.close();
  }
});

// ---- 3. portal to another map, carrying the token ---------------------------------------------

test("3. the GM takes a portal to another map carrying the player's token", async ({ browser }) => {
  test.setTimeout(240_000);
  const w = await buildWorld(browser);
  try {
    const { player, screen } = w;
    const playerView = player.page.getByTestId("play-viewport");
    const screenView = screen.page.getByTestId("display-viewport");
    const console = await openConsole(w);
    await console.getByTestId(`passage-take-${w.portal}`).click();
    const dialog = console.getByTestId("travel-dialog");
    await expect(dialog).toBeVisible();
    await expect(console.getByTestId("travel-destination")).toHaveAttribute("data-map", w.b.id);
    // The arrival position is the link's; no token is carried unless picked.
    await expect(console.getByTestId("travel-x")).toHaveValue("6.5");
    await expect(console.getByTestId("travel-y")).toHaveValue("4.5");
    await expect(console.getByTestId(`travel-token-${w.pc}`)).not.toBeChecked();
    await console.getByTestId(`travel-token-${w.pc}`).check();
    await console.getByTestId("travel-confirm").click();

    await expect(playerView).toHaveAttribute("data-map", w.b.id, { timeout: 60_000 });
    await expect(playerView).toHaveAttribute("data-placed", new RegExp(`${w.pc}:6\\.5:4\\.5`), { timeout: 30_000 });
    await expect(screenView).toHaveAttribute("data-map", w.b.id, { timeout: 60_000 });
    await expect(screenView).toHaveAttribute("data-placed", new RegExp(`${w.pc}:6\\.5:4\\.5`), { timeout: 30_000 });
    await expect(console.getByTestId("console-viewport")).toHaveAttribute("data-map", w.b.id, { timeout: 30_000 });
    // The camera ends centred on the focus (the player's view follows the GM's camera).
    await expect(playerView).toHaveAttribute("data-camera", "6.5,4.5", { timeout: 30_000 });
    expect(screenErrors(screen.errors)).toEqual([]);
  } finally {
    await w.close();
  }
});

// ---- 4. the player is a spectator -------------------------------------------------------------

test("4. the player has no action on the stairs and receives no link", async ({ browser }) => {
  test.setTimeout(240_000);
  const w = await buildWorld(browser);
  try {
    const { player, screen } = w;
    const playerView = player.page.getByTestId("play-viewport");
    await expect(playerView).toHaveAttribute("data-scene", "ready");
    // Clicking on the map (centre, where the stairs are drawn) sends nothing that changes the map.
    const sent: string[] = [];
    player.page.on("request", (r) => {
      if (r.method() !== "GET" && !/presence|stream|events/.test(r.url())) sent.push(`${r.method()} ${r.url()}`);
    });
    const box = (await playerView.boundingBox())!;
    await player.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await player.page.waitForTimeout(500);
    expect(sent.filter((s) => /change-map/.test(s))).toEqual([]);
    await expect(player.page.getByTestId("passages-panel")).toHaveCount(0);

    // Stairs and portals are visible, but nothing says where they lead.
    const body = async (actor: { request: Actor["request"] }, as?: string): Promise<string> => {
      const res = await actor.request.get(`/api/v1/sessions/${w.session.id}/snapshot`, as === undefined ? {} : { params: { as } });
      expect(res.ok(), `snapshot -> ${res.status()}`).toBeTruthy();
      return res.text();
    };
    const mine = await body(player);
    expect(mine).toContain('"type":"stairs"');
    expect(mine).toContain('"type":"portal"');
    expect(mine).not.toContain('"link"');
    const theirs = await body(screen, "display");
    expect(theirs).toContain('"type":"stairs"');
    expect(theirs).not.toContain('"link"');
    // The GM sees them, and only the GM can travel.
    expect(await body(w.gm)).toContain('"link"');
    const refused = await player.request.post(`/api/v1/sessions/${w.session.id}/change-map`, {
      headers: player.headers,
      data: { map_id: w.b.id },
    });
    expect(refused.status()).toBeGreaterThanOrEqual(400);
    expect(refused.status()).toBeLessThan(500);
    await expect(playerView).toHaveAttribute("data-map", w.a.id);
  } finally {
    await w.close();
  }
});
