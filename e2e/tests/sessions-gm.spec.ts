import { expect, test, type Page } from "@playwright/test";
import { AdminApi, login } from "../helpers/app";
import { resetRateLimits } from "../helpers/db";
import { main, unique, userPassword } from "../helpers/env";

/**
 * P6e (projet.md 18.1 p.3 and p.6): the GM creates a session from the "Séances" tab, sees the
 * code (copyable), a player joins with it from /join and shows in the "Joueurs" panel; the GM
 * starts, pauses, resumes and ends the session. The player sees no GM control.
 * Controls are found through data-testid.
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

async function csrfOf(page: Page): Promise<string> {
  const me = await page.request.get("/api/v1/auth/me");
  expect(me.ok()).toBeTruthy();
  return (await me.json()).data.csrf as string;
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

test("GM drives a session; a player joins by code and has no GM control", async ({ page, browser }) => {
  const gm = await createUser("Maitre");
  const player = await createUser("Joueuse");
  const errors = watchErrors(page);
  await login(page, gm, userPassword);

  // A game with a minimal map and the player as a member (set-up through the API).
  const headers = { "X-CSRF-Token": await csrfOf(page), Accept: "application/json" };
  const game = await page.request.post("/api/v1/games", { headers, data: { name: unique("Crypte ") } });
  expect(game.ok(), await game.text()).toBeTruthy();
  const gameId = (await game.json()).data.id as string;
  const map = await page.request.post(`/api/v1/games/${gameId}/maps`, {
    headers,
    data: { name: "Salle", width: 12, height: 10 },
  });
  expect(map.ok(), await map.text()).toBeTruthy();
  const member = await page.request.post(`/api/v1/games/${gameId}/members`, {
    headers,
    data: { identifier: player, role: "player" },
  });
  expect(member.ok(), await member.text()).toBeTruthy();

  // "Séances" tab: empty, then "Nouvelle séance".
  await page.goto(`/games/${gameId}?tab=sessions`);
  await expect(page.getByTestId("sessions-empty")).toBeVisible();
  await page.getByTestId("new-session").click();
  await page.getByTestId("new-session-submit").click();
  await expect(page).toHaveURL(/\/sessions\/\d+$/);
  const sessionPath = new URL(page.url()).pathname;

  // Console: code displayed (XXXX-XXXX) and copyable, lobby state, GM controls.
  await expect(page.getByTestId("session-console")).toBeVisible();
  const code = ((await page.getByTestId("session-code").textContent()) ?? "").trim();
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await expect(page.getByTestId("session-code-copy")).toBeVisible();
  await expect(page.getByTestId("session-state")).toHaveAttribute("data-state", "lobby");
  await expect(page.getByTestId("players-empty")).toBeVisible();
  // The map of the session is shown (scene adapter fed, engine or not).
  await expect(page.getByTestId("console-viewport")).toHaveAttribute("data-scene", "ready");

  // The player joins by code (second browser context).
  const context = await browser.newContext({ baseURL: main.baseURL, locale: "fr-FR" });
  const guest = await context.newPage();
  try {
    await login(guest, player, userPassword);
    await guest.goto("/join");
    await guest.getByTestId("join-code").fill(code);
    await guest.getByTestId("join-submit").click();
    await expect(guest).toHaveURL(new RegExp(`${sessionPath}$`));
    await expect(guest.getByTestId("session-player")).toBeVisible();
    for (const id of ["session-start", "session-pause", "session-resume", "session-end", "session-code"]) {
      await expect(guest.getByTestId(id)).toHaveCount(0);
    }

    // The GM sees the player in the "Joueurs" panel (the presence arrives through the events).
    await expect(page.getByTestId("player-row")).toHaveCount(1, { timeout: 20_000 });
    await expect(page.getByTestId("player-row")).toContainText(player);
  } finally {
    await context.close();
  }

  // Start, pause, resume, end.
  const state = page.getByTestId("session-state");
  await page.getByTestId("session-start").click();
  await expect(state).toHaveAttribute("data-state", "running");
  await page.getByTestId("session-pause").click();
  await expect(state).toHaveAttribute("data-state", "paused");
  await page.getByTestId("session-resume").click();
  await expect(state).toHaveAttribute("data-state", "running");
  await page.getByTestId("session-end").click();
  await page.getByRole("dialog").getByRole("button").last().click();
  await expect(state).toHaveAttribute("data-state", "ended");
  await expect(page.getByTestId("session-start")).toHaveCount(0);

  // The game's "Séances" tab lists it as ended: a new one can be created again.
  await page.goto(`/games/${gameId}?tab=sessions`);
  await expect(page.getByTestId("session-item")).toHaveAttribute("data-state", "ended");
  await expect(page.getByTestId("new-session")).toBeEnabled();
  expect(errors).toEqual([]);
});
