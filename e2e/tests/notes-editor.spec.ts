import { expect, test, type Page } from "@playwright/test";
import { resetRateLimits } from "../helpers/db";
import { main } from "../helpers/env";
import { createGame, createMap, openUser, watchErrors, type Actor, type MapRef } from "../helpers/sessions";
import { editorTab } from "../helpers/editor";

/**
 * P9b2a: notes, pins, zones, traps and secrets in the map editor. The editor is driven through the
 * page (Markdown dialog, tools on the viewport, panel buttons); the server state is read back
 * with the API.
 */

test.beforeEach(() => {
  resetRateLimits(main.dbName);
});

async function detail(gm: Actor, mapId: string): Promise<any> {
  const res = await gm.request.get(`/api/v1/maps/${mapId}`);
  expect(res.ok(), `GET map -> ${res.status()}`).toBeTruthy();
  return (await res.json()).data;
}

const saved = (page: Page) =>
  expect(page.getByTestId("save-status")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });

async function openEditor(gm: Actor, gameId: string, map: MapRef, browserName: string): Promise<void> {
  const page = gm.page;
  await page.goto(`/games/${gameId}/maps/${map.id}/edit`);
  const viewport = page.getByTestId("editor-viewport");
  await expect(viewport).toHaveAttribute("data-state", /^(ready|unsupported|error)$/, { timeout: 30_000 });
  test.skip((await viewport.getAttribute("data-state")) === "unsupported", `${browserName}: no WebGPU / WebGL 2`);
  await expect(viewport).toHaveAttribute("data-state", "ready");
  await saved(page);
}

test("notes: Markdown dialog, pins, zone, trap and secret passage, delete and undo, reset", async ({
  browser,
  browserName,
}) => {
  test.setTimeout(240_000);
  const gm = await openUser(browser, "mj-notes", { hook: false });
  const page = gm.page;
  const errors = watchErrors(page);
  try {
    const gameId = await createGame(gm, []);
    const map = await createMap(gm, gameId, 30, 20);
    await openEditor(gm, gameId, map, browserName);
    const dialog = page.getByTestId("note-dialog");

    // 1. A note written with the toolbar; the body is shown as text, never as HTML.
    await editorTab(page, "notes");
    await page.getByTestId("note-add").click();
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="title"]').fill("Auberge du Cerf");
    const input = dialog.getByTestId("md-input");
    await input.fill("Bienvenue");
    await input.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, el.value.length));
    await dialog.getByTestId("md-bold").click();
    await expect(input).toHaveValue("**Bienvenue**");
    await input.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
    await input.pressSequentially('\n\n<img src=x onerror="window.__xss = 1">');
    const preview = dialog.getByTestId("md-preview");
    if (await preview.isVisible()) await preview.click();
    const rendered = dialog.getByTestId("md-rendered");
    await expect(rendered).toBeVisible();
    await expect(rendered.locator("strong")).toHaveText("Bienvenue");
    await expect(rendered).toContainText("<img src=x onerror=");
    await expect(rendered.locator("img")).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
    await dialog.getByTestId("note-save").click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("note-list").locator("li")).toHaveCount(1);
    await saved(page);
    let d = await detail(gm, map.id);
    expect(d.notes).toHaveLength(1);
    expect(d.notes[0]).toMatchObject({
      title: "Auberge du Cerf",
      audience: "gm",
      read_aloud: false,
    });
    expect(d.notes[0].body).toContain("**Bienvenue**");
    const noteUid = d.notes[0].uid as string;

    // 2. Tools: a pin linked to the note, a zone, a trap, a secret passage.
    const viewport = page.getByTestId("editor-viewport");
    const box = (await viewport.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const click = async (x: number, y: number) => {
      await page.mouse.click(x, y);
    };

    await page.getByTestId("tool-pin").click();
    await page.getByTestId("pin-note").selectOption({ label: "Auberge du Cerf" });
    await click(cx - 150, cy - 80);

    await page.getByTestId("tool-zone").click();
    await click(cx + 40, cy - 90);
    await click(cx + 160, cy - 90);
    await page.mouse.dblclick(cx + 160, cy);

    await page.getByTestId("tool-trap").click();
    await click(cx - 120, cy + 70);

    await page.getByTestId("tool-secret").click();
    await click(cx - 40, cy + 100);
    await click(cx + 60, cy + 100);
    await saved(page);

    await page.reload();
    await expect(viewport).toHaveAttribute("data-state", "ready", {
      timeout: 30_000,
    });
    d = await detail(gm, map.id);
    const byType = (type: string) => d.objects.filter((o: any) => o.type === type);
    expect(byType("pin")).toHaveLength(1);
    expect(byType("pin")[0].props.note).toBe(noteUid);
    expect(byType("pin")[0].layer).not.toBe("gm");
    expect(byType("zone")).toHaveLength(1);
    expect(byType("zone")[0]).toMatchObject({ layer: "gm", visibility: "gm" });
    expect(byType("zone")[0].geometry.polygon.length).toBeGreaterThanOrEqual(3);
    expect(byType("trap")).toHaveLength(1);
    expect(byType("trap")[0].visibility).toBe("hidden_until_revealed");
    expect(byType("secret")).toHaveLength(1);
    expect(byType("secret")[0]).toMatchObject({
      layer: "walls",
      props: { kind: "passage" },
    });
    const objectCount = d.objects.length;
    await editorTab(page, "notes");
    await expect(page.getByTestId("note-list").locator("li")).toHaveCount(1);

    // 3. Delete the note (the confirmation counts the linked pin), then undo.
    await page.getByTestId("note-list").getByRole("button", { name: "Auberge du Cerf" }).click();
    await page.getByTestId("note-delete").click();
    await page.getByTestId("note-delete-confirm").click();
    await expect(page.getByTestId("note-list")).toHaveCount(0);
    await saved(page);
    d = await detail(gm, map.id);
    expect(d.notes).toHaveLength(0);
    expect(d.objects.find((o: any) => o.type === "pin").props.note).toBeNull();

    await page.getByTestId("editor-undo").click();
    await expect(page.getByTestId("note-list").locator("li")).toHaveCount(1);
    await saved(page);
    d = await detail(gm, map.id);
    expect(d.notes).toHaveLength(1);
    expect(d.notes[0].uid).toBe(noteUid);
    expect(d.objects.find((o: any) => o.type === "pin").props.note).toBe(noteUid);

    // 4. Reset of the traps and secrets: confirmation, then the map stays saved and complete.
    await editorTab(page, "notes");
    await page.getByTestId("secrets-reset").click();
    await page.getByTestId("secrets-reset-confirm").click();
    await saved(page);
    d = await detail(gm, map.id);
    expect(d.objects).toHaveLength(objectCount);
    expect(d.notes).toHaveLength(1);

    expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
  } finally {
    await gm.context?.close();
  }
});
