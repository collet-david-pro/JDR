/**
 * GPU feature detection without Pixi (cheap, can run before the renderer chunk is loaded).
 */

export interface GpuSupport {
  /** navigator.gpu exists and an adapter + device could be obtained. */
  readonly webgpu: boolean;
  /** A WebGL2 context can be created. */
  readonly webgl2: boolean;
}

interface GpuLike {
  requestAdapter(): Promise<{ requestDevice(): Promise<{ destroy?: () => void }> } | null>;
}

/** True when a WebGL2 context can be created on a throw-away canvas. */
export function hasWebGL2(doc: Document = document): boolean {
  try {
    const canvas = doc.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (gl === null) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** True when a WebGPU adapter and device can be obtained. */
export async function hasWebGPU(nav: Navigator = navigator): Promise<boolean> {
  const gpu = (nav as Navigator & { gpu?: GpuLike }).gpu;
  if (gpu === undefined) return false;
  try {
    const adapter = await gpu.requestAdapter();
    if (adapter === null) return false;
    const device = await adapter.requestDevice();
    device.destroy?.();
    return true;
  } catch {
    return false;
  }
}

export async function detectGpuSupport(): Promise<GpuSupport> {
  return { webgpu: await hasWebGPU(), webgl2: hasWebGL2() };
}
