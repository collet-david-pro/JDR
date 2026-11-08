/**
 * Animated weather (pure, no Pixi): particle budgets, in-place particle update and the fade
 * between two settings. Particles live in screen space (CSS px) and follow the camera pan, so the
 * effect stays aligned with the world. All buffers are allocated once; `stepParticles` and
 * `WeatherFader.step` allocate nothing.
 */
import type { WeatherType } from '../../editor/contracts';

/** Duration of a full fade (in or out) when the weather changes, seconds. */
export const WEATHER_FADE_S = 1.5;
/** Longest time step taken into account (a hidden tab must not teleport the particles). */
export const WEATHER_MAX_DT_S = 0.05;

export interface WeatherProfile {
  /** Particles per CSS px² at full intensity. */
  readonly density: number;
  /** Hard cap on the number of particles. */
  readonly cap: number;
}

/** Particle budget per type (fog: big soft patches, few of them). */
export const WEATHER_PROFILES: Readonly<Record<WeatherType, WeatherProfile>> = {
  none: { density: 0, cap: 0 },
  rain: { density: 3.2e-4, cap: 800 },
  storm: { density: 4.5e-4, cap: 1100 },
  snow: { density: 2.2e-4, cap: 600 },
  fog: { density: 7e-6, cap: 28 },
};

/** Largest pool any type may need. */
export const WEATHER_POOL_SIZE = Math.max(...Object.values(WEATHER_PROFILES).map((p) => p.cap));

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** Number of particles for a type, a (faded) intensity 0–1 and a visible area in CSS px². */
export function particleCount(type: WeatherType, intensity: number, area: number): number {
  const p = WEATHER_PROFILES[type];
  const k = clamp01(intensity);
  if (p.cap === 0 || k <= 0.005 || !(area > 0)) return 0;
  const n = Math.ceil(area * p.density * k);
  return Math.min(p.cap, Math.max(type === 'fog' ? 3 : 1, n));
}

/** Particle buffers (structure of arrays). */
export interface ParticleBuffers {
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Per-particle random factors 0–1 (size, speed, phase). */
  readonly a: Float32Array;
  readonly b: Float32Array;
}

export function createParticleBuffers(size = WEATHER_POOL_SIZE): ParticleBuffers {
  return {
    x: new Float32Array(size),
    y: new Float32Array(size),
    a: new Float32Array(size),
    b: new Float32Array(size),
  };
}

/** Deterministic pseudo-random 0–1 (mulberry32 step), so seeding allocates nothing. */
export function rand01(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Scatters every particle over the viewport. */
export function seedParticles(buf: ParticleBuffers, width: number, height: number): void {
  for (let i = 0; i < buf.x.length; i++) {
    buf.x[i] = rand01(i * 4 + 1) * width;
    buf.y[i] = rand01(i * 4 + 2) * height;
    buf.a[i] = rand01(i * 4 + 3);
    buf.b[i] = rand01(i * 4 + 4);
  }
}

/** Velocity of a particle, px/s (same maths for the renderer and the update). */
export function fallSpeed(type: WeatherType, a: number): number {
  switch (type) {
    case 'rain':
      return 700 + a * 300;
    case 'storm':
      return 950 + a * 350;
    case 'snow':
      return 40 + a * 60;
    default:
      return 0;
  }
}

/** Horizontal slant (px of x per px of y) of falling particles. */
export function slant(type: WeatherType): number {
  return type === 'storm' ? 0.45 : type === 'rain' ? 0.2 : 0;
}

/**
 * Moves the first `count` particles by `dt` seconds and by the camera pan (`panX`, `panY`, px),
 * wrapping inside `width × height` with a margin. In place, no allocation.
 */
export function stepParticles(
  buf: ParticleBuffers,
  type: WeatherType,
  count: number,
  dt: number,
  width: number,
  height: number,
  panX: number,
  panY: number,
  time: number,
): void {
  const m = 120;
  const w = width + 2 * m;
  const h = height + 2 * m;
  const s = slant(type);
  const n = Math.min(count, buf.x.length);
  for (let i = 0; i < n; i++) {
    const a = buf.a[i]!;
    let x = buf.x[i]! + panX;
    let y = buf.y[i]! + panY;
    if (type === 'snow') {
      y += fallSpeed(type, a) * dt;
      x += Math.sin(time * (0.6 + a) + buf.b[i]! * 6.283) * 18 * dt + 8 * dt;
    } else if (type === 'fog') {
      x += (6 + a * 10) * dt;
      y += Math.sin(time * 0.15 + buf.b[i]! * 6.283) * 4 * dt;
    } else {
      const v = fallSpeed(type, a) * dt;
      y += v;
      x -= v * s;
    }
    x = ((((x + m) % w) + w) % w) - m;
    y = ((((y + m) % h) + h) % h) - m;
    buf.x[i] = x;
    buf.y[i] = y;
  }
}

/**
 * Weather shown over time: fades the current type out, then the new one in. Reduced motion or
 * performance mode (`animate` false) jumps straight to the target.
 */
export class WeatherFader {
  type: WeatherType = 'none';
  /** Faded intensity 0–1 of `type`. */
  level = 0;
  private targetType: WeatherType = 'none';
  private targetLevel = 0;

  set(type: WeatherType, intensity: number, animate: boolean): void {
    this.targetType = WEATHER_PROFILES[type] === undefined ? 'none' : type;
    this.targetLevel = this.targetType === 'none' ? 0 : clamp01(intensity);
    if (!animate) {
      this.type = this.targetType;
      this.level = this.targetLevel;
    }
  }

  /** Advances by `dt` seconds; true while something still changes. */
  step(dt: number): boolean {
    const d = Math.min(dt, WEATHER_MAX_DT_S) / WEATHER_FADE_S;
    const goal = this.type === this.targetType ? this.targetLevel : 0;
    if (this.level < goal) this.level = Math.min(goal, this.level + d);
    else if (this.level > goal) this.level = Math.max(goal, this.level - d);
    if (this.type !== this.targetType && this.level <= 0) {
      this.type = this.targetType;
    }
    return this.type !== this.targetType || this.level !== this.targetLevel;
  }

  /** Whether anything is drawn. */
  get visible(): boolean {
    return this.type !== 'none' && this.level > 0.005;
  }
}

/** Veil used instead of particles when motion is frozen: [colour 0xRRGGBB, max alpha]. */
export const WEATHER_VEIL: Readonly<Record<WeatherType, readonly [number, number]>> = {
  none: [0, 0],
  rain: [0x4a5a78, 0.22],
  storm: [0x2e3850, 0.3],
  snow: [0xeef3ff, 0.2],
  fog: [0xcfd6dc, 0.32],
};
