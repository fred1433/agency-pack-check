// Chooses the two drafts the page shows, by a stated rule: in each held-out batch, the first run (by run number)
// with no failing sentence. Every run and its result stays in data/drafts/ and data/results/.
import { loadBatch } from './drafts-node.ts';
import { computeMetrics } from './engine.ts';
import { checkDraft } from './claims.ts';
import type { Sources } from './engine.ts';
import type { Draft } from './pack.ts';

export const BATCH = 'heldout2';

export function pinnedDrafts(s: Sources): { A: Draft; B: Draft; rule: string } {
  const all = loadBatch(BATCH);
  const pick = (snapshot: 'open' | 'approved') => {
    const ms = computeMetrics(s, { accrual: snapshot });
    const runs = all.filter((d) => d.snapshot === snapshot).sort((a, b) => a.run - b.run);
    const d = runs.find((x) => checkDraft(x.commentary, ms, x.snapshotFingerprint).counts.fail === 0) ?? runs[0];
    return {
      key: snapshot === 'open' ? 'A' : 'B',
      label: `${snapshot === 'open' ? 'Draft A, written for the posted snapshot' : 'Draft B, written for the snapshot with the approved accrual'} (run ${d.run} of ${runs.length}, ${d.model.join(', ')}, ${d.started.slice(0, 10)})`,
      markup: d.commentary, snapshotFingerprint: d.snapshotFingerprint, model: d.model.join(', '), started: d.started, run: d.run, batch: BATCH,
    } satisfies Draft;
  };
  return { A: pick('open'), B: pick('approved'), rule: 'In each batch of ten, the first run with no failing sentence.' };
}
