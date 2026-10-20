<script lang="ts">
  import { onMount } from 'svelte';
  import CursorTable from '../../components/CursorTable.svelte';
  import { CursorList, cursorFetcher } from '../../lib/cursor-list.svelte';
  import { formatDateTime } from '../../lib/format';
  import { t } from '../../lib/i18n';
  import { services } from '../../lib/services';
  import type { AuditEntry } from '../../lib/types';

  const { api } = services();
  const list = new CursorList<AuditEntry>(
    cursorFetcher<AuditEntry>(api, '/admin/audit', () => ({ limit: 50 })),
  );

  function dataText(data: unknown): string {
    if (data === null || data === undefined) return '';
    if (typeof data === 'string') return data;
    try {
      return JSON.stringify(data);
    } catch {
      return '';
    }
  }

  onMount(() => {
    void list.reload();
  });
</script>

<section class="stack" aria-labelledby="audit-title">
  <h2 id="audit-title">{t('admin.tabs.audit')}</h2>
  <CursorTable
    {list}
    caption={t('admin.tabs.audit')}
    columns={6}
    empty={t('admin.audit.empty')}
    key={(e) => e.id}
  >
    {#snippet head()}
      <th scope="col">{t('admin.audit.date')}</th>
      <th scope="col">{t('admin.audit.user')}</th>
      <th scope="col">{t('admin.audit.action')}</th>
      <th scope="col">{t('admin.audit.entity')}</th>
      <th scope="col">{t('admin.audit.ip')}</th>
      <th scope="col">{t('admin.audit.data')}</th>
    {/snippet}
    {#snippet row(entry: AuditEntry)}
      <td class="nowrap">{formatDateTime(entry.created_at)}</td>
      <td>{entry.user?.username ?? t('admin.audit.system')}</td>
      <td><code>{entry.action}</code></td>
      <td>{entry.entity ?? ''}{entry.entity_id ? ` #${entry.entity_id}` : ''}</td>
      <td>{entry.ip ?? ''}</td>
      <td class="data"><code>{dataText(entry.data)}</code></td>
    {/snippet}
  </CursorTable>
</section>

<style>
  h2 {
    margin: 0;
  }
  .nowrap {
    white-space: nowrap;
  }
  .data code {
    display: block;
    max-width: 24rem;
    overflow-wrap: anywhere;
    font-size: var(--font-size-xs);
  }
</style>
