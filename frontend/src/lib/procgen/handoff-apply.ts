/**
 * Applies the generation stashed for a NEW map when its editor opens (P8e2b, D12): the "Générer"
 * panel created the map and navigated here. The pack is loaded now; when it cannot be, the
 * generation is stashed again so a reload does not lose it.
 */
import type { EditorSession } from '../../editor/ui/session';
import type { MapGeneration } from '../types';
import { applyGeneration, type ApplyReport } from './apply';
import { stashGeneration, takeGeneration } from './handoff';
import type { Pack } from './pack';

export interface HandoffDeps {
  mapId: string;
  session: EditorSession;
  update: (id: string, patch: { generation: MapGeneration }) => Promise<unknown>;
  loadPack: () => Promise<Pack>;
}

export async function applyHandoff(deps: HandoffDeps): Promise<ApplyReport | null> {
  const handoff = takeGeneration(deps.mapId);
  if (handoff === null) return null;
  let report: ApplyReport;
  try {
    const pack = await deps.loadPack();
    report = applyGeneration(deps.session, { result: handoff.result, pack, target: 'map' });
  } catch (error) {
    stashGeneration(deps.mapId, handoff);
    throw error;
  }
  await deps.update(deps.mapId, {
    generation: {
      generator: handoff.result.generator,
      gen_version: handoff.result.gen_version,
      seed: handoff.result.seed,
      params: handoff.params,
    },
  });
  return report;
}
