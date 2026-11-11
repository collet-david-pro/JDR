<script lang="ts">
  import HelpLink from '../../components/HelpLink.svelte';
  import ThemeControls from '../../components/ThemeControls.svelte';
  import { t } from '../../lib/i18n';
  import type { PageProps } from '../../lib/page';
  import DataSection from './DataSection.svelte';
  import DevicesSection from './DevicesSection.svelte';
  import InfoSection from './InfoSection.svelte';
  import PasswordSection from './PasswordSection.svelte';
  import TokensSection from './TokensSection.svelte';
  import { tour } from '../../stores/tour.svelte';

  let _props: PageProps = $props();
  let toursReset = $state(false);

  function resetTours(): void {
    tour.reset();
    toursReset = true;
  }
</script>

<div class="profile stack">
  <div class="title-row">
    <h1>{t('pages.profile.title')}</h1>
    <HelpLink anchor="joueur-profil-et-apparence" />
  </div>
  <InfoSection />
  <section class="card" aria-labelledby="profile-theme">
    <h2 id="profile-theme">{t('profile.theme.title')}</h2>
    <p class="muted small">{t('profile.theme.hint')}</p>
    <ThemeControls />
  </section>
  <section class="card" aria-labelledby="profile-tours">
    <h2 id="profile-tours">{t('profile.tours.title')}</h2>
    <p class="muted small">{t('profile.tours.hint')}</p>
    <p>
      <button type="button" class="button" data-testid="profile-tours-reset" onclick={resetTours}
        >{t('profile.tours.reset')}</button
      >
    </p>
    {#if toursReset}
      <p class="small" role="status" data-testid="profile-tours-done">{t('profile.tours.done')}</p>
    {/if}
  </section>
  <TokensSection />
  <PasswordSection />
  <DevicesSection />
  <DataSection />
</div>

<style>
  .profile {
    max-width: 44rem;
  }
  h1 {
    margin: 0;
  }
</style>
