import { expect, test } from "@playwright/test";
import { AdminApi, login, loginAsAdmin } from "../helpers/app";
import { resetRateLimits } from "../helpers/db";
import { main, unique, userPassword } from "../helpers/env";

test.beforeAll(() => {
  resetRateLimits(main.dbName);
});

async function createUser(username: string): Promise<void> {
  const api = await AdminApi.open(main.baseURL);
  await api.send("post", "/admin/users", {
    email: `${username.toLowerCase()}@example.test`,
    username,
    role: "user",
    password: userPassword,
  });
  await api.close();
}

test("GM creates a game and a token, adds a player; an outsider sees nothing", async ({
  page,
  browser,
}) => {
  const player = unique("Joueur");
  const outsider = unique("Tiers");
  await createUser(player);
  await createUser(outsider);
  const gameName = unique("Crypte ");

  // GM: create the game from the dashboard.
  await loginAsAdmin(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Nouvelle partie" }).click();
  await page.locator('input[name="name"]').fill(gameName);
  await page.getByRole("button", { name: "Créer la partie" }).click();
  await expect(page).toHaveURL(/\/games\/\d+/);
  await expect(page.getByRole("heading", { name: gameName })).toBeVisible();
  const gameUrl = new URL(page.url()).pathname;

  // Token definition.
  await page.getByRole("tab", { name: "Tokens" }).click();
  await page.getByRole("button", { name: "Nouveau token" }).click();
  await page.getByRole("dialog").getByLabel(/^Nom/).fill("Garde");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Enregistrer" })
    .click();
  await expect(page.getByText("Token « Garde » enregistré.")).toBeVisible();

  // Player member.
  await page.getByRole("tab", { name: "Joueurs" }).click();
  await page.locator('input[name="identifier"]').fill(player);
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(
    page.getByText(`${player} a été ajouté à la partie.`),
  ).toBeVisible();

  // The player sees the game on the dashboard, without the GM tabs.
  const playerCtx = await browser.newContext();
  const playerPage = await playerCtx.newPage();
  await login(playerPage, player, userPassword);
  await expect(playerPage.getByText(gameName)).toBeVisible();
  await playerPage.goto(gameUrl);
  await expect(
    playerPage.getByRole("heading", { name: gameName }),
  ).toBeVisible();
  await expect(playerPage.getByRole("tab", { name: "Réglages" })).toHaveCount(
    0,
  );
  await playerCtx.close();

  // An outsider gets "not found", in the UI and on the API.
  const outsiderCtx = await browser.newContext();
  const outsiderPage = await outsiderCtx.newPage();
  await login(outsiderPage, outsider, userPassword);
  await expect(outsiderPage.getByText(gameName)).toHaveCount(0);
  await outsiderPage.goto(gameUrl);
  await expect(
    outsiderPage.getByRole("heading", { name: "Page introuvable" }),
  ).toBeVisible();
  const id = gameUrl.split("/").pop() as string;
  const res = await outsiderPage.request.get(`/api/v1/games/${id}/tokens`);
  expect(res.status()).toBe(404);
  expect(await res.text()).not.toContain("Garde");
  await outsiderCtx.close();
});
