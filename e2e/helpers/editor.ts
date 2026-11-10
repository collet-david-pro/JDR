import { expect, type Page } from '@playwright/test';

/** Tabs of the editor's right column (frontend/src/editor/ui/layout.ts). */
export type EditorTab = 'properties' | 'palette' | 'layers' | 'tokens' | 'notes' | 'ambient';

/** Shows a tab of the editor's right column. */
export async function editorTab(page: Page, tab: EditorTab): Promise<void> {
  const button = page.getByTestId(`editor-tab-${tab}`);
  if ((await button.getAttribute('aria-selected')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-selected', 'true');
}

/** Opens the "Affichage" menu of the editor top bar (view mode, lighting, fog, grid...). */
export async function openViewMenu(page: Page): Promise<void> {
  const button = page.getByTestId('editor-view-menu');
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
}

/** Closes the "Affichage" menu (it would cover the right of the map). */
export async function closeViewMenu(page: Page): Promise<void> {
  const button = page.getByTestId('editor-view-menu');
  if ((await button.getAttribute('aria-expanded')) === 'true') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
}
