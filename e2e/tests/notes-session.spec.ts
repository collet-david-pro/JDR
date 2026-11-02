import { expect, test, type Browser, type Page } from "@playwright/test";
import { resetRateLimits } from "../helpers/db";
import { openScreen, pairByUrl, waitScene, type Screen } from "../helpers/displays";
import { main } from "../helpers/env";
import {
  act,
  assign,
  createDisplay,
  createGame,
  createMap,
  createSession,
  createTokenDef,
  joinSession,
  openUser,
  placeOp,
  postOps,
  snapshot,
  startSession,
  uid,
  wallOp,
  type Actor,
  type MapRef,
  type SessionRef,
} from "../helpers/sessions";

/**
 * P9b2b: notes, pins, zones, traps and secret passages during a session. The map is prepared with
 * ops; the GM console, two players and a projection screen watch. Marked `CANARI` contents must
 * never reach a player or a screen unless shared or revealed.
 */

test.beforeEach(() => {
  resetRateLimits(main.dbName);
});

const base = { layer: "props", locked: false, sort_order: 0, rev: 1 };

function noteOp(id: string, title: string, body: string, audience = "gm", users: string[] = []): unknown {
  return { type: "note.add", note: { uid: id, title, body, audience, ...(audience === "players" ? { audience_users: users } : {}) } };
}
function objOp(floor: string, o: Record<string, unknown>): unknown {
  return { type: "object.add", object: { ...base, floor, ...o } };
}

interface World {
  gm: Actor;
  a: Actor;
  b: Actor;
  screen: Screen;
  map: MapRef;
  session: SessionRef;
  pcA: string;
  pcB: string;
  close(): Promise<void>;
}

const ids = {
  secretNote: uid(),
  sharedNote: uid(),
  readNote: uid(),
  zoneNote: uid(),
  trapNote: uid(),
  pinGm: uid(),
  pinShared: uid(),
  zone: uid(),
  trap: uid(),
  passage: uid(),
};

async function build(browser: Browser): Promise<World> {
  const gm = await openUser(browser, "mj-notes-s", { hook: false });
  const a = await openUser(browser, "joueur-a-notes");
  const b = await openUser(browser, "joueur-b-notes");
  const screen = await openScreen(browser);
  const gameId = await createGame(gm, [{ name: a.name }, { name: b.name }]);
  const map = await createMap(gm, gameId, 14, 10);
  const defA = await createTokenDef(gm, gameId, "Aria", 8, "pc");
  const defB = await createTokenDef(gm, gameId, "Borin", 8, "pc");
  const pcA = uid();
  const pcB = uid();
  const f = map.floor;
  await postOps(gm, map, [
    noteOp(ids.secretNote, "CANARI-secret", "CANARI corps secret"),
    noteOp(ids.sharedNote, "Lettre", "Contenu de la lettre"),
    noteOp(ids.readNote, "Lecture", "**Gras** <img src=x onerror=\"window.__xss=1\">"),
    noteOp(ids.zoneNote, "CANARI-zone", "CANARI corps zone"),
    noteOp(ids.trapNote, "CANARI-piege", "CANARI corps piege"),
    objOp(f, { uid: ids.pinGm, visibility: "gm", type: "pin", geometry: { x: 9.5, y: 8.5 }, props: { icon: "info", color: "#d9534f", note: ids.secretNote } }),
    objOp(f, { uid: ids.pinShared, visibility: "gm", type: "pin", geometry: { x: 10.5, y: 8.5 }, props: { icon: "info", color: "#d9534f", note: ids.sharedNote } }),
    objOp(f, {
      uid: ids.zone,
      layer: "gm",
      visibility: "gm",
      type: "zone",
      geometry: { polygon: [{ x: 1, y: 1 }, { x: 3.5, y: 1 }, { x: 3.5, y: 3.5 }, { x: 1, y: 3.5 }] },
      props: { kind: "description", note: ids.zoneNote, show_on_enter: true },
    }),
    objOp(f, { uid: ids.trap, visibility: "hidden_until_revealed", type: "trap", geometry: { x: 9.5, y: 2.5 }, props: { note: ids.trapNote, reveal_effect: "pulse" } }),
    wallOp(f, [[6, 0], [6, 5]]),
    wallOp(f, [[6, 6.5], [6, 10]]),
    objOp(f, { uid: ids.passage, layer: "walls", visibility: "hidden_until_revealed", type: "secret", geometry: { a: [6, 5], b: [6, 6.5] }, props: { kind: "passage", note: null } }),
    placeOp(f, pcA, defA, [4.5, 5.5]),
    placeOp(f, pcB, defB, [4.5, 7.5]),
  ]);
  const session = await createSession(gm, gameId, map.id);
  await joinSession(a, session.code);
  await joinSession(b, session.code);
  await assign(gm, session.id, defA, a.id);
  await assign(gm, session.id, defB, b.id);
  await startSession(gm, session.id);
  const display = await createDisplay(gm, session.id);
  for (const p of [a, b]) {
    await p.page.goto(`/sessions/${session.id}`);
    await expect(p.page.getByTestId("play-viewport")).toHaveAttribute("data-scene", "ready", { timeout: 45_000 });
  }
  await pairByUrl(screen.page, display.code);
  await waitScene(screen.page);
  await gm.page.goto(`/sessions/${session.id}`);
  await expect(gm.page.getByTestId("console-viewport")).toHaveAttribute("data-scene", "ready", { timeout: 45_000 });
  return {
    gm,
    a,
    b,
    screen,
    map,
    session,
    pcA,
    pcB,
    close: async () => {
      await screen.context.close().catch(() => undefined);
      for (const p of [a, b, gm]) await p.context?.close().catch(() => undefined);
    },
  };
}

const playerObjects = async (who: Actor, sid: string): Promise<any[]> => (await snapshot(who, sid)).map.objects;
const noteTitles = async (who: Actor, sid: string): Promise<string[]> => (await snapshot(who, sid)).map.notes.map((n: any) => n.title);

async function screenSnapshot(w: World): Promise<string> {
  const res = await w.screen.request.get(`/api/v1/sessions/${w.session.id}/snapshot`, { params: { as: "display" } });
  expect(res.ok(), `screen snapshot -> ${res.status()}`).toBeTruthy();
  return res.text();
}

const count = (page: Page) => page.getByTestId("play-notes-count");

test("1. no leak: GM-only notes, pins, zones, traps and passages never reach players or the screen", async ({ browser }) => {
  test.setTimeout(240_000);
  const w = await build(browser);
  try {
    const sid = w.session.id;
    for (const p of [w.a, w.b]) {
      expect(JSON.stringify(await snapshot(p, sid))).not.toContain("CANARI");
      expect(await p.page.content()).not.toContain("CANARI");
      const objs = await playerObjects(p, sid);
      expect(objs.map((o: any) => o.uid)).not.toEqual(expect.arrayContaining([ids.pinGm]));
      for (const t of ["pin", "zone", "trap"]) expect(objs.some((o: any) => o.type === t)).toBe(false);
      expect(objs.find((o: any) => o.uid === ids.passage)?.type).toBe("wall");
    }
    const shot = await screenSnapshot(w);
    expect(shot).not.toContain("CANARI");
    expect(shot).not.toContain(ids.zone);
    expect(shot).not.toContain(ids.trap);
    expect(await w.screen.page.content()).not.toContain("CANARI");
    await expect(w.a.page.getByTestId("play-notes-button")).toHaveCount(0);
  } finally {
    await w.close();
  }
});

test("2. sharing: one player, then everybody, then back to GM only, live", async ({ browser }) => {
  test.setTimeout(240_000);
  const w = await build(browser);
  try {
    const sid = w.session.id;
    await act(w.gm, sid, [{ type: "note.share", note_uid: ids.sharedNote, audience: "players", users: [w.a.id] }]);
    await expect(count(w.a.page)).toHaveText("1", { timeout: 20_000 });
    await expect(w.b.page.getByTestId("play-notes-button")).toHaveCount(0);
    expect(await noteTitles(w.b, sid)).toEqual([]);
    await w.a.page.getByTestId("play-notes-button").click();
    await w.a.page.getByTestId("play-note-item").click();
    await expect(w.a.page.getByTestId("play-notes")).toContainText("Contenu de la lettre");
    // The pin linked to the shared note is now visible, with its note.
    expect((await playerObjects(w.a, sid)).some((o: any) => o.uid === ids.pinShared)).toBe(true);
    expect((await playerObjects(w.b, sid)).some((o: any) => o.uid === ids.pinShared)).toBe(false);
    // The open note goes back to the list when it is hidden.
    await act(w.gm, sid, [{ type: "note.share", note_uid: ids.sharedNote, audience: "all" }]);
    await expect(count(w.b.page)).toHaveText("1", { timeout: 20_000 });
    await act(w.gm, sid, [{ type: "note.share", note_uid: ids.sharedNote, audience: "gm" }]);
    await expect(w.b.page.getByTestId("play-notes-button")).toHaveCount(0, { timeout: 20_000 });
    await expect(w.a.page.getByTestId("play-notes-button")).toHaveCount(0, { timeout: 20_000 });
    expect((await playerObjects(w.a, sid)).some((o: any) => o.uid === ids.pinShared)).toBe(false);
    expect(await w.screen.page.content()).not.toContain("Contenu de la lettre");
  } finally {
    await w.close();
  }
});

test("3. reading: the GM reads a note aloud; the audience is unchanged and HTML stays text", async ({ browser }) => {
  test.setTimeout(240_000);
  const w = await build(browser);
  try {
    const page = w.gm.page;
    await page.getByTestId("panel-tab-notes").click();
    const row = page.locator(`[data-testid="map-note"][data-uid="${ids.readNote}"]`);
    await expect(row).toHaveAttribute("data-audience", "gm");
    await row.getByTestId("map-note-read").click();
    for (const p of [w.a.page, w.b.page]) {
      await expect(p.getByTestId("play-readaloud")).toBeVisible({ timeout: 20_000 });
      await expect(p.getByTestId("play-readaloud")).toContainText("Gras");
      await expect(p.getByTestId("play-readaloud").locator("img")).toHaveCount(0);
      expect(await p.evaluate(() => (window as any).__xss)).toBeUndefined();
    }
    await expect(w.screen.page.getByTestId("display-read-aloud")).toBeVisible({ timeout: 20_000 });
    expect(await w.screen.page.evaluate(() => (window as any).__xss)).toBeUndefined();
    await expect(row).toHaveAttribute("data-audience", "gm");
    expect(await noteTitles(w.a, w.session.id)).toEqual([]);
  } finally {
    await w.close();
  }
});

test("4. zone: entering suggests to the GM only, nothing is read before the click", async ({ browser }) => {
  test.setTimeout(240_000);
  const w = await build(browser);
  try {
    const sid = w.session.id;
    const res = await act(w.a, sid, [{ type: "token.move", uid: w.pcA, x: 2.5, y: 2.5 }]);
    expect(res.results[0]?.ok, JSON.stringify(res.results[0])).toBe(true);
    const suggestion = w.gm.page.getByTestId("zone-suggestion");
    await expect(suggestion).toHaveCount(1, { timeout: 20_000 });
    await w.gm.page.waitForTimeout(1500);
    for (const p of [w.a.page, w.b.page]) {
      await expect(p.getByTestId("zone-suggestion")).toHaveCount(0);
      await expect(p.getByTestId("play-readaloud")).toHaveCount(0);
    }
    await expect(w.screen.page.getByTestId("display-read-aloud")).toHaveCount(0);
    await w.gm.page.getByTestId("zone-read").click();
    await expect(w.b.page.getByTestId("play-readaloud")).toBeVisible({ timeout: 20_000 });
    await expect(suggestion).toHaveCount(0);
  } finally {
    await w.close();
  }
});

test("5. reveal: trap and passage appear when revealed and hide again after a reset", async ({ browser }) => {
  test.setTimeout(240_000);
  const w = await build(browser);
  try {
    const sid = w.session.id;
    const page = w.gm.page;
    const crossing = async (to: number): Promise<boolean> => {
      const r = await act(w.a, sid, [{ type: "token.move", uid: w.pcA, x: to, y: 5.5 }]);
      return r.results[0]?.ok === true;
    };
    // Before: the passage blocks.
    expect(await crossing(8.5)).toBe(false);
    await page.getByTestId("panel-tab-reveal").click();
    await page.locator(`[data-testid="secret-row"][data-uid="${ids.trap}"]`).getByTestId("secret-reveal").click();
    await page.locator(`[data-testid="secret-row"][data-uid="${ids.passage}"]`).getByTestId("secret-reveal").click();
    await expect.poll(async () => (await playerObjects(w.a, sid)).find((o: any) => o.uid === ids.trap)?.type, { timeout: 20_000 }).toBe("trap");
    expect(JSON.stringify(await screenSnapshot(w))).toContain(ids.trap);
    expect((await playerObjects(w.a, sid)).find((o: any) => o.uid === ids.passage)?.type).toBe("secret");
    expect(await crossing(8.5)).toBe(true);
    // Reset: hidden and blocking again.
    await postOps(w.gm, w.map, [{ type: "secrets.reset" }]);
    await expect.poll(async () => (await playerObjects(w.a, sid)).find((o: any) => o.uid === ids.passage)?.type, { timeout: 20_000 }).toBe("wall");
    expect((await playerObjects(w.a, sid)).some((o: any) => o.uid === ids.trap)).toBe(false);
    expect(await crossing(4.5)).toBe(false);
    expect(await w.a.page.content()).not.toContain("CANARI");
  } finally {
    await w.close();
  }
});
