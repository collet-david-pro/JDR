<script lang="ts">
  import LinkEditor from './LinkEditor.svelte';
  import type {
    DoorObject,
    Link,
    MapObject,
    PortalIcon,
    PortalObject,
    StairsObject,
  } from '../../editor/contracts';
  import { PORTAL_ICONS } from '../../editor/model/scene-values';
  import { portalIconLabel } from '../../editor/ui/scene-labels';
  import type { EditorSession } from '../../editor/ui/session';
  import { t } from '../../lib/i18n';

  /**
   * Properties of stairs, portals and the link of doors (P9a2). Direction, target floor, icon, colour and
   * label apply to every selected object of the type; the link is edited for a single object.
   */
  interface Props {
    session: EditorSession;
    objects: readonly MapObject[];
  }

  let { session, objects }: Props = $props();
  const uid = $props.id();

  const stairs = $derived(objects.filter((o): o is StairsObject => o.type === 'stairs'));
  const portals = $derived(objects.filter((o): o is PortalObject => o.type === 'portal'));
  const doors = $derived(objects.filter((o): o is DoorObject => o.type === 'door'));
  const single = $derived(objects.length === 1 ? objects[0] : undefined);
  const floors = $derived.by(() => {
    void session.ui.floors;
    return session.doc.floors();
  });

  function patchStairs(change: Partial<StairsObject['props']>): void {
    session.scene.patchObjects(
      stairs.map((o) => o.uid),
      (o) => (o.type === 'stairs' ? { props: { ...o.props, ...change } } : null),
    );
  }

  function patchPortal(change: Partial<PortalObject['props']>): void {
    session.scene.patchObjects(
      portals.map((o) => o.uid),
      (o) => (o.type === 'portal' ? { props: { ...o.props, ...change } } : null),
    );
  }

  /** Link of a stairs / portal / door; null removes it (stairs, door). */
  function setLink(object: MapObject, link: Link | null): void {
    session.scene.patchObjects([object.uid], (o) => {
      if (o.type === 'portal') return link === null ? null : { props: { ...o.props, link } };
      if (o.type === 'stairs' || o.type === 'door') {
        const { link: _old, ...rest } = o.props as typeof o.props & { link?: Link };
        return { props: link === null ? rest : { ...rest, link } } as { props: typeof o.props };
      }
      return null;
    });
  }

  function common<T>(list: readonly T[]): T | '' {
    const first = list[0];
    return first !== undefined && list.every((v) => v === first) ? first : ('' as const);
  }
  const value = (event: Event): string => (event.currentTarget as HTMLSelectElement).value;
</script>

{#if stairs.length > 0}
  <div class="grid" data-testid="stairs-properties">
    <label>
      <span>{t('editor.passage.direction')}</span>
      <select
        value={common(stairs.map((o) => o.props.direction))}
        data-testid="stairs-direction"
        onchange={(e) => patchStairs({ direction: value(e) as 'up' | 'down' })}
      >
        <option value="" disabled>{t('editor.properties.mixed')}</option>
        <option value="up">{t('editor.passage.up')}</option>
        <option value="down">{t('editor.passage.down')}</option>
      </select>
    </label>
    <label>
      <span>{t('editor.passage.to_floor')}</span>
      <select
        value={common(stairs.map((o) => o.props.to_floor))}
        data-testid="stairs-to-floor"
        onchange={(e) => patchStairs({ to_floor: value(e) })}
      >
        <option value="" disabled>{t('editor.link.choose')}</option>
        {#each floors as f (f.uid)}
          <option value={f.uid} disabled={stairs.every((o) => o.floor === f.uid)}>{f.name}</option>
        {/each}
      </select>
    </label>
    {#if stairs.length === 1 && stairs.every( (o) => floors.every((f) => f.uid !== o.props.to_floor) )}
      <p class="small broken" role="status">{t('editor.passage.floor_missing')}</p>
    {/if}
  </div>
{/if}

{#if portals.length > 0}
  <div class="grid" data-testid="portal-properties">
    <label>
      <span>{t('editor.passage.icon')}</span>
      <select
        value={common(portals.map((o) => o.props.icon))}
        data-testid="portal-icon"
        onchange={(e) => patchPortal({ icon: value(e) as PortalIcon })}
      >
        <option value="" disabled>{t('editor.properties.mixed')}</option>
        {#each PORTAL_ICONS as icon (icon)}<option value={icon}>{portalIconLabel(icon)}</option
          >{/each}
      </select>
    </label>
    <label>
      <span>{t('editor.passage.color')}</span>
      <input
        type="color"
        value={common(portals.map((o) => o.props.color)) || '#7c4dff'}
        data-testid="portal-color"
        onchange={(e) => patchPortal({ color: e.currentTarget.value })}
      />
    </label>
    <label for={`${uid}-label`}>
      <span>{t('editor.passage.label')}</span>
      <input
        id={`${uid}-label`}
        type="text"
        maxlength="60"
        value={common(portals.map((o) => o.props.label ?? ''))}
        data-testid="portal-label"
        onchange={(e) => {
          const text = e.currentTarget.value.trim();
          session.scene.patchObjects(
            portals.map((o) => o.uid),
            (o) => {
              if (o.type !== 'portal') return null;
              const { label: _old, ...rest } = o.props;
              return { props: text === '' ? rest : { ...rest, label: text } };
            },
          );
        }}
      />
    </label>
  </div>
{/if}

{#if single !== undefined && (single.type === 'stairs' || single.type === 'portal' || single.type === 'door')}
  <LinkEditor
    link={single.props.link ?? null}
    required={single.type === 'portal'}
    id="object-link"
    onchange={(link) => setLink(single, link)}
  />
{/if}

{#if doors.length > 1}
  <p class="small muted">{t('editor.passage.link_single')}</p>
{/if}

<style>
  .grid {
    display: grid;
    gap: var(--space-2);
  }
  label {
    display: grid;
    gap: 2px;
  }
  p {
    margin: 0;
  }
  .broken {
    color: var(--color-danger, #b3261e);
  }
  select,
  input[type='text'] {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-sm);
  }
</style>
