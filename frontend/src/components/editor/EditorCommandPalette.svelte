<script lang="ts">
  import CommandPalette from '../CommandPalette.svelte';
  import { buildEditorCommands } from '../../editor/ui/editor-commands';
  import type { ExportKind } from '../../editor/ui/export-source';
  import type { EditorSession } from '../../editor/ui/session';
  import { handlePaletteKey } from '../../lib/palette-key';
  import type { Platform } from '../../editor/shortcuts';

  /** Cmd/Ctrl+K palette of the editor: the commands follow the session (floors, history). */
  interface Props {
    session: EditorSession;
    platform: Platform;
    onexport: (kind: ExportKind) => void;
    exporting: boolean;
  }

  let { session, platform, onexport, exporting }: Props = $props();
  let open = $state(false);
  const commands = $derived(
    buildEditorCommands(session, { platform, exportMap: onexport, exporting: () => exporting }),
  );
</script>

<svelte:window
  onkeydown={(event) =>
    handlePaletteKey(event, { platform, isOpen: () => open, setOpen: (value) => (open = value) })}
/>

<CommandPalette bind:open {commands} {platform} />
