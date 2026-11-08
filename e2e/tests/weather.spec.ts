import { expect, test, type Page } from "@playwright/test";
import { AdminApi, login } from "../helpers/app";
import { main, unique, userPassword } from "../helpers/env";

async function gmEditor(page: Page): Promise<boolean> {
  const gm = unique("Meteo");
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
  await page.locator('input[name="name"]').fill(unique("Pluie "));
  await page.getByRole("button", { name: "Créer la partie" }).click();
  await expect(page).toHaveURL(/\/games\/\d+$/);
  await page.getByTestId("map-new").click();
  const form = page.getByTestId("map-create-form");
  await form.locator('input[name="name"]').fill("Dehors");
  await form.locator('input[name="width"]').fill("20");
  await form.locator('input[name="height"]').fill("14");
  await page.getByTestId("map-create").click();
  return editorReady(page);
}

async function editorReady(page: Page): Promise<boolean> {
  const viewport = page.getByTestId("editor-viewport");
  await expect(viewport).toHaveAttribute("data-state", /^(ready|unsupported|error)$/, {
    timeout: 30_000,
  });
  if ((await viewport.getAttribute("data-state")) === "unsupported") return false;
  await expect(viewport).toHaveAttribute("data-state", "ready");
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved", {
    timeout: 15_000,
  });
  return true;
}

async function frame(page: Page): Promise<Buffer> {
  const viewport = page.getByTestId("editor-viewport");
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(Math.max(2, box.x - 40), 2);
  await page.waitForTimeout(250);
  return viewport.screenshot();
}

test("weather: rain draws an animated layer, reduced motion freezes it", async ({
  page,
  browserName,
}) => {
  test.setTimeout(120_000);
  test.skip(!(await gmEditor(page)), `${browserName}: neither WebGPU nor WebGL 2`);

  const clear = await frame(page);
  await page.getByTestId("ambient-weather").selectOption("rain");
  await page.getByTestId("ambient-weather-intensity").fill("1");
  const a = await frame(page);
  const b = await frame(page);
  expect(a.equals(clear), "rain changes the picture").toBe(false);
  expect(a.equals(b), "rain is animated").toBe(false);

  await expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved", {
    timeout: 15_000,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  expect(await editorReady(page)).toBe(true);
  const c = await frame(page);
  const d = await frame(page);
  expect(c.equals(d), "reduced motion: static veil").toBe(true);
  expect(c.equals(clear), "reduced motion: veil still shown").toBe(false);
});
