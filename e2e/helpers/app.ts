import { expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { admin } from './env';

/** Signed-in header: the user name next to the "Déconnexion" button. */
export async function expectSignedIn(page: Page, username: string): Promise<void> {
  await expect(page.getByRole('button', { name: 'Déconnexion' })).toBeVisible();
  await expect(page.locator('header.topbar .user')).toHaveText(username);
}

/** Login form of the SPA (/login). Does not wait for the result. */
export async function submitLogin(
  page: Page,
  identifier: string,
  password: string,
  remember = false,
): Promise<void> {
  if (!new URL(page.url()).pathname.endsWith('/login')) await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  await page.locator('input[name="identifier"]').fill(identifier);
  await page.locator('input[name="password"]').fill(password);
  if (remember) await page.getByLabel('Se souvenir de moi').check();
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

export async function login(page: Page, identifier: string, password: string, username = identifier): Promise<void> {
  await submitLogin(page, identifier, password);
  await expectSignedIn(page, username);
}

export async function loginAsAdmin(page: Page): Promise<void> {
  await login(page, admin.email, admin.password, admin.username);
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Déconnexion' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Déconnexion' })).toHaveCount(0);
}

/**
 * Admin session on the REST API (projet.md 9), for test set-up and tear-down only
 * (the behaviours under test go through the UI). CSRF token from GET /auth/me, renewed at login.
 */
export class AdminApi {
  private constructor(
    private readonly ctx: APIRequestContext,
    private csrf: string,
  ) {}

  static async open(baseURL: string): Promise<AdminApi> {
    const ctx = await request.newContext({ baseURL });
    const me = await ctx.get('/api/v1/auth/me');
    expect(me.ok()).toBeTruthy();
    const api = new AdminApi(ctx, (await me.json()).data.csrf as string);
    const res = await api.send('post', '/auth/login', {
      identifier: admin.email,
      password: admin.password,
      remember: false,
    });
    api.csrf = res.data.csrf as string;
    return api;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async send(method: 'get' | 'post' | 'patch' | 'delete', path: string, data?: unknown): Promise<any> {
    const res = await this.ctx.fetch(`/api/v1${path}`, {
      method: method.toUpperCase(),
      headers: { 'X-CSRF-Token': this.csrf, Accept: 'application/json' },
      ...(data !== undefined ? { data } : {}),
    });
    const body = res.status() === 204 ? null : await res.json();
    expect(res.ok(), `${method.toUpperCase()} ${path} -> ${res.status()} ${JSON.stringify(body)}`).toBeTruthy();
    return body;
  }

  async setRegistrationMode(mode: 'open' | 'closed' | 'invite'): Promise<void> {
    await this.send('patch', '/admin/settings', { registration_mode: mode });
  }

  async close(): Promise<void> {
    await this.ctx.dispose();
  }
}
