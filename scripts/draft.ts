// Produces the frozen commentary drafts with Claude, on the subscription (claude -p), before publishing.
// The page never calls a model: it replays these files. Usage: node scripts/draft.ts <open|approved> <n>
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadSources } from '../src/sources-node.ts';
import { computeMetrics, ASSUMPTIONS, factsText } from '../src/engine.ts';

const MODEL = process.env.DRAFT_MODEL ?? 'claude-sonnet-5';
const state = (process.argv[2] ?? 'open') as 'open' | 'approved';
const n = Number(process.argv[3] ?? 5);
const batch = process.argv[4] ?? 'heldout';
const ms = computeMetrics(loadSources(), { accrual: state });
const facts = factsText(ms.metrics);
const template = readFileSync(new URL('../prompts/commentary.md', import.meta.url), 'utf8');
const prompt = template.replace('{{agency}}', ASSUMPTIONS.agency).replace('{{facts}}', facts);
const outDir = new URL(`../data/drafts/${batch}/`, import.meta.url);
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL(`prompt_${state}.txt`, outDir), prompt);

function run(i: number): Promise<void> {
  return new Promise((resolve) => {
    const started = new Date().toISOString();
    const p = spawn('claude', ['-p', '--model', MODEL, '--settings', JSON.stringify({ claudeMdExcludes: [homedir() + '/**'], language: 'English' }), '--strict-mcp-config', '--system-prompt', 'You write management commentary for a UK finance team.', '--tools', '', '--no-session-persistence', '--output-format', 'json', prompt], { cwd: new URL('../scratch/', import.meta.url).pathname });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => {
      const res = JSON.parse(out);
      const text: string = res.result;
      const m = /\{[\s\S]*\}/.exec(text);
      const commentary = m ? JSON.parse(m[0]).commentary : null;
      const rec = {
        snapshot: state, snapshotFingerprint: ms.snapshotFingerprint, run: i, model: Object.keys(res.modelUsage ?? {}), requestedModel: MODEL,
        started, finished: new Date().toISOString(), batch, prompt: `data/drafts/${batch}/prompt_${state}.txt`, prompt_template: 'prompts/commentary.md', raw: text, commentary,
      };
      writeFileSync(new URL(`${state}_run${i}.json`, outDir), JSON.stringify(rec, null, 2) + '\n');
      console.log(state, i, commentary ? 'ok' : 'NO COMMENTARY');
      resolve();
    });
  });
}
await Promise.all(Array.from({ length: n }, (_, k) => run(k + 1)));
