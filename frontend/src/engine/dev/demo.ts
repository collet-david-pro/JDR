/**
 * Engine demo / benchmark page (development only, not routed, not in the production build).
 * Open http://localhost:5173/src/engine/dev/demo.html?size=200 with `npm run dev`.
 *
 * Synthetic map fully filled on 3 tile layers. Primary button paints on `decor` (index under
 * the cursor + 1), middle button or "main" pans, wheel zooms. window.__engineDemo.bench()
 * runs a scripted pan/zoom and returns the measured frame rates.
 */

import type { GridTheme, PaletteEntry } from '../../editor/contracts';
import { GRID_THEME_IDS } from '../grid-themes';
import { loadSceneEngine, isEngineUnsupportedError, type SceneEngine } from '../load';
import { fillSynthetic, rng, SyntheticMap } from './synthetic-map';

const GROUND = 8;
const OTHER = 8;

async function makeImage(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w: number,
  h: number,
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2D canvas unavailable');
  draw(ctx, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (blob === null) throw new Error('toBlob failed');
  return URL.createObjectURL(blob);
}

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsl(${h} ${s}% ${l}% / ${a})`;
}

async function makePalette(): Promise<(PaletteEntry | null)[]> {
  const palette: (PaletteEntry | null)[] = [null];
  const random = rng(7);
  for (let i = 1; i <= GROUND + 2 * OTHER; i++) {
    const layer = i <= GROUND ? 0 : i <= GROUND + OTHER ? 1 : 2;
    const local = (i - 1) % GROUND;
    // The last two entries of each layer have no image: fallback checkerboard colours.
    if (local >= 6) {
      palette.push({ assetId: `a${i}`, url: null, name: `fallback ${i}` });
      continue;
    }
    const frames = local % 3 === 0 ? 4 : 1; // some images are 4-variant strips
    const hue = Math.floor(random() * 360);
    const url = await makeImage(
      (ctx, w, h) => {
        for (let f = 0; f < frames; f++) {
          const x0 = f * h;
          if (layer === 0) {
            ctx.fillStyle = hsl(hue, 35, 45 + f * 6);
            ctx.fillRect(x0, 0, h, h);
            for (let k = 0; k < 24; k++) {
              ctx.fillStyle = hsl(hue, 30, 30 + random() * 40, 0.8);
              ctx.fillRect(x0 + random() * h, random() * h, 6 + random() * 18, 4 + random() * 10);
            }
            ctx.strokeStyle = hsl(hue, 40, 25);
            ctx.lineWidth = 3;
            ctx.strokeRect(x0 + 1.5, 1.5, h - 3, h - 3);
          } else if (layer === 1) {
            ctx.fillStyle = hsl(hue, 60, 50, 0.35);
            ctx.beginPath();
            ctx.ellipse(x0 + h / 2, h / 2, h * 0.45, h * (0.25 + f * 0.05), f, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillStyle = hsl(hue, 70, 55, 0.9);
            ctx.beginPath();
            ctx.arc(x0 + h * 0.3, h * 0.3, h * (0.12 + f * 0.02), 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#000';
            ctx.fillRect(x0 + h * 0.3, h * 0.3, 4, h * 0.4);
          }
        }
      },
      128 * frames,
      128,
    );
    palette.push({ assetId: `a${i}`, url, name: `tile ${i}` });
  }
  return palette;
}

interface PhaseResult {
  readonly phase: string;
  readonly frames: number;
  readonly ms: number;
  readonly fps: number;
  /** Average main-thread time per frame, ms. */
  readonly cpuMsPerFrame: number;
  readonly mode: string;
  readonly samples: number[];
}

async function runPhase(
  engine: SceneEngine,
  phase: string,
  ms: number,
  step: (t: number) => void,
): Promise<PhaseResult> {
  const samples: number[] = [];
  const off = engine.onFps((fps) => samples.push(fps));
  const startFrames = engine.stats.frames;
  const startCpu = engine.stats.cpuMs;
  const start = performance.now();
  await new Promise<void>((resolve) => {
    const tick = (now: number): void => {
      const t = (now - start) / ms;
      if (t >= 1) {
        resolve();
        return;
      }
      step(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const elapsed = performance.now() - start;
  off();
  const frames = engine.stats.frames - startFrames;
  return {
    phase,
    frames,
    ms: Math.round(elapsed),
    fps: Math.round((frames * 10000) / elapsed) / 10,
    cpuMsPerFrame: Math.round(((engine.stats.cpuMs - startCpu) / Math.max(1, frames)) * 100) / 100,
    mode: engine.stats.mode,
    samples,
  };
}

async function waitIdle(engine: SceneEngine): Promise<void> {
  // Let progressive builds finish.
  let last = -1;
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const frames = engine.stats.frames;
    if (frames === last) return;
    last = frames;
  }
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const size = Number(params.get('size') ?? 200);
  const cellPx = Number(params.get('cell') ?? 70);
  const host = document.getElementById('host') as HTMLElement;
  const info = document.getElementById('info') as HTMLElement;
  const palette = await makePalette();
  const map = new SyntheticMap(size, size, cellPx, palette);
  fillSynthetic(map, GROUND, OTHER);

  let engine: SceneEngine;
  try {
    const pref = params.get('renderer');
    engine = await loadSceneEngine(host, pref === 'webgl' ? { preference: 'webgl' } : {});
  } catch (error) {
    info.textContent = isEngineUnsupportedError(error)
      ? `unsupported: ${error.reason}`
      : String(error);
    throw error;
  }
  engine.setMap(map);

  let fps = 0;
  engine.onFps((v) => (fps = v));
  let brushIndex = 1 + GROUND + OTHER;
  engine.onPointer((e) => {
    const inside = e.cell.x >= 0 && e.cell.y >= 0 && e.cell.x < size && e.cell.y < size;
    engine.setOverlay(
      e.type === 'leave' || !inside ? null : { kind: 'cells', cells: [[e.cell.x, e.cell.y]] },
    );
    if (inside && e.button === 0 && (e.type === 'down' || e.type === 'move')) {
      if (e.type === 'down') brushIndex = 1 + GROUND + OTHER + ((brushIndex + 1) % OTHER);
      map.set('decor', [[e.cell.x, e.cell.y, brushIndex, 0, 0]]);
    }
  });

  const themeSelect = document.getElementById('theme') as HTMLSelectElement;
  for (const id of GRID_THEME_IDS) themeSelect.add(new Option(id, id));
  themeSelect.addEventListener('change', () => engine.setGridTheme(themeSelect.value as GridTheme));
  const grid = document.getElementById('grid') as HTMLInputElement;
  grid.addEventListener('change', () => engine.setGridVisible(grid.checked));
  const pan = document.getElementById('pan') as HTMLInputElement;
  pan.addEventListener('change', () => engine.setPanMode(pan.checked));
  document.getElementById('fit')?.addEventListener('click', () => engine.camera.fit());

  setInterval(() => {
    const s = engine.stats;
    const cam = engine.camera.get();
    info.textContent =
      `${s.renderer} dpr ${s.dpr}${s.performanceMode ? ' (perf)' : ''} · ${fps} i/s · ` +
      `zoom ${cam.zoom.toFixed(3)} · ${s.mode} · visible ${s.visible}/${s.resident} · ` +
      `cache ${(s.cacheBytes / 1048576).toFixed(0)} Mo · particles ${s.particles}`;
  }, 500);

  const bench = async (msPerPhase = 3000): Promise<PhaseResult[]> => {
    engine.camera.fit();
    await waitIdle(engine);
    const fit = engine.camera.get();
    const results: PhaseResult[] = [];
    results.push(
      await runPhase(engine, 'pan @fit', msPerPhase, (t) =>
        engine.camera.set({ x: fit.x + Math.sin(t * Math.PI * 2) * size * 0.2 }),
      ),
    );
    engine.camera.set({ zoom: fit.zoom * 2.5 });
    await waitIdle(engine);
    const mid = engine.camera.get();
    results.push(
      await runPhase(engine, 'pan @mid zoom', msPerPhase, (t) =>
        engine.camera.set({
          x: mid.x + Math.sin(t * Math.PI * 2) * size * 0.25,
          y: mid.y + Math.cos(t * Math.PI * 2) * size * 0.1,
        }),
      ),
    );
    engine.camera.set({ zoom: 1 });
    await waitIdle(engine);
    const near = engine.camera.get();
    results.push(
      await runPhase(engine, 'pan @zoom 1 (direct)', msPerPhase, (t) =>
        engine.camera.set({ x: near.x + Math.sin(t * Math.PI * 2) * 20 }),
      ),
    );
    results.push(
      await runPhase(engine, 'zoom in/out', msPerPhase, (t) =>
        engine.camera.set({ zoom: fit.zoom * Math.exp(Math.sin(t * Math.PI * 2) * 2.5 + 2.5) }),
      ),
    );
    engine.camera.fit();
    return results;
  };

  Object.assign(window, { __engineDemo: { engine, map, bench, waitIdle: () => waitIdle(engine) } });
}

void main();
