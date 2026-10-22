/**
 * Export destinations (projet.md 17, 22): File System Access (showSaveFilePicker + streamed
 * writes) when available, else a Blob accumulated in memory (≈ compressed size) and downloaded.
 */

export interface OutputTarget {
  readonly kind: 'file' | 'download';
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  /** Discards the output (partial file removed when the browser allows it). */
  abort(): Promise<void>;
}

interface WritableLike {
  write(data: BufferSource): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

interface FileHandleLike {
  createWritable(): Promise<WritableLike>;
  getFile?: () => Promise<{ readonly size: number }>;
  remove?: () => Promise<void>;
}

type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileHandleLike>;

function picker(): SavePicker | null {
  const fn = (globalThis as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  return typeof fn === 'function' ? fn.bind(globalThis) : null;
}

export function hasFilePicker(): boolean {
  return picker() !== null;
}

/**
 * Asks where to save (must run during the click: user activation). Resolves null when the
 * picker is unavailable; rejects with an AbortError when the user cancels it.
 */
export async function pickFileTarget(
  suggestedName: string,
  mime: string,
  description: string,
): Promise<OutputTarget | null> {
  const show = picker();
  if (show === null) return null;
  const ext = suggestedName.slice(suggestedName.lastIndexOf('.'));
  const handle = await show({ suggestedName, types: [{ description, accept: { [mime]: [ext] } }] });
  // An existing file chosen for overwriting must survive a cancelled export: only a file
  // created empty by the picker is removed on abort.
  const existed = ((await handle.getFile?.().catch(() => null))?.size ?? 0) > 0;
  let writable: WritableLike | null = null;
  const open = async (): Promise<WritableLike> => (writable ??= await handle.createWritable());
  return {
    kind: 'file',
    write: async (bytes) => {
      await (await open()).write(bytes as Uint8Array<ArrayBuffer>);
    },
    close: async () => {
      await (await open()).close();
    },
    abort: async () => {
      // Writes go to a swap file until close(): aborting leaves the target untouched; the
      // (empty) file created by the picker is removed where supported.
      await writable?.abort().catch(() => undefined);
      if (!existed) await handle.remove?.().catch(() => undefined);
    },
  };
}

/** In-memory Blob, downloaded on close. */
export function downloadTarget(fileName: string, mime: string): OutputTarget {
  let parts: Uint8Array<ArrayBuffer>[] = [];
  return {
    kind: 'download',
    write: async (bytes) => {
      parts.push(bytes as Uint8Array<ArrayBuffer>);
    },
    close: async () => {
      const blob = new Blob(parts, { type: mime });
      parts = [];
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.append(a);
      a.click();
      a.remove();
      // Revoke later: some browsers start the download asynchronously.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    abort: async () => {
      parts = [];
    },
  };
}
