import { deflateRawSync, inflateRawSync } from "node:zlib";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginAsAdmin } from "../helpers/app";
import { resetRateLimits } from "../helpers/db";
import { main } from "../helpers/env";
import {
  createGame,
  createMap,
  createTokenDef,
  openUser,
  placeOp,
  postOps,
  uid,
  type Actor,
  type MapRef,
} from "../helpers/sessions";

/**
 * P9c1: map templates. A prepared map (token, fog, shared note, revealed trap) is saved from its
 * card in the Maps tab, then a new map is made from that template through the picker: no token,
 * no fog, note for the GM alone, trap not revealed. The four built-in templates are listed and the
 * tavern gives a map with tiles. Visibility between GMs (private / site) and deletion are checked.
 * Written, not run by the author: the orchestrator runs it.
 */

test.beforeEach(() => {
  resetRateLimits(main.dbName);
});

const LAYERS = ["ground", "terrain", "decor"];

async function data(actor: Actor, path: string): Promise<any> {
  const res = await actor.request.get(`/api/v1${path}`);
  expect(res.ok(), `GET ${path} -> ${res.status()}`).toBeTruthy();
  return (await res.json()).data;
}

/** Number of painted cells of a map (all layers, all floors). */
async function paintedCells(actor: Actor, mapId: string): Promise<number> {
  const res = await actor.request.get(`/api/v1/maps/${mapId}/chunks`);
  expect(res.ok()).toBeTruthy();
  const bytes = Buffer.from(await res.body());
  let count = 0;
  let o = 0;
  while (o < bytes.length) {
    expect(LAYERS[bytes.readUInt8(o + 4)]).toBeDefined();
    const len = bytes.readUInt32LE(o + 5);
    const raw = inflateRawSync(bytes.subarray(o + 9, o + 9 + len));
    for (let i = 8; i < raw.length; i += 4) if (raw.readUInt16LE(i) !== 0) count++;
    o += 9 + len;
  }
  return count;
}

async function openAdmin(browser: Browser): Promise<Actor> {
  const context = await browser.newContext({ baseURL: main.baseURL, locale: "fr-FR" });
  const page = await context.newPage();
  await loginAsAdmin(page);
  const me = (await (await page.request.get("/api/v1/auth/me")).json()).data;
  return {
    csrf: me.csrf,
    id: String(me.user.id),
    name: me.user.username,
    page,
    context,
    headers: { "X-CSRF-Token": me.csrf, Accept: "application/json" },
    request: page.request,
  };
}

async function openMapsTab(page: Page, gameId: string): Promise<void> {
  await page.goto(`/games/${gameId}`);
  await expect(page.getByTestId("map-from-template")).toBeVisible();
}

async function listTemplates(actor: Actor): Promise<any[]> {
  return data(actor, "/templates");
}

/** A map with a token, fog, a note shared with everybody and a revealed trap. */
async function busyMap(gm: Actor, gameId: string): Promise<MapRef> {
  const map = await createMap(gm, gameId, 16, 12);
  const token = await createTokenDef(gm, gameId, "Aria", 8, "pc");
  const full = Buffer.alloc(2048, 0xff);
  await postOps(gm, map, [
    { type: "note.add", note: { uid: "n1", title: "Indice", body: "Sous la dalle.", audience: "all" } },
    {
      type: "object.add",
      object: {
        uid: "trap1", floor: map.floor, type: "trap", layer: "props", visibility: "hidden_until_revealed",
        locked: false, sort_order: 0, rev: 1, geometry: { x: 5.5, y: 5.5 }, props: { note: "n1", reveal_effect: "pulse" },
      },
    },
    placeOp(map.floor, uid(), token, [3.5, 3.5]),
    { type: "fog.reveal", floor: map.floor, chunks: [[0, 0, deflateRawSync(full).toString("base64")]] },
  ]);
  return map;
}

test("save a map as a template, then create a map from it", async ({ browser }) => {
  const gm = await openUser(browser, "gm-tpl", { hook: false });
  try {
    const gameId = await createGame(gm, []);
    const source = await busyMap(gm, gameId);
    await openMapsTab(gm.page, gameId);

    const card = gm.page.locator(`[data-testid="map-card"][data-map-id="${source.id}"]`);
    await card.getByTestId("map-save-template").click();
    const form = gm.page.getByTestId("template-save-form");
    await form.locator('input[name="name"]').fill("Ma crypte piégée");
    await expect(form.locator('select[name="scope"]')).toHaveCount(0); // admins only
    await gm.page.getByTestId("template-save").click();
    await expect(form).toBeHidden();

    const mine = (await listTemplates(gm)).filter((t) => t.name === "Ma crypte piégée");
    expect(mine).toHaveLength(1);
    expect(mine[0].scope).toBe("private");

    await gm.page.getByTestId("map-from-template").click();
    const picker = gm.page.getByTestId("template-picker");
    await expect(picker.getByTestId("templates-mine").getByTestId("template-item")).toHaveCount(1);
    await picker.getByTestId("template-item").filter({ hasText: "Ma crypte piégée" }).click();
    await picker.locator('input[name="name"]').fill("Crypte du jeudi");
    await gm.page.getByTestId("template-create").click();
    await expect(gm.page).toHaveURL(new RegExp(`/games/${gameId}/maps/\\d+/edit$`));
    const mapId = new URL(gm.page.url()).pathname.split("/")[4] as string;

    const created = await data(gm, `/maps/${mapId}`);
    expect(created.name).toBe("Crypte du jeudi");
    expect(created.tokens_placed).toHaveLength(0);
    const note = created.notes.find((n: any) => n.uid === "n1");
    expect(note.audience).toBe("gm");
    const trap = created.objects.find((o: any) => o.uid === "trap1");
    expect(trap).toBeDefined();
    expect(trap.visibility).toBe("hidden_until_revealed");
    // The source keeps its token and its shared note. (Fog has no read route: it is covered by PHPUnit.)
    const sourceNow = await data(gm, `/maps/${source.id}`);
    expect(sourceNow.tokens_placed).toHaveLength(1);
    expect(sourceNow.notes.find((n: any) => n.uid === "n1").audience).toBe("all");
  } finally {
    await gm.context?.close();
  }
});

test("the four built-in templates are listed and the tavern has tiles", async ({ browser }) => {
  const gm = await openUser(browser, "gm-tpl-builtin", { hook: false });
  try {
    const gameId = await createGame(gm, []);
    await openMapsTab(gm.page, gameId);
    await gm.page.getByTestId("map-from-template").click();
    const shared = gm.page.getByTestId("templates-shared");
    for (const name of ["Taverne", "Crypte", "Forêt", "Grotte"]) {
      await expect(shared.getByTestId("template-item").filter({ hasText: name }).first()).toBeVisible();
    }
    // Built-in templates cannot be deleted by a simple GM.
    await expect(shared.getByTestId("template-delete")).toHaveCount(0);

    await shared.getByTestId("template-item").filter({ hasText: "Taverne" }).first().click();
    await gm.page.getByTestId("template-create").click();
    await expect(gm.page).toHaveURL(new RegExp(`/games/${gameId}/maps/\\d+/edit$`));
    const mapId = new URL(gm.page.url()).pathname.split("/")[4] as string;
    expect(await paintedCells(gm, mapId)).toBeGreaterThan(100);
    const detail = await data(gm, `/maps/${mapId}`);
    expect(detail.objects.filter((o: any) => o.type === "light").length).toBeGreaterThan(0);
    expect(detail.notes.length).toBeGreaterThan(1);
  } finally {
    await gm.context?.close();
  }
});

test("private and site templates: who sees what, and deletion", async ({ browser }) => {
  const gm = await openUser(browser, "gm-tpl-a", { hook: false });
  const other = await openUser(browser, "gm-tpl-b", { hook: false });
  const admin = await openAdmin(browser);
  try {
    const gameA = await createGame(gm, []);
    const mapA = await createMap(gm, gameA);
    const privateRes = await gm.request.post(`/api/v1/maps/${mapA.id}/save-as-template`, {
      headers: gm.headers,
      data: { name: "Privé de A", scope: "private" },
    });
    expect(privateRes.status()).toBe(201);
    const privateId = String((await privateRes.json()).data.id);
    // A GM cannot share with the site.
    const refused = await gm.request.post(`/api/v1/maps/${mapA.id}/save-as-template`, {
      headers: gm.headers,
      data: { name: "Pour tous", scope: "site" },
    });
    expect(refused.status()).toBe(403);

    const adminGame = await createGame(admin, []);
    const adminMap = await createMap(admin, adminGame);
    await openMapsTab(admin.page, adminGame);
    const card = admin.page.locator(`[data-testid="map-card"][data-map-id="${adminMap.id}"]`);
    await card.getByTestId("map-save-template").click();
    const form = admin.page.getByTestId("template-save-form");
    await form.locator('input[name="name"]').fill("Commun du site");
    await form.locator('select[name="scope"]').selectOption("site");
    await admin.page.getByTestId("template-save").click();
    await expect(form).toBeHidden();

    const seenByOther = (await listTemplates(other)).map((t) => t.name);
    expect(seenByOther).toContain("Commun du site");
    expect(seenByOther).not.toContain("Privé de A");
    const gameB = await createGame(other, []);
    const hidden = await other.request.post(`/api/v1/templates/${privateId}/instantiate`, {
      headers: other.headers,
      data: { game_id: Number(gameB) },
    });
    expect(hidden.status()).toBe(404);

    // The other GM sees the site template but cannot delete it; A deletes the private one from the picker.
    const site = (await listTemplates(other)).find((t) => t.name === "Commun du site");
    expect(site.can_delete).toBe(false);
    expect((await other.request.delete(`/api/v1/templates/${site.id}`, { headers: other.headers })).status()).toBe(403);

    await openMapsTab(gm.page, gameA);
    await gm.page.getByTestId("map-from-template").click();
    const item = gm.page.getByTestId("templates-mine").getByTestId("template-item").filter({ hasText: "Privé de A" });
    await expect(item).toHaveCount(1);
    await gm.page.getByTestId("template-delete").click();
    await gm.page.getByTestId("template-delete-confirm").click();
    await expect(item).toHaveCount(0);
    expect((await listTemplates(gm)).map((t) => t.name)).not.toContain("Privé de A");

    // The admin deletes the site template.
    expect((await admin.request.delete(`/api/v1/templates/${site.id}`, { headers: admin.headers })).status()).toBe(204);
    expect((await listTemplates(other)).map((t) => t.name)).not.toContain("Commun du site");
  } finally {
    await gm.context?.close();
    await other.context?.close();
    await admin.context?.close();
  }
});
