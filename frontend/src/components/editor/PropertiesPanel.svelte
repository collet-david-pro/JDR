<script lang="ts">
  import SceneObjectList from './SceneObjectList.svelte';
  import type {
    DoorProps,
    LightProps,
    MapObject,
    ObjectLayerId,
    ObjectVisibility,
    WallProps,
    WindowProps,
  } from '../../editor/contracts';
  import {
    DEFAULT_TOKEN_LIGHT,
    common,
    doorPatch,
    lightPatch,
    selectedScene,
    tokenPatch,
    wallPatch,
    windowPatch,
  } from '../../editor/ui/properties';
  import {
    VISIBILITIES,
    WALL_KINDS,
    WINDOW_KINDS,
    flickerLabel,
    objectTypeLabel,
    swingLabel,
    visibilityLabel,
    wallKindLabel,
    windowKindLabel,
  } from '../../editor/ui/scene-labels';
  import { layerLabel } from '../../editor/ui/labels';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';

  /**
   * Properties of the selected objects / placed tokens (projet.md 15.2): numeric edits are
   * undoable commands; with several objects, a field shows the shared value (empty if mixed)
   * and a change applies to all of them.
   */
  interface Props {
    session: EditorSession;
  }

  let { session }: Props = $props();
  const ui = $derived(session.ui);
  const uid = $props.id();
  const OBJECT_LAYERS: ObjectLayerId[] = ['walls', 'props', 'lighting', 'labels', 'gm'];

  // The document is not reactive: sceneVersion is bumped on every object / token change.
  const sel = $derived.by(() => {
    void ui.sceneVersion;
    return selectedScene(session.doc, ui.objectSelection);
  });
  const objectUids = $derived(sel.objects.map((o) => o.uid));
  const tokenUids = $derived(sel.tokens.map((tk) => tk.uid));
  const count = $derived(sel.objects.length + sel.tokens.length);
  const title = $derived(
    count === 0
      ? t('editor.properties.none')
      : count === 1
        ? objectTypeLabel(sel.objects[0]?.type ?? 'token')
        : t('editor.properties.several', { count }),
  );

  const walls = $derived(sel.objects.filter((o) => o.type === 'wall'));
  const doors = $derived(sel.objects.filter((o) => o.type === 'door'));
  const windows = $derived(sel.objects.filter((o) => o.type === 'window'));
  const lights = $derived(sel.objects.filter((o) => o.type === 'light'));

  const wallProp = <K extends keyof WallProps>(k: K) =>
    common(walls, (o) => (o.props as WallProps)[k]);
  const doorProp = <K extends keyof DoorProps>(k: K) =>
    common(doors, (o) => (o.props as DoorProps)[k]);
  const windowProp = <K extends keyof WindowProps>(k: K) =>
    common(windows, (o) => (o.props as WindowProps)[k]);
  const lightProp = <K extends keyof LightProps>(k: K) =>
    common(lights, (o) => (o.props as LightProps)[k]);

  function objects(patch: (o: MapObject) => ReturnType<typeof wallPatch>): void {
    session.scene.patchObjects(objectUids, patch);
  }
  const setWall = (change: Partial<WallProps>) => objects((o) => wallPatch(o, change));
  const setDoor = (change: Partial<DoorProps>) => objects((o) => doorPatch(o, change));
  const setWindow = (change: Partial<WindowProps>) => objects((o) => windowPatch(o, change));
  const setLight = (change: Partial<LightProps>) => objects((o) => lightPatch(o, change));
  const lightFlicker = (change: Partial<LightProps['flicker']>) =>
    objects((o) =>
      o.type === 'light' ? lightPatch(o, { flicker: { ...o.props.flicker, ...change } }) : null,
    );
  const lightCone = (change: Partial<NonNullable<LightProps['cone']>> | null) =>
    objects((o) =>
      o.type !== 'light'
        ? null
        : lightPatch(o, {
            cone:
              change === null
                ? null
                : { ...(o.props.cone ?? { angle: 90, direction: 0 }), ...change },
          }),
    );

  const num = (event: Event): number => Number((event.currentTarget as HTMLInputElement).value);
  const checked = (event: Event): boolean => (event.currentTarget as HTMLInputElement).checked;
  const value = (event: Event): string => (event.currentTarget as HTMLSelectElement).value;
  const show = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

  const tokenLight = $derived(common(sel.tokens, (tk) => tk.light_override));
</script>

<section class="panel" aria-labelledby={`${uid}-title`} data-testid="properties-panel">
  <h2 id={`${uid}-title`}>{t('editor.properties.title')}</h2>
  <p class="small" data-testid="properties-summary">{title}</p>

  {#if sel.objects.length > 0}
    <div class="grid">
      <label>
        <span>{t('editor.properties.visibility')}</span>
        <select
          value={show(common(sel.objects, (o) => o.visibility))}
          onchange={(e) => objects(() => ({ visibility: value(e) as ObjectVisibility }))}
        >
          <option value="" disabled>{t('editor.properties.mixed')}</option>
          {#each VISIBILITIES as v (v)}<option value={v}>{visibilityLabel(v)}</option>{/each}
        </select>
      </label>
      <label>
        <span>{t('editor.properties.layer')}</span>
        <select
          value={show(common(sel.objects, (o) => o.layer))}
          onchange={(e) => objects(() => ({ layer: value(e) as ObjectLayerId }))}
        >
          <option value="" disabled>{t('editor.properties.mixed')}</option>
          {#each OBJECT_LAYERS as l (l)}<option value={l}>{layerLabel(l)}</option>{/each}
        </select>
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={common(sel.objects, (o) => o.locked) === true}
          onchange={(e) => objects(() => ({ locked: checked(e) }))}
        />
        {t('editor.properties.locked')}
      </label>
    </div>
  {/if}

  {#if walls.length > 0}
    <fieldset class="grid" data-testid="properties-wall">
      <legend>{objectTypeLabel('wall')}</legend>
      <label>
        <span>{t('editor.options.wall_kind')}</span>
        <select
          value={show(wallProp('kind'))}
          onchange={(e) => setWall({ kind: value(e) as WallProps['kind'] })}
        >
          <option value="" disabled>{t('editor.properties.mixed')}</option>
          {#each WALL_KINDS as k (k)}<option value={k}>{wallKindLabel(k)}</option>{/each}
        </select>
      </label>
      <label>
        <span>{t('editor.properties.thickness')}</span>
        <input
          type="number"
          min="0.05"
          max="2"
          step="0.05"
          value={show(wallProp('thickness'))}
          onchange={(e) => setWall({ thickness: num(e) })}
        />
      </label>
      {#each ['blocks_vision', 'blocks_light', 'blocks_move'] as const as key (key)}
        <label class="check">
          <input
            type="checkbox"
            checked={wallProp(key) === true}
            onchange={(e) => setWall({ [key]: checked(e) })}
          />
          {key === 'blocks_vision'
            ? t('editor.properties.blocks_vision')
            : key === 'blocks_light'
              ? t('editor.properties.blocks_light')
              : t('editor.properties.blocks_move')}
        </label>
      {/each}
    </fieldset>
  {/if}

  {#if doors.length > 0}
    <fieldset class="grid" data-testid="properties-door">
      <legend>{objectTypeLabel('door')}</legend>
      <label class="check">
        <input
          type="checkbox"
          checked={doorProp('state') === 'open'}
          data-testid="door-open"
          onchange={(e) => setDoor({ state: checked(e) ? 'open' : 'closed' })}
        />
        {t('editor.properties.door_open')}
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={doorProp('locked') === true}
          onchange={(e) => setDoor({ locked: checked(e) })}
        />
        {t('editor.properties.door_locked')}
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={doorProp('secret') === true}
          onchange={(e) => setDoor({ secret: checked(e) })}
        />
        {t('editor.properties.door_secret')}
      </label>
      <label>
        <span>{t('editor.properties.swing')}</span>
        <select
          value={show(doorProp('swing'))}
          onchange={(e) => setDoor({ swing: value(e) as DoorProps['swing'] })}
        >
          <option value="" disabled>{t('editor.properties.mixed')}</option>
          {#each ['a', 'b', 'slide'] as const as s (s)}<option value={s}>{swingLabel(s)}</option
            >{/each}
        </select>
      </label>
    </fieldset>
  {/if}

  {#if windows.length > 0}
    <fieldset class="grid">
      <legend>{objectTypeLabel('window')}</legend>
      <label>
        <span>{t('editor.objects.window_kind')}</span>
        <select
          value={show(windowProp('kind'))}
          onchange={(e) => setWindow({ kind: value(e) as WindowProps['kind'] })}
        >
          <option value="" disabled>{t('editor.properties.mixed')}</option>
          {#each WINDOW_KINDS as k (k)}<option value={k}>{windowKindLabel(k)}</option>{/each}
        </select>
      </label>
    </fieldset>
  {/if}

  {#if lights.length > 0}
    {@const cone = lightProp('cone')}
    {@const flicker = lightProp('flicker')}
    <fieldset class="grid" data-testid="properties-light">
      <legend>{objectTypeLabel('light')}</legend>
      <label class="check">
        <input
          type="checkbox"
          checked={lightProp('enabled') === true}
          onchange={(e) => setLight({ enabled: checked(e) })}
        />
        {t('editor.properties.light_enabled')}
      </label>
      <label>
        <span>{t('editor.properties.radius')}</span>
        <input
          type="number"
          min="0"
          max="100"
          step="0.5"
          value={show(lightProp('radius'))}
          onchange={(e) => setLight({ radius: num(e) })}
        />
      </label>
      <label>
        <span>{t('editor.properties.dim_radius')}</span>
        <input
          type="number"
          min="0"
          max="100"
          step="0.5"
          value={show(lightProp('dim_radius'))}
          onchange={(e) => setLight({ dim_radius: num(e) })}
        />
      </label>
      <label>
        <span>{t('editor.properties.color')}</span>
        <input
          type="color"
          value={lightProp('color') ?? '#ffffff'}
          onchange={(e) => setLight({ color: value(e) })}
        />
      </label>
      <label>
        <span>{t('editor.properties.intensity')}</span>
        <input
          type="number"
          min="0"
          max="1"
          step="0.05"
          value={show(lightProp('intensity'))}
          onchange={(e) => setLight({ intensity: num(e) })}
        />
      </label>
      <label>
        <span>{t('editor.properties.flicker')}</span>
        <select
          value={show(flicker?.type)}
          onchange={(e) => lightFlicker({ type: value(e) as LightProps['flicker']['type'] })}
        >
          <option value="" disabled>{t('editor.properties.mixed')}</option>
          {#each ['none', 'torch', 'pulse'] as const as f (f)}<option value={f}
              >{flickerLabel(f)}</option
            >{/each}
        </select>
      </label>
      {#if flicker !== undefined && flicker.type !== 'none'}
        <label>
          <span>{t('editor.properties.flicker_amp')}</span>
          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={flicker.amp}
            onchange={(e) => lightFlicker({ amp: num(e) })}
          />
        </label>
        <label>
          <span>{t('editor.properties.flicker_speed')}</span>
          <input
            type="number"
            min="0.1"
            max="10"
            step="0.1"
            value={flicker.speed}
            onchange={(e) => lightFlicker({ speed: num(e) })}
          />
        </label>
      {/if}
      <label class="check">
        <input
          type="checkbox"
          checked={cone !== null && cone !== undefined}
          onchange={(e) => lightCone(checked(e) ? {} : null)}
        />
        {t('editor.properties.cone')}
      </label>
      {#if cone !== null && cone !== undefined}
        <label>
          <span>{t('editor.properties.cone_angle')}</span>
          <input
            type="number"
            min="1"
            max="359"
            step="5"
            value={cone.angle}
            onchange={(e) => lightCone({ angle: num(e) })}
          />
        </label>
        <label>
          <span>{t('editor.properties.cone_direction')}</span>
          <input
            type="number"
            min="0"
            max="360"
            step="5"
            value={cone.direction}
            onchange={(e) => lightCone({ direction: num(e) })}
          />
        </label>
      {/if}
    </fieldset>
  {/if}

  {#if sel.tokens.length > 0}
    <fieldset class="grid" data-testid="properties-token">
      <legend>{objectTypeLabel('token')}</legend>
      <label class="check">
        <input
          type="checkbox"
          checked={common(sel.tokens, (tk) => tk.hidden) === true}
          onchange={(e) => session.scene.patchTokens(tokenUids, () => ({ hidden: checked(e) }))}
        />
        {t('editor.properties.token_hidden')}
      </label>
      <label>
        <span>{t('editor.properties.scale')}</span>
        <input
          type="number"
          min="0.25"
          max="4"
          step="0.25"
          value={show(common(sel.tokens, (tk) => tk.scale))}
          onchange={(e) =>
            session.scene.patchTokens(tokenUids, () => tokenPatch({ scale: num(e) }))}
        />
      </label>
      <label>
        <span>{t('editor.properties.rotation')}</span>
        <input
          type="number"
          min="0"
          max="359"
          step="15"
          value={show(common(sel.tokens, (tk) => tk.rotation))}
          onchange={(e) =>
            session.scene.patchTokens(tokenUids, () => tokenPatch({ rotation: num(e) }))}
        />
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={tokenLight !== null && tokenLight !== undefined}
          onchange={(e) =>
            session.scene.patchTokens(tokenUids, (tk) => ({
              light_override: checked(e)
                ? (session.doc.tokenDef(tk.token_id)?.light ?? DEFAULT_TOKEN_LIGHT)
                : null,
            }))}
        />
        {t('editor.properties.token_light')}
      </label>
      {#if tokenLight !== null && tokenLight !== undefined}
        <label>
          <span>{t('editor.properties.radius')}</span>
          <input
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={tokenLight.radius}
            onchange={(e) =>
              session.scene.patchTokens(tokenUids, () =>
                tokenPatch({ light_override: { ...tokenLight, radius: num(e) } }),
              )}
          />
        </label>
        <label>
          <span>{t('editor.properties.dim_radius')}</span>
          <input
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={tokenLight.dim_radius}
            onchange={(e) =>
              session.scene.patchTokens(tokenUids, () =>
                tokenPatch({ light_override: { ...tokenLight, dim_radius: num(e) } }),
              )}
          />
        </label>
        <label>
          <span>{t('editor.properties.color')}</span>
          <input
            type="color"
            value={tokenLight.color}
            onchange={(e) =>
              session.scene.patchTokens(tokenUids, () =>
                tokenPatch({ light_override: { ...tokenLight, color: value(e) } }),
              )}
          />
        </label>
      {/if}
    </fieldset>
  {/if}

  <SceneObjectList {session} />
</section>

<style>
  .panel {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border-bottom: var(--border-width) solid var(--color-border);
    font-size: var(--font-size-sm);
  }
  h2 {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  p {
    margin: 0;
  }
  .grid {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    padding: 0;
    font-weight: var(--font-weight-medium);
  }
  label {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 7rem;
    gap: var(--space-2);
    align-items: center;
  }
  label.check {
    display: flex;
  }
  select,
  input[type='number'] {
    min-width: 0;
    padding: 2px var(--space-1);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
  }
</style>
