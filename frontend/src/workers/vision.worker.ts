/**
 * vision.worker (projet.md 13.4, 14.2): visibility and light polygons off the main thread.
 * The logic lives in vision/worker-host.ts (tested in the same thread).
 */
import type { ToVisionWorker } from '../vision/protocol';
import { createVisionHost, type PostFromWorker } from '../vision/worker-host';

interface WorkerScope {
  postMessage: PostFromWorker;
  onmessage: ((event: MessageEvent<ToVisionWorker>) => void) | null;
}

const scope = self as unknown as WorkerScope;
const handle = createVisionHost((message, transfer) => scope.postMessage(message, transfer));

scope.onmessage = (event) => handle(event.data);
