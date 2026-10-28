<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { GeneratePanelModel, GenTarget } from '../../lib/procgen/generate-panel.svelte';
  import type { ParamSpec } from '../../procgen/generators';

  /** Settings of the "Générer" tab: generator, preset, sliders, seed, target. */
  interface Props {
    model: GeneratePanelModel;
  }

  let { model }: Props = $props();
  const uid = $props.id();
  const info = $derived(model.info);
  const presets = $derived(Object.keys(info.presets));
  const targets: readonly GenTarget[] = ['map', 'selection', 'new'];

  function optionLabel(spec: ParamSpec, option: string): string {
    return spec.key === 'theme'
      ? t(`procgen.themes.${model.generator}.${option}`)
      : t(`procgen.options.${spec.key}.${option}`);
  }

  function targetLabel(target: GenTarget): string {
    switch (target) {
      case 'map':
        return t('editor.generate.target_map');
      case 'selection':
        return t('editor.generate.target_selection');
      case 'new':
        return t('editor.generate.target_new');
    }
  }

  function numberOf(event: Event & { currentTarget: HTMLInputElement }): number {
    return event.currentTarget.valueAsNumber;
  }
</script>

<div class="form">
  <label class="field" for={`${uid}-gen`}>
    <span>{t('editor.generate.generator')}</span>
    <select
      id={`${uid}-gen`}
      class="control"
      value={model.generator}
      data-testid="gen-generator"
      onchange={(e) => model.setGenerator(e.currentTarget.value as typeof model.generator)}
    >
      {#each model.generators as id (id)}
        <option value={id}>{t(`procgen.generators.${id}`)}</option>
      {/each}
    </select>
  </label>

  <label class="field" for={`${uid}-preset`}>
    <span>{t('editor.generate.preset')}</span>
    <select
      id={`${uid}-preset`}
      class="control"
      value={model.preset}
      data-testid="gen-preset"
      onchange={(e) => model.setPreset(e.currentTarget.value)}
    >
      <option value="">{t('editor.generate.preset_custom')}</option>
      {#each presets as id (id)}
        <option value={id}>{t(`procgen.presets.${model.generator}.${id}`)}</option>
      {/each}
    </select>
  </label>

  <div class="field">
    <label for={`${uid}-seed`}>{t('editor.generate.seed')}</label>
    <div class="row">
      <input
        id={`${uid}-seed`}
        class="control grow"
        type="text"
        maxlength="64"
        required
        autocomplete="off"
        spellcheck="false"
        value={model.seed}
        aria-invalid={!model.seedValid}
        data-testid="gen-seed"
        oninput={(e) => model.setSeed(e.currentTarget.value)}
      />
      <button
        type="button"
        class="button button-small"
        title={t('editor.generate.seed_roll')}
        aria-label={t('editor.generate.seed_roll')}
        data-testid="gen-seed-roll"
        onclick={() => model.rollSeed()}><span aria-hidden="true">🎲</span></button
      >
    </div>
  </div>

  <fieldset class="params">
    <legend>{t('editor.generate.params')}</legend>
    {#each info.params as spec (spec.key)}
      {@const id = `${uid}-p-${spec.key}`}
      {@const value = model.params[spec.key]}
      <div class="field">
        {#if spec.kind === 'bool'}
          <label class="check">
            <input
              type="checkbox"
              checked={value === true}
              data-testid={`gen-param-${spec.key}`}
              onchange={(e) => model.setParam(spec.key, e.currentTarget.checked)}
            />
            {t(`procgen.params.${spec.key}`)}
          </label>
        {:else if spec.kind === 'enum'}
          <label for={id}>{t(`procgen.params.${spec.key}`)}</label>
          <select
            {id}
            class="control"
            value={String(value)}
            data-testid={`gen-param-${spec.key}`}
            onchange={(e) => model.setParam(spec.key, e.currentTarget.value)}
          >
            {#each spec.options ?? [] as option (option)}
              <option value={option}>{optionLabel(spec, option)}</option>
            {/each}
          </select>
        {:else}
          <label for={id}>
            {t(`procgen.params.${spec.key}`)}
            <output for={id} class="value">{value}</output>
          </label>
          <input
            {id}
            type="range"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={Number(value)}
            data-testid={`gen-param-${spec.key}`}
            oninput={(e) => model.setParam(spec.key, numberOf(e))}
          />
        {/if}
      </div>
    {/each}
  </fieldset>

  <fieldset class="targets">
    <legend>{t('editor.generate.target')}</legend>
    {#each targets as target (target)}
      {@const disabled = target === 'selection' && !model.selectionAllowed}
      <label class="check" class:muted={disabled}>
        <input
          type="radio"
          name={`${uid}-target`}
          value={target}
          checked={model.effectiveTarget === target}
          {disabled}
          data-testid={`gen-target-${target}`}
          onchange={() => model.setTarget(target)}
        />
        {targetLabel(target)}
      </label>
    {/each}
    {#if !model.selectionAllowed}
      <p class="small muted">
        {model.info.zone
          ? t('editor.generate.selection_needed')
          : t('editor.generate.selection_unsupported')}
      </p>
    {/if}
    {#if model.effectiveTarget === 'new'}
      <label class="field" for={`${uid}-name`}>
        <span>{t('editor.generate.new_name')}</span>
        <input
          id={`${uid}-name`}
          class="control"
          type="text"
          maxlength="100"
          required
          value={model.newName}
          data-testid="gen-new-name"
          oninput={(e) => (model.newName = e.currentTarget.value)}
        />
      </label>
      <div class="row">
        <label class="field grow" for={`${uid}-w`}>
          <span>{t('editor.generate.width')}</span>
          <input
            id={`${uid}-w`}
            class="control"
            type="number"
            min={info.size.min}
            max={info.size.max}
            value={model.newWidth}
            data-testid="gen-new-width"
            oninput={(e) => (model.newWidth = numberOf(e))}
          />
        </label>
        <label class="field grow" for={`${uid}-h`}>
          <span>{t('editor.generate.height')}</span>
          <input
            id={`${uid}-h`}
            class="control"
            type="number"
            min={info.size.min}
            max={info.size.max}
            value={model.newHeight}
            data-testid="gen-new-height"
            oninput={(e) => (model.newHeight = numberOf(e))}
          />
        </label>
      </div>
    {:else}
      <p
        class="small"
        data-testid="gen-size"
        data-selection={model.effectiveTarget === 'selection' && model.selectionRect !== null
          ? `${model.selectionRect.x},${model.selectionRect.y},${model.selectionRect.w},${model.selectionRect.h}`
          : null}
      >
        {t('editor.generate.size_fixed', { width: model.size.width, height: model.size.height })}
      </p>
    {/if}
  </fieldset>
</div>

<style>
  .form {
    display: grid;
    gap: var(--space-2);
  }
  .field {
    display: grid;
    gap: 2px;
    font-size: var(--font-size-sm);
  }
  .row {
    display: flex;
    gap: var(--space-1);
    align-items: center;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .control {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-sm);
    min-width: 0;
  }
  fieldset {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-sm);
    min-width: 0;
  }
  legend {
    padding: 0 var(--space-1);
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .check {
    display: flex;
    gap: var(--space-1);
    align-items: center;
    font-size: var(--font-size-sm);
  }
  .value {
    float: right;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-muted);
  }
  p {
    margin: 0;
  }
</style>
