// Runs the metrics -> commentary control over (a) the natural held-out drafts, as Claude wrote them, and
// (b) deliberately corrupted copies of their sentences. Writes data/results/eval.json. No accuracy percentage:
// counts with their denominators, and every miss listed.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadSources } from '../src/sources-node.ts';
import { computeMetrics, CLIENTS, type MetricSet } from '../src/engine.ts';
import { checkDraft, splitSentences } from '../src/claims.ts';

const s = loadSources();
const sets: Record<string, MetricSet> = { open: computeMetrics(s, { accrual: 'open' }), approved: computeMetrics(s, { accrual: 'approved' }) };
const batch = process.argv[2] ?? 'heldout2';
const dir = new URL(`../data/drafts/${batch}/`, import.meta.url);
const drafts = readdirSync(dir).filter((f) => f.endsWith('.json')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));

// ---------- Natural outputs ----------
const natural = drafts.map((d) => {
  const ms = sets[d.snapshot];
  const r = checkDraft(d.commentary, ms, d.snapshotFingerprint);
  return {
    file: `${d.snapshot}_run${d.run}.json`, snapshot: d.snapshot, model: d.model, counts: r.counts, omissions: r.omissions,
    flagged: r.sentences.filter((x) => x.status !== 'verified').map((x) => ({ status: x.status, rendered: x.rendered, findings: x.findings })),
  };
});

// ---------- Corrupted copies ----------
const REF = /\[\[([a-z0-9_.@-]+)\]\]/g;
type Corruption = { type: string; from: string; to: string };
function refVariants(id: string, ms: MetricSet): Corruption[] {
  const out: Corruption[] = [];
  const has = (x: string) => ms.metrics.has(x) && x !== id;
  const push = (type: string, to: string) => { if (has(to)) out.push({ type, from: id, to }); };
  push('period swapped', id.includes('.month.') ? id.replace('.month.', '.ytd.') : id.replace('.ytd.', '.month.'));
  if (/vs_budget/.test(id)) push('comparator swapped', id.replace('vs_budget', 'vs_py'));
  else if (/vs_py/.test(id)) push('comparator swapped', id.replace('vs_py', 'vs_budget'));
  else if (/\.budget$/.test(id)) push('comparator swapped', id.replace(/\.budget$/, '.py'));
  else if (/\.py$/.test(id)) push('comparator swapped', id.replace(/\.py$/, '.budget'));
  const cm = /^client\.([a-z-]+)\./.exec(id);
  if (cm) {
    const i = CLIENTS.findIndex((c) => c.slug === cm[1]);
    push('client swapped', id.replace(`client.${cm[1]}.`, `client.${CLIENTS[(i + 1) % CLIENTS.length].slug}.`));
  }
  const swap: Record<string, string> = { revenue: 'gross_profit', gross_profit: 'operating_profit', operating_profit: 'revenue', direct_costs: 'overheads', overheads: 'direct_costs' };
  const mm = /^([a-z_]+)\./.exec(id);
  if (mm && swap[mm[1]]) push('measure swapped', id.replace(mm[1] + '.', swap[mm[1]] + '.'));
  if (!id.includes('@') && ms.metrics.has(id + '@proposed')) out.push({ type: 'unapproved figure stated as fact', from: id, to: id + '@proposed' });
  return out;
}
const FLIPS: [RegExp, string][] = [
  [/\babove\b/, 'below'], [/\bbelow\b/, 'above'], [/\bahead of\b/, 'behind'], [/\bbehind\b/, 'ahead of'],
  [/\bup\b/, 'down'], [/\bdown\b/, 'up'], [/\bhigher\b/, 'lower'], [/\blower\b/, 'higher'], [/\brose\b/, 'fell'], [/\bfell\b/, 'rose'],
  [/\bincreased\b/, 'decreased'], [/\bdecreased\b/, 'increased'], [/\bfavourable\b/, 'adverse'], [/\badverse\b/, 'favourable'], [/\bin line with\b/, 'above'],
];

type Case = { type: string; draft: string; original: string; corrupted: string; caught: boolean; outcome: 'fail' | 'review' | 'verified'; findings: string[] };
const cases: Case[] = [];
for (const d of drafts) {
  const ms = sets[d.snapshot];
  const base = checkDraft(d.commentary, ms, d.snapshotFingerprint);
  const sentences = splitSentences(d.commentary.replace(/\s+/g, ' ').trim());
  sentences.forEach((sent, si) => {
    if (base.sentences[si].status === 'fail') return; // only corrupt sentences that did not already fail
    const variants: { type: string; text: string }[] = [];
    const seen = new Set<string>();
    for (const m of sent.matchAll(REF)) {
      const id = m[1];
      for (const c of refVariants(id, ms)) {
        const text = sent.slice(0, m.index) + `[[${c.to}]]` + sent.slice(m.index! + m[0].length);
        if (!seen.has(c.type + text)) { seen.add(c.type + text); variants.push({ type: c.type, text }); }
      }
      const typed = sent.slice(0, m.index) + ms.metrics.get(id)!.display + sent.slice(m.index! + m[0].length);
      variants.push({ type: 'figure typed instead of referenced', text: typed });
    }
    for (const [re, to] of FLIPS) {
      const masked = sent.replace(REF, (x) => '#'.repeat(x.length));
      const mm = re.exec(masked);
      if (mm) variants.push({ type: 'direction word flipped', text: sent.slice(0, mm.index) + to + sent.slice(mm.index + mm[0].length) });
    }
    for (const v of variants) {
      const all = [...sentences];
      all[si] = v.text;
      const r = checkDraft(all.join(' '), ms, d.snapshotFingerprint);
      const target = r.sentences[si];
      cases.push({ type: v.type, draft: `${d.snapshot}_run${d.run}`, original: base.sentences[si].rendered, corrupted: target.rendered, caught: target.status === 'fail', outcome: target.status, findings: target.findings.map((f) => f.message) });
    }
  });
}
const byType: Record<string, { cases: number; failed: number; toReviewer: number; passed: number }> = {};
for (const c of cases) {
  byType[c.type] ??= { cases: 0, failed: 0, toReviewer: 0, passed: 0 };
  byType[c.type].cases++;
  byType[c.type][c.outcome === 'fail' ? 'failed' : c.outcome === 'review' ? 'toReviewer' : 'passed']++;
}
const sum = (f: (x: (typeof natural)[number]) => number) => natural.reduce((a, x) => a + f(x), 0);
const result = {
  generated: new Date().toISOString(), batch,
  natural: {
    drafts: natural.length,
    sentences: sum((x) => x.counts.verified + x.counts.review + x.counts.fail),
    verified: sum((x) => x.counts.verified), review: sum((x) => x.counts.review), fail: sum((x) => x.counts.fail),
    omissions: sum((x) => x.omissions.length),
    draftsWithAFailingSentence: natural.filter((x) => x.counts.fail > 0).length,
    perDraft: natural,
  },
  corrupted: {
    cases: cases.length, failed: cases.filter((c) => c.outcome === 'fail').length, toReviewer: cases.filter((c) => c.outcome === 'review').length,
    passed: cases.filter((c) => c.outcome === 'verified').length, byType, passedSilently: cases.filter((c) => c.outcome === 'verified'), sentToReviewer: cases.filter((c) => c.outcome === 'review'),
  },
};
mkdirSync(new URL('../data/results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../data/results/eval_${batch}.json`, import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log('natural', JSON.stringify({ ...result.natural, perDraft: undefined }));
console.log('corrupted', result.corrupted.cases, 'failed', result.corrupted.failed, 'review', result.corrupted.toReviewer, 'passed', result.corrupted.passed, JSON.stringify(byType));
for (const m of result.corrupted.passedSilently) console.log('PASSED', m.type, '|', m.corrupted);
