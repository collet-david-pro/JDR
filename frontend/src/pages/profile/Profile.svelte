<script lang="ts">
  import ThemeControls from '../../components/ThemeControls.svelte';
  import { t } from '../../lib/i18n';
  import type { PageProps } from '../../lib/page';
  import DataSection from './DataSection.svelte';
  import DevicesSection from './DevicesSection.svelte';
  import InfoSection from './InfoSection.svelte';
  import PasswordSection from './PasswordSection.svelte';

  let _props: PageProps = $props();
</script>

<div class="profile stack">
  <h1>{t('pages.profile.title')}</h1>
  <InfoSection />
  <section class="card" aria-labelledby="profile-theme">
    <h2 id="profile-theme">{t('profile.theme.title')}</h2>
    <p class="muted small">{t('profile.theme.hint')}</p>
    <ThemeControls />
  </section>
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
