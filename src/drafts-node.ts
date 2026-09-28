// Loads a batch of frozen drafts. Each draft's snapshot fingerprint is taken from the facts in the exact prompt it
// was given (saved beside it), so a draft is matched to the figures it saw, not to a label.
import { readFileSync, readdirSync } from 'node:fs';
import { factsFromPrompt } from './engine.ts';
import { fingerprint } from './hash.ts';

export function loadBatch(batch: string): any[] {
  const root = new URL('../', import.meta.url);
  const dir = new URL(`data/drafts/${batch}/`, root);
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((f) => {
      const d = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
      const prompt = readFileSync(new URL(d.prompt, root), 'utf8');
      return { ...d, snapshotFingerprint: fingerprint(factsFromPrompt(prompt)) };
    });
}
