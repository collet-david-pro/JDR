import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { resetRateLimits } from "../helpers/db";
import { main } from "../helpers/env";
import {
  createGame,
  createMap,
  createSession,
  createUser,
  openUser,
  placeOp,
  postOps,
  uid,
  watchErrors,
  type Actor,
} from "../helpers/sessions";

/**
 * A player makes a token in the generator (profile), joins a session with it; the GM sees its image
 * on the token of the game (the one placed on the map), imposes their own image, then gives the
 * player's image back. Texts are in i18n/_pending until merged: controls are found by data-testid.
 */

test.beforeAll(() => {
  resetRateLimits(main.dbName);
});

const fileUuid = (url: string | undefined): string => /\/files\/([0-9a-f-]+)/.exec(url ?? "")?.[1] ?? "";

async function tokenOf(gm: Actor, gameId: string): Promise<any> {
  const res = await gm.request.get(`/api/v1/games/${gameId}/tokens`);
  expect(res.ok(), await res.text()).toBeTruthy();
  const list = (await res.json()).data as any[];
  expect(list).toHaveLength(1);
  return list[0];
}

test("player token: create, join with it, the GM imposes their image and gives it back", async ({ browser }) => {
  const playerName = await createUser("Joueuse");
  const gm = await openUser(browser, "Maitre");
  const player = await openUser(browser, "Joueuse", { name: playerName });
  const errors = [...watchErrors(gm.page), ...watchErrors(player.page)];
  try {
    // 1. The player draws a token in the generator.
    await player.page.goto("/profile");
    await player.page.getByTestId("token-new").click();
    const generator = player.page.getByTestId("token-generator");
    await expect(generator).toBeVisible();
    await generator.locator('input[name="name"]').fill("Aria la rôdeuse");
    await expect(player.page.getByTestId("token-preview")).toBeVisible();
    await player.page.getByTestId("token-save").click();
    await expect(player.page.getByTestId("player-token-item")).toHaveCount(1);
    const mine = await player.request.get("/api/v1/me/player-tokens");
    const playerToken = (await mine.json()).data[0];
    expect(playerToken.name).toBe("Aria la rôdeuse");
    expect(playerToken.image.full).toContain("/files/");

    // 2. The GM prepares the game; the player joins the session with the token.
    const gameId = await createGame(gm, [{ name: playerName }]);
    const map = await createMap(gm, gameId);
    const gmAsset = await gm.request.post("/api/v1/assets", {
      headers: gm.headers,
      multipart: {
        kind: "token",
        file: { name: "mj.png", mimeType: "image/png", buffer: readFileSync("../tests/fixtures/uploads/valid_png_opaque.png") },
      },
    });
    expect(gmAsset.ok(), await gmAsset.text()).toBeTruthy();
    const gmAssetData = (await gmAsset.json()).data;
    const session = await createSession(gm, gameId, map.id);
    await player.page.goto(`/join/${session.code}`);
    const option = player.page.getByTestId("player-token-option");
    await expect(option).toHaveCount(1);
    await option.click();
    await player.page.getByTestId("join-submit").click();
    await expect(player.page).toHaveURL(new RegExp(`/sessions/${session.id}`));

    // 3. The game got a token definition for the player, showing the player's image.
    let def = await tokenOf(gm, gameId);
    expect(def.default_owner_user_id).toBe(player.id);
    expect(def.player_token.name).toBe("Aria la rôdeuse");
    expect(fileUuid(def.image.full)).toBe(fileUuid(playerToken.image.full));
    // The GM gives it his own image too (lower priority), places it on the map.
    const patch = await gm.request.patch(`/api/v1/tokens/${def.id}`, { headers: gm.headers, data: { asset_id: gmAssetData.id } });
    expect(patch.ok(), await patch.text()).toBeTruthy();
    await postOps(gm, map, [placeOp(map.floor, uid(), def.id, [3, 3])]);
    def = await tokenOf(gm, gameId);
    expect(fileUuid(def.image.full)).toBe(fileUuid(playerToken.image.full));
    expect(fileUuid(def.gm_image.full)).toBe(gmAssetData.uuid);

    // 4. In the token sheet the GM forces his image, then undoes it.
    await gm.page.goto(`/games/${gameId}?tab=tokens`);
    await gm.page.getByTestId("token-edit").click();
    const block = gm.page.getByTestId("player-token-block");
    await expect(block).toBeVisible();
    await block.getByRole("checkbox").check();
    await gm.page.getByRole("dialog").locator('button[type="submit"]').click();
    await expect(block).toBeHidden();
    def = await tokenOf(gm, gameId);
    expect(def.gm_image_forced).toBe(true);
    expect(fileUuid(def.image.full)).toBe(gmAssetData.uuid);

    await gm.page.getByTestId("token-edit").click();
    await gm.page.getByTestId("player-token-block").locator("label").first().click();
    await gm.page.getByRole("dialog").locator('button[type="submit"]').click();
    await expect(gm.page.getByTestId("player-token-block")).toBeHidden();
    def = await tokenOf(gm, gameId);
    expect(def.gm_image_forced).toBe(false);
    expect(fileUuid(def.image.full)).toBe(fileUuid(playerToken.image.full));
    expect(errors).toEqual([]);
  } finally {
    await gm.context?.close();
    await player.context?.close();
  }
});
