import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { AdminApi, login } from "../helpers/app";
import { resetRateLimits } from "../helpers/db";
import { main, unique, userPassword } from "../helpers/env";

/**
 * P6f (projet.md 18.1 p.7-8): a player joins a session by code, sees the lobby (players, assigned
 * token, preload bar, ready), then the game view once the GM starts; a wall stops her token (D8),
 * a note read aloud, the pause screen, the reload. The GM side is driven through the API.
 * Without WebGPU / WebGL 2 in the headless browser the token is moved through the player's
 * session actions instead of dragging on the canvas (the rest of the scenario is unchanged).
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

interface Me {
  csrf: string;
  id: string;
}

async function me(page: Page): Promise<Me> {
  const res = await page.request.get("/api/v1/auth/me");
  expect(res.ok()).toBeTruthy();
  const data = (await res.json()).data;
  return { csrf: data.csrf as string, id: String(data.user.id) };
}

const uid = (): string => randomUUID().replace(/-/g, "").slice(0, 21);

test("a player goes from the lobby to the game view; a wall blocks her token", async ({ page, browser }) => {
  const gmName = await createUser("Maitre");
  const playerName = await createUser("Joueuse");
  const errors = watchErrors(page);
  await login(page, gmName, userPassword);
  const gm = await me(page);
  const headers = { "X-CSRF-Token": gm.csrf, Accept: "application/json" };

  const context = await browser.newContext({ baseURL: main.baseURL, locale: "fr-FR" });
  const guest = await context.newPage();
  const guestErrors = watchErrors(guest);
  try {
    await login(guest, playerName, userPassword);
    const player = await me(guest);
    const playerHeaders = { "X-CSRF-Token": player.csrf, Accept: "application/json" };

    // Set-up through the API: game, member, map with a wall, a token assigned to the player.
    const game = await page.request.post("/api/v1/games", { headers, data: { name: unique("Donjon ") } });
    expect(game.ok(), await game.text()).toBeTruthy();
    const gameId = (await game.json()).data.id as string;
    const member = await page.request.post(`/api/v1/games/${gameId}/members`, {
      headers,
      data: { identifier: playerName, role: "player" },
    });
    expect(member.ok(), await member.text()).toBeTruthy();
    const created = await page.request.post(`/api/v1/games/${gameId}/maps`, {
      headers,
      data: { name: "Salle", width: 14, height: 10 },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const mapId = (await created.json()).data.id as string;
    const detail = (await (await page.request.get(`/api/v1/maps/${mapId}`)).json()).data;
    const floor = detail.floors[0].id as string;
    const token = await page.request.post(`/api/v1/games/${gameId}/tokens`, {
      headers,
      data: {
        name: "Aria",
        asset_id: null,
        kind: "pc",
        size_w: 1,
        size_h: 1,
        default_owner_user_id: null,
        vision: { enabled: true, range: 10, dark: 0 },
        light: null,
        ring_color: null,
      },
    });
    expect(token.ok(), await token.text()).toBeTruthy();
    const tokenId = (await token.json()).data.id as string;
    const placedUid = uid();
    const ops = await page.request.post(`/api/v1/maps/${mapId}/ops`, {
      headers,
      data: {
        base_revision: detail.revision,
        client_op_id: uid(),
        ops: [
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
                  [7, 0],
                  [7, 10],
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
          {
            type: "maptoken.add",
            token: {
              uid: placedUid,
              floor,
              token_id: tokenId,
              x: 3.5,
              y: 5.5,
              rotation: 0,
              scale: 1,
              hidden: false,
              light_override: null,
              rev: 1,
            },
          },
        ],
      },
    });
    expect(ops.ok(), await ops.text()).toBeTruthy();
    const sessionRes = await page.request.post(`/api/v1/games/${gameId}/sessions`, {
      headers,
      data: { name: "Séance test", map_id: mapId },
    });
    expect(sessionRes.ok(), await sessionRes.text()).toBeTruthy();
    const session = (await sessionRes.json()).data;
    const sessionId = session.id as string;
    const code = session.code as string;
    // The player joins by code: the lobby.
    await guest.goto("/join");
    await guest.getByTestId("join-code").fill(code);
    await guest.getByTestId("join-submit").click();
    await expect(guest).toHaveURL(new RegExp(`/sessions/${sessionId}$`));
    await expect(guest.getByTestId("play-lobby")).toBeVisible();

    // The GM assigns the token to her (the player must be in the session).
    const assign = await page.request.put(`/api/v1/sessions/${sessionId}/assignments/${tokenId}`, {
      headers,
      data: { user_id: player.id },
    });
    expect(assign.ok(), await assign.text()).toBeTruthy();
    await expect(guest.getByTestId("play-player")).toContainText(playerName);
    await expect(guest.getByTestId("play-token")).toHaveCount(1);
    await expect(guest.getByTestId("play-progress")).toHaveAttribute("data-status", "done", { timeout: 20_000 });
    await expect(guest.getByTestId("play-ready")).toBeChecked({ timeout: 20_000 });
    await expect(guest.getByTestId("play-waiting")).toBeVisible();
    for (const id of ["session-start", "session-pause", "session-code"]) {
      await expect(guest.getByTestId(id)).toHaveCount(0);
    }

    // The GM starts: the game view.
    const start = await page.request.post(`/api/v1/sessions/${sessionId}/start`, { headers, data: {} });
    expect(start.ok(), await start.text()).toBeTruthy();
    const viewport = guest.getByTestId("play-viewport");
    await expect(guest.getByTestId("play-view")).toBeVisible({ timeout: 20_000 });
    await expect(viewport).toHaveAttribute("data-scene", "ready", { timeout: 20_000 });
    await expect(viewport).toHaveAttribute("data-state", /^(ready|unsupported|error)$/, { timeout: 30_000 });
    await expect(guest.getByTestId("network-indicator")).toBeVisible();

    const tokenX = async (): Promise<number> => {
      const snap = await page.request.get(`/api/v1/sessions/${sessionId}/snapshot`);
      expect(snap.ok(), await snap.text()).toBeTruthy();
      const placed = (await snap.json()).data.map.tokens_placed.find((t: { uid: string }) => t.uid === placedUid);
      return placed.x as number;
    };

    // The token goes through the wall (x = 7): the server keeps it on this side (D8).
    if ((await viewport.getAttribute("data-state")) === "ready") {
      await guest.waitForTimeout(1000);
      const box = (await viewport.boundingBox())!;
      const zoom = Number(await viewport.getAttribute("data-zoom"));
      const cell = Number(await viewport.getAttribute("data-cell-px")) * zoom;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await guest.mouse.move(cx, cy);
      await guest.mouse.down();
      await guest.mouse.move(cx + cell * 2, cy, { steps: 6 });
      await guest.mouse.move(cx + cell * 5, cy, { steps: 10 });
      await guest.mouse.up();
    } else {
      const moved = await guest.request.post(`/api/v1/sessions/${sessionId}/actions`, {
        headers: playerHeaders,
        data: { actions: [{ type: "token.move", uid: placedUid, x: 8.5, y: 5.5 }] },
      });
      expect(moved.ok(), await moved.text()).toBeTruthy();
    }
    await expect.poll(tokenX, { timeout: 20_000 }).toBeGreaterThan(3.6);
    await guest.waitForTimeout(1500);
    expect(await tokenX()).toBeLessThan(7);

    // A text read aloud by the GM.
    const note = await page.request.post(`/api/v1/sessions/${sessionId}/actions`, {
      headers,
      data: { actions: [{ type: "note.show", title: "Rumeur", body: "Une porte grince au loin." }] },
    });
    expect(note.ok(), await note.text()).toBeTruthy();
    const dialog = guest.getByRole("dialog");
    await expect(dialog).toContainText("Une porte grince au loin.", { timeout: 20_000 });
    await dialog.getByRole("button", { name: "Fermer" }).last().click();
    await expect(dialog).toBeHidden();

    // Pause, then resume.
    const pause = await page.request.post(`/api/v1/sessions/${sessionId}/pause`, { headers, data: {} });
    expect(pause.ok(), await pause.text()).toBeTruthy();
    await expect(guest.getByTestId("play-pause")).toBeVisible({ timeout: 20_000 });
    const resume = await page.request.post(`/api/v1/sessions/${sessionId}/resume`, { headers, data: {} });
    expect(resume.ok(), await resume.text()).toBeTruthy();
    await expect(guest.getByTestId("play-view")).toBeVisible({ timeout: 20_000 });
    await expect(viewport).toHaveAttribute("data-scene", "ready", { timeout: 20_000 });

    // Reload: the view and the token come back.
    await guest.reload();
    await expect(guest.getByTestId("play-view")).toBeVisible({ timeout: 30_000 });
    await expect(guest.getByTestId("play-viewport")).toHaveAttribute("data-scene", "ready", { timeout: 20_000 });
    expect(await tokenX()).toBeLessThan(7);

    // End: the "ended" screen.
    const end = await page.request.post(`/api/v1/sessions/${sessionId}/end`, { headers, data: {} });
    expect(end.ok(), await end.text()).toBeTruthy();
    await expect(guest.getByTestId("play-ended")).toBeVisible({ timeout: 20_000 });
    expect(guestErrors).toEqual([]);
  } finally {
    await context.close();
  }
  expect(errors).toEqual([]);
});
