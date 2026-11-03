#!/usr/bin/env node
// Load test (P10e, projet.md 22): N sessions x (1 GM + 5 players + 1 screen) against an isolated
// copy of the site (dev/e2e-serve.sh, database jdr_load, port 8092, 8 PHP workers like dev/serve.sh).
// Node 20+ only (fetch, no dependency). See dev/load/README.md.
//
//   lockf /tmp/jdr-build.lock node dev/load/run.mjs --transport=sse --sessions=5 [--duration=60]
//
// Cleanup (server, copy, database) runs on exit, Ctrl+C and errors.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);
const TRANSPORT = args.transport ?? 'sse'; // sse | longpoll | poll
const SESSIONS = Number(args.sessions ?? 5);
const DURATION_S = Number(args.duration ?? 60);
const WORKERS = Number(args.workers ?? 8);
const POLL_MS = Number(args['poll-ms'] ?? 2000);
const PORT = 8092;
const DB = 'jdr_load';
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const PASSWORD = 'Load-Test-Password-42';
if (!['sse', 'longpoll', 'poll'].includes(TRANSPORT)) throw new Error('--transport=sse|longpoll|poll');

const dbEnv = { ...process.env, E2E_DB_NAME: DB, E2E_PORT: String(PORT), E2E_WORKERS: String(WORKERS), LOAD_PORT: String(PORT) };
const logDir = mkdtempSync(join(tmpdir(), 'jdr-load-'));
let server = null;

// ---------------------------------------------------------------- metrics
const lat = { gmAction: [], playerAction: [], poll: [], setup: [] };
const propagation = [];
const errors = { http: 0, network: 0, timeout: 0, tooMany: 0, samples: [] };
let requests = 0;
let eventsReceived = 0;
let streamsOpened = 0;
let streamsFailed = 0;
const pct = (arr, p) => {
  if (arr.length === 0) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (n) => (Number.isNaN(n) ? '   -  ' : n.toFixed(1).padStart(7));

// ---------------------------------------------------------------- HTTP client with cookies
class Client {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
    this.csrf = null;
  }
  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  absorb(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const v = pair.slice(i + 1);
      if (v === '') this.cookies.delete(pair.slice(0, i));
      else this.cookies.set(pair.slice(0, i), v);
    }
  }
  /** Returns {status, json, ms}; never throws (errors counted). */
  async call(method, path, body, { metric, timeoutMs = 30_000 } = {}) {
    const headers = { Cookie: this.cookieHeader(), Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.csrf && method !== 'GET') headers['X-CSRF-Token'] = this.csrf;
    const t0 = performance.now();
    requests++;
    try {
      const res = await fetch(BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      this.absorb(res);
      const text = await res.text();
      const ms = performance.now() - t0;
      if (metric) metric.push(ms);
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      if (json?.data?.csrf) this.csrf = json.data.csrf;
      if (res.status === 429) errors.tooMany++;
      if (res.status >= 400) {
        errors.http++;
        if (errors.samples.length < 5) errors.samples.push(`${method} ${path} -> ${res.status} ${text.slice(0, 120)}`);
      }
      return { status: res.status, json, ms };
    } catch (e) {
      if (metric) metric.push(performance.now() - t0);
      if (e?.name === 'TimeoutError') errors.timeout++;
      else errors.network++;
      if (errors.samples.length < 5) errors.samples.push(`${method} ${path} -> ${e?.name ?? e}`);
      return { status: 0, json: null, ms: performance.now() - t0 };
    }
  }
  async bootstrap() {
    await this.call('GET', '/auth/me');
  }
  async login(username) {
    await this.bootstrap();
    const r = await this.call('POST', '/auth/login', { identifier: username, password: PASSWORD, remember: false });
    if (r.status !== 200) throw new Error(`login ${username}: ${r.status}`);
  }
}

// ---------------------------------------------------------------- server lifecycle
function sql() {
  return JSON.parse(execFileSync('php', [join(root, 'dev/load/stat.php')], { env: dbEnv, encoding: 'utf8' }));
}

async function startServer() {
  server = spawn('bash', [join(root, 'dev/e2e-serve.sh')], {
    env: { ...dbEnv, E2E_LOG_DIR: logDir },
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  });
  let stderr = '';
  server.stderr.on('data', (d) => (stderr += d));
  const pathFile = join(logDir, `site-${PORT}.path`);
  for (let i = 0; i < 100 && !existsSync(pathFile); i++) await sleep(200);
  if (!existsSync(pathFile)) throw new Error('server did not start: ' + stderr);
  const site = readFileSync(pathFile, 'utf8').trim();
  execFileSync('php', [join(root, 'dev/load/seed.php'), site, String(SESSIONS)], { env: dbEnv, stdio: ['ignore', 'inherit', 'inherit'] });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.status < 500) return;
    } catch {
      /* not yet */
    }
    await sleep(200);
  }
  throw new Error('server not answering: ' + stderr);
}

let cleaning = false;
async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  if (server && server.exitCode === null) {
    try {
      process.kill(-server.pid, 'SIGTERM'); // e2e-serve.sh traps TERM: stops PHP, removes the copy, drops the database
    } catch {
      /* gone */
    }
    await Promise.race([new Promise((r) => server.once('exit', r)), sleep(10_000)]);
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
  rmSync(logDir, { recursive: true, force: true });
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => cleanup().then(() => process.exit(130)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- scenario
const fogBitmap = () => {
  const raw = Buffer.alloc(2048);
  const cx = Math.floor(Math.random() * 28);
  const cy = Math.floor(Math.random() * 28);
  for (let sy = cy * 4; sy < cy * 4 + 16; sy++) {
    for (let sx = cx * 4; sx < cx * 4 + 16; sx++) {
      const i = sy * 128 + sx;
      raw[i >> 3] |= 0x80 >> (i & 7);
    }
  }
  return deflateRawSync(raw).toString('base64');
};

let opCounter = 0;
const opId = () => `load-${process.pid}-${++opCounter}`;
let xSeq = 0;

/** Prepares one session through the API; returns the actors. */
async function prepareSession(n) {
  const gm = new Client(`gm${n}`);
  await gm.login(`gm${n}`);
  const must = (r, what) => {
    if (r.status >= 300) throw new Error(`setup ${what}: ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`);
    return r.json.data;
  };
  const game = must(await gm.call('POST', '/games', { name: `Load ${n}` }), 'game');
  const players = [];
  for (let p = 1; p <= 5; p++) {
    must(await gm.call('POST', `/games/${game.id}/members`, { identifier: `p${n}_${p}`, role: 'player' }), 'member');
  }
  const map = must(await gm.call('POST', `/games/${game.id}/maps`, { name: 'Carte', width: 60, height: 40 }), 'map');
  const floor = map.floors[0].id;
  const defs = [];
  for (let i = 0; i < 6; i++) {
    defs.push(must(await gm.call('POST', `/games/${game.id}/tokens`, { name: i === 0 ? 'MJ' : `PJ${i}`, kind: i === 0 ? 'npc' : 'pc' }), 'token'));
  }
  const ops = defs.map((d, i) => ({
    type: 'maptoken.add',
    token: { uid: i === 0 ? 'g' : `p${i}`, floor, token_id: d.id, x: 3 + i * 2, y: 5, rotation: 0, scale: 1, hidden: false, light_override: null },
  }));
  must(await gm.call('POST', `/maps/${map.id}/ops`, { base_revision: 0, client_op_id: opId(), ops }), 'place tokens');
  const session = must(await gm.call('POST', `/games/${game.id}/sessions`, { name: 'Séance', map_id: map.id }), 'session');
  for (let p = 1; p <= 5; p++) {
    const c = new Client(`p${n}_${p}`);
    await c.login(`p${n}_${p}`);
    must(await c.call('POST', '/sessions/join', { code: session.code }), 'join');
    players.push({ client: c, uid: `p${p}`, defId: defs[p].id });
  }
  return { n, gm, game, map, floor, session, defs, players, display: null };
}

async function finishSession(s) {
  const me = async (c) => (await c.call('GET', '/auth/me')).json.data;
  for (const p of s.players) {
    p.userId = (await me(p.client)).user?.id ?? (await me(p.client)).id;
    const r = await s.gm.call('PUT', `/sessions/${s.session.id}/assignments/${p.defId}`, { user_id: String(p.userId) });
    if (r.status >= 300) throw new Error('assign ' + r.status);
  }
  const st = await s.gm.call('POST', `/sessions/${s.session.id}/start`);
  if (st.status >= 300) throw new Error('start ' + st.status + JSON.stringify(st.json));
  const d = await s.gm.call('POST', `/sessions/${s.session.id}/displays`, { name: 'Écran' });
  if (d.status >= 300) throw new Error('display ' + d.status + JSON.stringify(d.json));
  const screen = new Client(`screen${s.n}`);
  await screen.bootstrap();
  const pr = await screen.call('POST', '/display/pair', { code: d.json.data.pairing.code });
  if (pr.status >= 300) throw new Error('pair ' + pr.status + JSON.stringify(pr.json));
  screen.isDisplay = true;
  s.display = screen;
}

// ---- listeners
const pending = new Map(); // "x" -> send time (performance.now) for GM moves
function onEvent(ev) {
  eventsReceived++;
  if (ev.type !== 'maptoken.moved') return;
  const m = JSON.stringify(ev.payload ?? ev).match(/"x":(\d+\.\d{3})/);
  if (!m) return;
  const t = pending.get(m[1]);
  if (t !== undefined) propagation.push(performance.now() - t);
}

async function listenSse(client, channel, stop) {
  const as = client.isDisplay ? '&as=display' : '';
  while (!stop.done) {
    let cursor = 0;
    try {
      streamsOpened++;
      const res = await fetch(`${BASE}/stream?channels=${encodeURIComponent(channel)}&since=${cursor}${as}`, {
        headers: { Cookie: client.cookieHeader(), Accept: 'text/event-stream' },
        signal: stop.signal,
      });
      if (res.status !== 200) {
        streamsFailed++;
        errors.http++;
        if (errors.samples.length < 5) errors.samples.push(`GET /stream -> ${res.status}`);
        await sleep(1000);
        continue;
      }
      let buf = '';
      const dec = new TextDecoder();
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('data:')) data += line.slice(5).trim();
            if (line.startsWith('id:')) cursor = Number(line.slice(3).trim()) || cursor;
          }
          if (data) {
            try {
              onEvent(JSON.parse(data));
            } catch {
              /* comment / partial */
            }
          }
        }
      }
    } catch (e) {
      if (stop.done) return;
      streamsFailed++;
      errors.network++;
      if (errors.samples.length < 5) errors.samples.push(`stream ${e?.name ?? e}`);
      await sleep(1000);
    }
  }
}

async function listenPoll(client, channel, stop, wait) {
  let since = 0;
  const as = client.isDisplay ? '&as=display' : '';
  while (!stop.done) {
    const r = await client.call('GET', `/events?channels=${encodeURIComponent(channel)}&since=${since}&wait=${wait}${as}`, undefined, {
      metric: wait === 0 ? lat.poll : undefined,
      timeoutMs: 40_000,
    });
    if (r.status === 200) {
      since = r.json.data.last_id ?? since;
      for (const ev of r.json.data.events ?? []) onEvent(ev);
    } else {
      await sleep(1000);
    }
    if (wait === 0) await sleep(POLL_MS);
  }
}

async function gmLoop(s, stop) {
  const url = `/sessions/${s.session.id}/actions`;
  let i = 0;
  while (!stop.done) {
    i++;
    const actions = [];
    const x = (4 + ((xSeq++ % 40000) / 1000)).toFixed(3);
    actions.push({ type: 'token.move', uid: 'g', x: Number(x), y: 6 });
    if (i % 2 === 0) actions.push({ type: 'fog.reveal', floor: s.floor, chunks: [[Math.floor(Math.random() * 2), Math.floor(Math.random() * 2), fogBitmap()]] });
    pending.set(x, performance.now());
    await s.gm.call('POST', url, { client_op_id: opId(), actions }, { metric: lat.gmAction });
    await sleep(2000);
  }
}

async function playerLoop(s, p, stop) {
  await sleep(Math.random() * 3000);
  let i = 0;
  while (!stop.done) {
    i++;
    await p.client.call(
      'POST',
      `/sessions/${s.session.id}/actions`,
      { client_op_id: opId(), actions: [{ type: 'token.move', uid: p.uid, x: 3 + (i % 20), y: 8 + (i % 5) }] },
      { metric: lat.playerAction },
    );
    await sleep(3000);
  }
}

// ---------------------------------------------------------------- main
async function main() {
  if (!existsSync(join(root, 'assets/vite-manifest.json'))) throw new Error('front not built (cd frontend && npm run build)');
  console.log(`load test: ${SESSIONS} sessions x (1 GM + 5 players + 1 screen), transport=${TRANSPORT}, ${DURATION_S}s, ${WORKERS} PHP workers`);
  await startServer();

  const sessions = [];
  const tSetup = performance.now();
  for (let n = 1; n <= SESSIONS; n++) sessions.push(await prepareSession(n));
  for (const s of sessions) await finishSession(s);
  console.log(`setup: ${((performance.now() - tSetup) / 1000).toFixed(1)}s (${requests} requests, ${errors.http + errors.network} errors)`);
  // The setup is not part of the measures.
  const setupErrors = { ...errors, samples: [...errors.samples] };
  errors.http = errors.network = errors.timeout = errors.tooMany = 0;
  errors.samples.length = 0;
  requests = 0;

  const before = sql();
  const stop = { done: false, signal: null };
  const ctl = new AbortController();
  stop.signal = ctl.signal;
  let maxThreads = before.threads;
  const sampler = setInterval(() => {
    try {
      maxThreads = Math.max(maxThreads, sql().threads);
    } catch {
      /* ignore */
    }
  }, 3000);

  const tasks = [];
  for (const s of sessions) {
    const channel = `session:${s.session.id}`;
    tasks.push(gmLoop(s, stop));
    const listeners = [...s.players.map((p) => p.client), s.display];
    for (const c of listeners) {
      if (TRANSPORT === 'sse') tasks.push(listenSse(c, channel, stop));
      else tasks.push(listenPoll(c, channel, stop, TRANSPORT === 'longpoll' ? 15 : 0));
    }
    for (const p of s.players) tasks.push(playerLoop(s, p, stop));
  }
  const t0 = performance.now();
  await sleep(DURATION_S * 1000);
  stop.done = true;
  ctl.abort();
  const elapsed = (performance.now() - t0) / 1000;
  await Promise.race([Promise.allSettled(tasks), sleep(5000)]);
  clearInterval(sampler);
  const after = sql();

  const actions = [...lat.gmAction, ...lat.playerAction];
  console.log('');
  console.log(`transport=${TRANSPORT} sessions=${SESSIONS} duration=${elapsed.toFixed(0)}s workers=${WORKERS}`);
  console.log('measure                         n      p50      p95      p99      max (ms)');
  const row = (label, a) =>
    console.log(`${label.padEnd(26)} ${String(a.length).padStart(6)} ${fmt(pct(a, 50))} ${fmt(pct(a, 95))} ${fmt(pct(a, 99))} ${fmt(a.length ? Math.max(...a) : NaN)}`);
  row('POST actions (GM)', lat.gmAction);
  row('POST actions (player)', lat.playerAction);
  row('POST actions (all)', actions);
  if (TRANSPORT === 'poll') row('GET /events wait=0', lat.poll);
  row('event propagation GM->clients', propagation);
  console.log(`requests (non-stream): ${requests}; events received: ${eventsReceived}; streams opened/failed: ${streamsOpened}/${streamsFailed}`);
  console.log(
    `errors: http=${errors.http} (429: ${errors.tooMany}) network=${errors.network} timeout=${errors.timeout}` +
      ` | setup errors: ${setupErrors.http + setupErrors.network + setupErrors.timeout}`,
  );
  for (const s of errors.samples) console.log('  e.g. ' + s);
  console.log(`SQL: ${((after.questions - before.questions) / elapsed).toFixed(0)} queries/s (Questions delta ${after.questions - before.questions}, includes the counter queries)`);
  console.log(`MySQL connections: max threads sampled ${maxThreads}, Max_used_connections ${after.max_used}`);
  const failed = errors.http + errors.network + errors.timeout > 0;
  console.log(`RESULT: ${failed ? 'ERRORS' : 'no error'}`);
  return failed ? 1 : 0;
}

let code = 1;
try {
  code = await main();
} catch (e) {
  console.error('load test failed:', e?.stack ?? e);
} finally {
  await cleanup();
}
process.exit(code);
