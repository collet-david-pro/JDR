/**
 * Weather layer (screen space, between the fog and the grid): rain / storm streaks, drifting
 * snow flakes and slow fog patches, from the map ambient `weather`. A pool of sprites is created
 * once and reused. Frozen (prefers-reduced-motion or performance mode): one light veil, no
 * particles and no animation frames.
 */
import { Container, Sprite, Texture } from '../pixi';
import type { Weather } from '../../editor/contracts';
import {
  WEATHER_MAX_DT_S,
  WEATHER_POOL_SIZE,
  WEATHER_VEIL,
  WeatherFader,
  createParticleBuffers,
  fallSpeed,
  particleCount,
  seedParticles,
  slant,
  stepParticles,
  type ParticleBuffers,
} from './weather-state';

function softTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g !== null) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  return Texture.from(c);
}

export class WeatherRenderer {
  readonly root = new Container();
  private readonly fader = new WeatherFader();
  private readonly buf: ParticleBuffers = createParticleBuffers();
  private readonly pool: Sprite[] = [];
  private readonly veil = new Sprite(Texture.WHITE);
  private soft: Texture | null = null;
  private seeded = false;
  private shownType = '';
  private shown = 0;
  private lastNow = 0;
  private lastTx = 0;
  private lastTy = 0;
  private hasPan = false;
  private lastW = 0;
  private lastH = 0;
  private flash = 0;

  constructor() {
    this.root.visible = false;
    this.root.eventMode = 'none';
    this.veil.visible = false;
    this.root.addChild(this.veil);
  }

  /** Number of sprites currently shown (tests, stats). */
  get activeCount(): number {
    return this.shown;
  }

  /**
   * Per frame. `pan` is the world translation (screen px). Returns true when another frame is
   * needed (particles move or a fade runs).
   */
  update(
    now: number,
    weather: Weather,
    width: number,
    height: number,
    tx: number,
    ty: number,
    zoom: number,
    frozen: boolean,
  ): boolean {
    const f = this.fader;
    f.set(weather.type, weather.intensity, !frozen);
    const dt = this.lastNow === 0 ? 0 : Math.min((now - this.lastNow) / 1000, WEATHER_MAX_DT_S);
    this.lastNow = now;
    const changing = f.step(dt);
    if (!f.visible) {
      this.hide();
      this.hasPan = false;
      return changing;
    }
    this.root.visible = true;
    if (frozen) {
      this.hideParticles();
      this.drawVeil(width, height);
      this.hasPan = false;
      return false;
    }
    this.veil.visible = false;
    if (!this.seeded || width !== this.lastW || height !== this.lastH) {
      seedParticles(this.buf, width, height);
      this.seeded = true;
      this.lastW = width;
      this.lastH = height;
    }
    const panX = this.hasPan ? tx - this.lastTx : 0;
    const panY = this.hasPan ? ty - this.lastTy : 0;
    this.lastTx = tx;
    this.lastTy = ty;
    this.hasPan = true;
    const count = particleCount(f.type, f.level, width * height);
    stepParticles(this.buf, f.type, count, dt, width, height, panX, panY, now / 1000);
    this.draw(count, zoom);
    return true;
  }

  private drawVeil(width: number, height: number): void {
    const [colour, alpha] = WEATHER_VEIL[this.fader.type];
    const v = this.veil;
    v.visible = true;
    v.tint = colour;
    v.alpha = alpha * this.fader.level;
    v.width = width;
    v.height = height;
    v.position.set(0, 0);
    v.anchor.set(0);
  }

  private ensure(count: number, soft: boolean): void {
    if (soft && this.soft === null) this.soft = softTexture();
    const tex = soft ? this.soft! : Texture.WHITE;
    while (this.pool.length < Math.min(count, WEATHER_POOL_SIZE)) {
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      this.pool.push(s);
      this.root.addChild(s);
    }
  }

  private draw(count: number, zoom: number): void {
    const type = this.fader.type;
    const level = this.fader.level;
    const soft = type === 'snow' || type === 'fog';
    this.ensure(count, soft);
    const tex = soft ? this.soft! : Texture.WHITE;
    const k = Math.min(1.6, Math.max(0.7, zoom));
    const s = slant(type);
    const angle = Math.atan(s);
    const retex = this.shownType !== type;
    this.shownType = type;
    const n = Math.min(count, this.pool.length);
    for (let i = 0; i < n; i++) {
      const sp = this.pool[i]!;
      if (retex) sp.texture = tex;
      sp.visible = true;
      const a = this.buf.a[i]!;
      sp.position.set(this.buf.x[i]!, this.buf.y[i]!);
      if (type === 'rain' || type === 'storm') {
        sp.width = 1.2 * k;
        sp.height = (fallSpeed(type, a) / 14) * k;
        sp.rotation = angle;
        sp.tint = 0xb8c8e6;
        sp.alpha = (0.25 + a * 0.25) * Math.min(1, level + 0.3);
      } else if (type === 'snow') {
        const d = (2 + a * 3.5) * k;
        sp.width = sp.height = d;
        sp.rotation = 0;
        sp.tint = 0xffffff;
        sp.alpha = 0.55 + a * 0.4;
      } else {
        const d = (260 + a * 260) * k;
        sp.width = sp.height = d;
        sp.rotation = 0;
        sp.tint = 0xdfe5ea;
        sp.alpha = (0.1 + a * 0.12) * (0.4 + level * 0.9);
      }
    }
    for (let i = n; i < this.shown; i++) this.pool[i]!.visible = false;
    this.shown = n;
    // Storm: a short, soft flash now and then, drawn by the veil sprite.
    if (type === 'storm') {
      const t = this.lastNow / 1000;
      this.flash = Math.max(0, Math.sin(t * 0.9) * Math.sin(t * 2.3 + 1) - 0.82) * 4;
    } else this.flash = 0;
    if (this.flash > 0) {
      const v = this.veil;
      v.visible = true;
      v.tint = 0xffffff;
      v.alpha = Math.min(0.25, this.flash) * level;
      v.width = this.lastW;
      v.height = this.lastH;
      v.anchor.set(0);
      v.position.set(0, 0);
    }
  }

  private hideParticles(): void {
    for (let i = 0; i < this.shown; i++) this.pool[i]!.visible = false;
    this.shown = 0;
  }

  private hide(): void {
    this.hideParticles();
    this.veil.visible = false;
    this.root.visible = false;
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.soft?.destroy(true);
  }
}
