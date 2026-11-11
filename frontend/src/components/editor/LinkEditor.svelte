<script lang="ts">
  import { getContext } from 'svelte';
  import type { Link } from '../../editor/contracts';
  import {
    LINK_TARGETS,
    linkBroken,
    type LinkFloorItem,
    type LinkMapInfo,
    type LinkMapItem,
    type LinkTargets,
  } from '../../editor/ui/link-targets';
  import { t } from '../../lib/i18n';
  import Button from '../Button.svelte';
  import LinkPointPicker from './LinkPointPicker.svelte';

  /**
   * Edits the link of a door, stairs or portal (P9a2): map of the game, floor and position (numeric entry;
   * a button also picks it with a click on the target map). A broken link is flagged and is redone by choosing
   * a destination again. `required`: no "no link" choice (portal).
   */
  interface Props {
    link: Link | null;
    required?: boolean;
    /** Test id prefix. */
    id?: string;
    onchange: (link: Link | null) => void;
  }

  let { link, required = false, id = 'link', onchange }: Props = $props();
  const uid = $props.id();
  const targets = getContext<LinkTargets | undefined>(LINK_TARGETS);

  let maps = $state.raw<readonly LinkMapItem[] | null>(null);
  let floors = $state.raw<readonly LinkFloorItem[] | null>(null);
  let failed = $state(false);

  $effect(() => {
    if (targets === undefined) return;
    let live = true;
    targets
      .maps()
      .then((list) => {
        if (live) maps = list;
      })
      .catch(() => {
        if (live) failed = true;
      });
    return () => {
      live = false;
    };
  });

  const mapId = $derived(link?.map_id ?? '');
  $effect(() => {
    const id = mapId;
    floors = null;
    if (targets === undefined || id === '') return;
    let live = true;
    targets
      .floors(id)
      .then((list) => {
        if (live) floors = list;
      })
      .catch(() => {
        if (live) failed = true;
      });
    return () => {
      live = false;
    };
  });

  let pickOpen = $state(false);
  let pickInfo = $state.raw<LinkMapInfo | null>(null);
  let pickFailed = $state(false);

  function openPicker(): void {
    if (targets === undefined || link === null || link.map_id === null) return;
    pickInfo = null;
    pickFailed = false;
    pickOpen = true;
    targets.info(link.map_id).then(
      (info) => (pickInfo = info),
      () => (pickFailed = true),
    );
  }

  const mapKnown = $derived(maps === null || mapId === '' || maps.some((m) => m.id === mapId));
  const floorKnown = $derived(
    floors === null || link?.floor == null || floors.some((f) => f.uid === link.floor),
  );
  const broken = $derived(linkBroken(link, maps, floors));

  function level(l: number): string {
    return l > 0 ? `+${l}` : String(l);
  }

  function chooseMap(value: string): void {
    onchange(value === '' ? null : { map_id: value, floor: null, x: null, y: null });
  }

  function patch(change: Partial<Link>): void {
    if (link === null || link.map_id === null) return;
    onchange({ map_id: link.map_id, floor: link.floor, x: link.x, y: link.y, ...change });
  }

  function coord(event: Event): number | null {
    const text = (event.currentTarget as HTMLInputElement).value.trim();
    if (text === '') return null;
    const n = Number(text);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
</script>

<fieldset
  class="link"
  data-testid={`${id}-editor`}
  aria-describedby={broken ? `${uid}-broken` : null}
>
  <legend>{t('editor.link.title')}</legend>
  {#if broken}
    <p id={`${uid}-broken`} class="broken" role="status" data-testid={`${id}-broken`}>
      {t('editor.link.broken')}
    </p>
  {/if}
  {#if failed}
    <p class="small muted" role="status">{t('editor.link.load_failed')}</p>
  {/if}
  <label>
    <span>{t('editor.link.map')}</span>
    <select
      value={mapKnown ? mapId : ''}
      data-testid={`${id}-map`}
      onchange={(e) => chooseMap(e.currentTarget.value)}
    >
      <option value="" disabled={required && link !== null && mapKnown}>
        {required || broken ? t('editor.link.choose') : t('editor.link.none')}
      </option>
      {#each maps ?? [] as m (m.id)}
        <option value={m.id}>{m.name}</option>
      {/each}
    </select>
  </label>
  {#if link !== null && link.map_id !== null && mapKnown}
    <label>
      <span>{t('editor.link.floor')}</span>
      <select
        value={floorKnown ? (link.floor ?? '') : ''}
        data-testid={`${id}-floor`}
        onchange={(e) =>
          patch({ floor: e.currentTarget.value === '' ? null : e.currentTarget.value })}
      >
        <option value="">{t('editor.link.first_floor')}</option>
        {#each floors ?? [] as f (f.uid)}
          <option value={f.uid}>{level(f.level)} · {f.name}</option>
        {/each}
      </select>
    </label>
    <div class="pos">
      <label>
        <span>{t('editor.link.x')}</span>
        <input
          type="number"
          min="0"
          step="0.5"
          value={link.x ?? ''}
          data-testid={`${id}-x`}
          onchange={(e) => patch({ x: coord(e) })}
        />
      </label>
      <label>
        <span>{t('editor.link.y')}</span>
        <input
          type="number"
          min="0"
          step="0.5"
          value={link.y ?? ''}
          data-testid={`${id}-y`}
          onchange={(e) => patch({ y: coord(e) })}
        />
      </label>
    </div>
    {#if targets?.canPick}
      <Button size="small" onclick={openPicker} data-testid={`${id}-pick`}>
        {t('editor.link.pick')}
      </Button>
      <LinkPointPicker
        bind:open={pickOpen}
        info={pickInfo}
        failed={pickFailed}
        point={{ x: link.x, y: link.y }}
        onpick={(x, y) => patch({ x, y })}
      />
    {/if}
    <p class="small muted">{t('editor.link.position_hint')}</p>
  {/if}
</fieldset>

<style>
  .link {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
  }
  label {
    display: grid;
    gap: 2px;
  }
  .pos {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .broken {
    margin: 0;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--color-danger-soft, #fde8e8);
    color: var(--color-danger, #b3261e);
    font-size: var(--font-size-sm);
  }
  p {
    margin: 0;
  }
  select,
  input {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-sm);
  }
</style>
