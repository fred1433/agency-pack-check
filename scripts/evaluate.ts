// Runs the metrics -> commentary control over (a) the natural held-out drafts, as Claude wrote them, and
// (b) deliberately corrupted copies of their sentences. Writes data/results/eval.json. No accuracy percentage:
// counts with their denominators, and every miss listed.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadSources } from '../src/sources-node.ts';
import { computeMetrics, CLIENTS, type MetricSet } from '../src/engine.ts';
import { checkDraft, splitSentences, CHECKER_VERSION } from '../src/claims.ts';
import { loadBatch } from '../src/drafts-node.ts';

const s = loadSources();
const sets: Record<string, MetricSet> = { open: computeMetrics(s, { accrual: 'open' }), approved: computeMetrics(s, { accrual: 'approved' }) };
const batch = process.argv[2] ?? 'heldout2';
const drafts = loadBatch(batch);

// ---------- Natural outputs ----------
const natural = drafts.map((d) => {
  const ms = sets[d.snapshot];
  const r = checkDraft(d.commentary, ms, d.snapshotFingerprint);
  return {
    file: `${d.snapshot}_run${d.run}.json`, snapshot: d.snapshot, model: d.model, counts: r.counts, omissions: r.omissions,
    figures: r.sentences.reduce((a, x) => a + x.refs.length, 0), figuresFlagged: r.sentences.reduce((a, x) => a + new Set(x.findings.filter((f) => f.severity === 'fail' && f.ref).map((f) => f.ref)).size, 0),
    flagged: r.sentences.filter((x) => !x.clean).map((x) => ({ status: x.status, rendered: x.rendered, findings: x.findings })),
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

type Case = { type: string; draft: string; original: string; corrupted: string; caught: boolean; outcome: 'detected' | 'finding' | 'nofinding'; findings: string[] };
const cases: Case[] = [];
for (const d of drafts) {
  const ms = sets[d.snapshot];
  const base = checkDraft(d.commentary, ms, d.snapshotFingerprint);
  const sentences = splitSentences(d.commentary.replace(/\s+/g, ' ').trim());
  sentences.forEach((sent, si) => {
    // Mutate only sentences with no finding at all, so a change the checker notices is attributable to the mutation,
    // and so a mutation cannot 'repair' an error it was meant to introduce (the v3 case: 14.4% said to be below 9.0%).
    if (!base.sentences[si].clean) return;
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
      cases.push({ type: v.type, draft: `${d.snapshot}_run${d.run}`, original: base.sentences[si].rendered, corrupted: target.rendered, caught: target.status === 'fail', outcome: target.status === 'fail' ? 'detected' : target.findings.length ? 'finding' : 'nofinding', findings: target.findings.map((f) => f.message) });
    }
  });
}
const byType: Record<string, { cases: number; detected: number; finding: number; nofinding: number }> = {};
for (const c of cases) {
  byType[c.type] ??= { cases: 0, detected: 0, finding: 0, nofinding: 0 };
  byType[c.type].cases++;
  byType[c.type][c.outcome]++;
}
const sum = (f: (x: (typeof natural)[number]) => number) => natural.reduce((a, x) => a + f(x), 0);
const result = {
  generated: new Date().toISOString(), batch, checker: CHECKER_VERSION,
  natural: {
    drafts: natural.length,
    sentences: sum((x) => x.counts.review + x.counts.fail),
    rejected: sum((x) => x.counts.fail), withFinding: sum((x) => x.counts.review - x.counts.clean), noFinding: sum((x) => x.counts.clean),
    figures: sum((x) => x.figures), figuresFlagged: sum((x) => x.figuresFlagged),
    omissions: sum((x) => x.omissions.length),
    draftsWithAFailingSentence: natural.filter((x) => x.counts.fail > 0).length,
    perDraft: natural,
  },
  mutations: {
    note: 'Generated mutations of sentences with no finding. Not individually adjudicated: a mutation may, rarely, produce a true sentence.',
    cases: cases.length, detected: cases.filter((c) => c.outcome === 'detected').length, finding: cases.filter((c) => c.outcome === 'finding').length,
    nofinding: cases.filter((c) => c.outcome === 'nofinding').length, byType, noFindingCases: cases.filter((c) => c.outcome === 'nofinding'), findingCases: cases.filter((c) => c.outcome === 'finding'),
  },
};
mkdirSync(new URL('../data/results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../data/results/eval_checker-${CHECKER_VERSION}_${batch}.json`, import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log('natural', JSON.stringify({ ...result.natural, perDraft: undefined }));
console.log('mutations', result.mutations.cases, 'detected', result.mutations.detected, 'finding', result.mutations.finding, 'nofinding', result.mutations.nofinding, JSON.stringify(byType));
for (const m of result.mutations.noFindingCases) console.log('NOFINDING', m.type, '|', m.corrupted);
for (const m of result.mutations.findingCases) console.log('FINDING', m.type, '|', m.corrupted.slice(0, 120), '|', m.findings.join(' / ').slice(0, 160));
