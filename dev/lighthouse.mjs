#!/usr/bin/env node
// Lighthouse audit (P10f, projet.md 22) of the pages outside the editor: login, home, a game,
// library, administration; desktop preset then mobile (Lighthouse default), categories
// performance + accessibility + best-practices. Exits 1 when a score is under 90.
//
//   cd frontend && npm run build           # the front must be built
//   node dev/lighthouse.mjs                # starts dev/e2e-serve.sh on port 8090, installs it, audits
//   LH_BASE=http://127.0.0.1:8090 LH_EMAIL=... LH_PASSWORD=... node dev/lighthouse.mjs   # an installed site
//
// Needs e2e/node_modules (Playwright + its Chromium, used both to install the copy and as Chrome).
// Lighthouse is fetched by npx at the pinned version.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIGHTHOUSE = 'lighthouse@12.8.2';
const THRESHOLD = 90;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(root, 'e2e', 'package.json'))('@playwright/test');

const port = Number(process.env.E2E_PORT ?? 8090);
const base = process.env.LH_BASE ?? `http://127.0.0.1:${port}`;
const admin = {
  email: process.env.LH_EMAIL ?? 'mj@example.org',
  username: 'Maitre MJ',
  password: process.env.LH_PASSWORD ?? 'Tr3s-B0nne phrase secrète!',
};
const chromePath = process.env.CHROME_PATH ?? chromium.executablePath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
async function startServer() {
  server = spawn('bash', [path.join(root, 'dev', 'e2e-serve.sh')], {
    env: { ...process.env, E2E_PORT: String(port), E2E_DB_NAME: 'jdr_e2e_lh' },
    stdio: 'ignore',
    detached: false,
  });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${base}/install.php`)).status < 500) return;
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  throw new Error('the E2E server did not start');
}
function stopServer() {
  if (server && !server.killed) server.kill('SIGTERM');
}

/** Installs the blank copy through install.php, then returns the session cookie and a game id. */
async function prepare(browser) {
  const ctx = await browser.newContext({ baseURL: base, locale: 'fr-FR' });
  const page = await ctx.newPage();
  if (!process.env.LH_BASE) {
    await page.goto('/install.php');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.locator('input[name="name"]').fill('jdr_e2e_lh');
    await page.locator('input[name="host"]').fill(process.env.E2E_DB_HOST ?? '127.0.0.1');
    await page.locator('input[name="port"]').fill(process.env.E2E_DB_PORT ?? '3306');
    await page.locator('input[name="user"]').fill(process.env.E2E_DB_USER ?? 'root');
    await page.locator('input[name="pass"]').fill(process.env.E2E_DB_PASS ?? '');
    await page.locator('input[name="prefix"]').fill('jdr_');
    await page.getByRole('button', { name: 'Tester et continuer' }).click();
    await page.locator('input[name="site_name"]').fill('JDR Lighthouse');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.locator('input[name="email"]').fill(admin.email);
    await page.locator('input[name="username"]').fill(admin.username);
    await page.locator('input[name="password"]').fill(admin.password);
    await page.locator('input[name="password_confirm"]').fill(admin.password);
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('button', { name: "Lancer l'installation" }).click();
    await page.getByRole('heading', { name: 'Installation terminée' }).waitFor({ timeout: 90_000 });
  }
  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill(admin.email);
  await page.locator('input[name="password"]').fill(admin.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('button', { name: 'Déconnexion' }).waitFor();
  const me = (await (await page.request.get('/api/v1/auth/me')).json()).data;
  const res = await page.request.post('/api/v1/games', {
    headers: { 'X-CSRF-Token': me.csrf, Accept: 'application/json' },
    data: { name: 'Donjon Lighthouse' },
  });
  const game = (await res.json()).data;
  const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  await ctx.close();
  return { cookie, gameId: game.id };
}

function lighthouse(url, mobile, cookie, outFile) {
  const args = [
    '--yes', LIGHTHOUSE, url,
    '--quiet', '--output=json', `--output-path=${outFile}`,
    '--only-categories=performance,accessibility,best-practices',
    '--chrome-flags=--headless=new --no-sandbox',
  ];
  if (!mobile) args.push('--preset=desktop');
  if (cookie) args.push(`--extra-headers=${JSON.stringify({ Cookie: cookie })}`);
  const r = spawnSync('npx', args, { env: { ...process.env, CHROME_PATH: chromePath }, encoding: 'utf8' });
  if (r.status !== 0 || !existsSync(outFile)) throw new Error(`lighthouse failed on ${url}: ${r.stderr.slice(-400)}`);
  const lhr = JSON.parse(readFileSync(outFile, 'utf8'));
  const score = (k) => Math.round((lhr.categories[k]?.score ?? 0) * 100);
  return { perf: score('performance'), a11y: score('accessibility'), bp: score('best-practices') };
}

let failed = false;
process.on('exit', stopServer);
try {
  if (!process.env.LH_BASE) await startServer();
  const browser = await chromium.launch();
  const { cookie, gameId } = await prepare(browser);
  await browser.close();
  const pages = [
    ['connexion', '/login', false],
    ['accueil', '/', true],
    ['partie', `/games/${gameId}`, true],
    ['bibliothèque', '/library', true],
    ['administration', '/admin', true],
  ];
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'jdr-lh-'));
  const rows = [];
  for (const [label, p, auth] of pages) {
    for (const mobile of [false, true]) {
      const s = lighthouse(base + p, mobile, auth ? cookie : '', path.join(tmp, `${label}-${mobile}.json`));
      const bad = Object.values(s).some((v) => v < THRESHOLD);
      failed ||= bad;
      rows.push({ page: label, device: mobile ? 'mobile' : 'desktop', performance: s.perf, accessibilité: s.a11y, 'bonnes pratiques': s.bp, ok: bad ? 'NON' : 'oui' });
    }
  }
  console.table(rows);
} catch (e) {
  console.error(e.message);
  failed = true;
} finally {
  stopServer();
}
process.exit(failed ? 1 : 0);
