// Metrics -> commentary control.
// The commentary is written in a small, documented language: every figure is a reference [[metric.id]] that the
// code renders; the words around it must name the right metric, entity, period and comparator, and state the
// direction of a variance. Anything the checker cannot tie to a figure is marked for the reviewer, never ticked.
import type { Metric, MetricSet, Comparator, Measure, Period } from './engine.ts';
import { requiredCoverage, CLIENTS } from './engine.ts';
import { roundsToZero } from './format.ts';
import { fingerprint } from './hash.ts';

// v1 frozen before held-out batch 1; v2 after it, before batch 2; v3 after the fresh review of 28/09 (rankings,
// relations, judgements, negations, other months, measures not calculated, two clients around one figure).
export const CHECKER_VERSION = 'v3';

export type Severity = 'fail' | 'review';
export type Finding = { severity: Severity; rule: string; message: string; ref?: string };
export type SentenceResult = { markup: string; rendered: string; refs: string[]; status: 'verified' | 'review' | 'fail'; findings: Finding[] };
export type DraftResult = {
  draftFingerprint: string; stale: boolean; sentences: SentenceResult[]; omissions: Finding[];
  counts: { verified: number; review: number; fail: number };
};

// ---------- The supported language (published on the page and in the README) ----------
type Lex = { cls: string; value: string; phrases: string[] };
export const LEXICON: Lex[] = [
  // Comparators first: "August 2025" is a comparator, not the reporting period.
  { cls: 'comp', value: 'py', phrases: ['august 2025', 'last august', 'same month last year', 'same period last year', 'the prior year', 'prior year', 'previous year', 'last year', 'a year ago', 'a year earlier', 'year on year', 'year-on-year'] },
  { cls: 'comp', value: 'avg3m', phrases: ['may to july average', 'may-to-july average', 'average for may to july', 'three-month average', 'three month average', 'previous three months', 'prior three months', 'preceding three months', 'recent average', 'may to july', 'its average', 'monthly average'] },
  { cls: 'comp', value: 'budget', phrases: ['budgeted', 'budget', 'plan'] },
  { cls: 'period', value: 'ytd', phrases: ['financial year to date', 'year to date', 'year-to-date', 'ytd', 'so far this year', 'so far this financial year', 'first five months', 'five months to august', 'since april', 'cumulative'] },
  { cls: 'period', value: 'month', phrases: ['august', 'the month', 'this month', 'in the month', 'for the month', 'monthly'] },
  { cls: 'dir', value: 'inline', phrases: ['in line with', 'on budget', 'level with', 'unchanged', 'flat'] },
  { cls: 'dir', value: 'up', phrases: ['ahead of', 'above', 'up on', 'up', 'rose', 'risen', 'rising', 'increased', 'increase', 'grew', 'grown', 'growth', 'higher', 'exceeded', 'exceeding'] },
  { cls: 'dir', value: 'down', phrases: ['short of', 'behind', 'below', 'down on', 'down', 'fell', 'fallen', 'falling', 'fall', 'decreased', 'decrease', 'declined', 'decline', 'dropped', 'drop', 'lower', 'shortfall'] },
  { cls: 'pol', value: 'good', phrases: ['favourable', 'favourably', 'better', 'improved', 'improvement'] },
  { cls: 'pol', value: 'bad', phrases: ['adverse', 'adversely', 'worse', 'deteriorated'] },
  { cls: 'measure', value: 'share', phrases: ['share', 'concentration'] },
  { cls: 'measure', value: 'gross_margin', phrases: ['gross margin', 'margin'] },
  { cls: 'measure', value: 'gross_profit', phrases: ['gross profit'] },
  { cls: 'measure', value: 'operating_profit', phrases: ['operating profit', 'net profit', 'bottom line', 'profit'] },
  { cls: 'measure', value: 'direct_costs', phrases: ['direct costs', 'direct delivery costs', 'delivery costs', 'cost of sales', 'costs of sales'] },
  { cls: 'measure', value: 'overheads', phrases: ['overheads', 'overhead costs', 'operating expenses', 'overhead'] },
  { cls: 'measure', value: 'revenue', phrases: ['revenue', 'fee income', 'sales', 'turnover', 'income', 'fees', 'billings', 'billed', 'bill', 'invoiced', 'contributed', 'contributing', 'generated', 'brought in'] },
  ...CLIENTS.map((c) => ({ cls: 'entity', value: c.name, phrases: aliases(c.name) })),
  { cls: 'entity', value: 'agency', phrases: ['the agency', 'agency', 'the business', 'overall', 'total', 'in total', 'lowther studio', 'lowther'] },
  { cls: 'cond', value: 'cond', phrases: ['subject to', 'if approved', 'once approved', 'pending', 'would', 'if the', 'if it'] },
  { cls: 'causal', value: 'causal', phrases: ['because', 'due to', 'driven by', 'drove', 'reflecting', 'reflects', 'reflected', 'reflect', 'as a result', 'owing to', 'thanks to', 'demonstrates', 'shows that', 'suggests', 'indicates', 'led by', 'driving', 'drive', 'on the back of', 'result of', 'attributable', 'explained by', 'caused', 'contributed to', 'helped', 'boosted', 'weighed on', 'offset by', 'offsetting'] },
  { cls: 'forward', value: 'forward', phrases: ['should', 'recommend', 'we expect', 'expected to', 'likely', 'will', 'may need', 'might', 'could', 'forecast', 'outlook', 'going forward', 'next month', 'worth watching', 'keep an eye', 'monitor'] },
  // Read but not checked: these send the sentence to the reviewer, never to a tick.
  { cls: 'rank', value: 'rank', phrases: ['largest', 'biggest', 'highest', 'lowest', 'smallest', 'first', 'best', 'worst', 'top', 'leading', 'remained', 'remains', 'remain', 'still', 'only', 'most', 'least', 'again', 'second', 'third', 'last'] },
  { cls: 'relational', value: 'relational', phrases: ['the same amount', 'same amount', 'the same as', 'same as', 'the same', 'unlike', 'like', 'similar', 'similarly', 'as much as', 'equal', 'equally', 'matched', 'mirrored', 'in contrast', 'by contrast', 'whereas'] },
  { cls: 'judgement', value: 'judgement', phrases: ['the picture', 'picture', 'stronger', 'weaker', 'strong', 'weak', 'healthy', 'solid', 'robust', 'softer', 'soft', 'notably', 'notable', 'slightly', 'sharply', 'significantly', 'significant', 'broadly', 'steady', 'stable', 'worth', 'may wish', 'wish to', 'to watch', 'to flag', 'concern', 'concerning', 'encouraging', 'disappointing', 'pleasing', 'good', 'bad', 'one to watch'] },
  { cls: 'unsupported', value: 'unsupported', phrases: ['per head', 'per employee', 'per fte', 'per person', 'headcount', 'utilisation', 'utilization', 'recovery', 'ebitda', 'cash', 'runway', 'debtors', 'receivables', 'work in progress', 'pipeline', 'backlog', 'client margin', 'margin per client', 'client profitability'] },
  { cls: 'excluded', value: 'excluded', phrases: ['nearly doubled', 'almost doubled', 'more than doubled', 'doubled', 'tripled', 'halved', 'quadrupled', 'twice', 'three times', 'record', 'highest ever', 'lowest ever', 'best ever', 'worst ever'] },
];

function aliases(name: string): string[] {
  const l = name.toLowerCase();
  const first = l.split(' ')[0];
  const out = [l, l.replace(' & ', ' and ')];
  if (l.includes('&')) out.push(l.split(' & ')[0]);
  else out.push(first);
  return [...new Set(out)];
}

const PHRASES = LEXICON.flatMap((lx) => lx.phrases.map((p) => ({ ...lx, phrase: p }))).sort((a, b) => b.phrase.length - a.phrase.length);

type Hit = { cls: string; value: string; start: number; end: number; phrase: string };

// Longest-match tokenisation with masking, on whole words, case-insensitive. Refs are masked beforehand.
function scan(text: string): Hit[] {
  const lower = text.toLowerCase();
  const taken = new Array(lower.length).fill(false);
  const hits: Hit[] = [];
  for (const p of PHRASES) {
    let from = 0;
    for (;;) {
      const i = lower.indexOf(p.phrase, from);
      if (i < 0) break;
      from = i + 1;
      const j = i + p.phrase.length;
      const before = i === 0 ? ' ' : lower[i - 1];
      const after = j >= lower.length ? ' ' : lower[j];
      if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue;
      if (taken.slice(i, j).some(Boolean)) continue;
      for (let k = i; k < j; k++) taken[k] = true;
      hits.push({ cls: p.cls, value: p.value, start: i, end: j, phrase: p.phrase });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

const REF = /\[\[([a-z0-9_.@-]+)\]\]/g;

export function splitSentences(markup: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  for (let i = 0; i < markup.length; i++) {
    const ch = markup[i];
    buf += ch;
    if (ch === '[' && markup[i + 1] === '[') depth++;
    if (ch === ']' && markup[i + 1] === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[.!?]/.test(ch) && (i + 1 >= markup.length || /\s/.test(markup[i + 1]))) {
      out.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// Clause boundaries: semicolons, colons, dashes, and contrastive conjunctions.
const CLAUSE_BREAK = /;|:|\s-\s|,\s+(?:while|whereas|but|although|though)\s+|\s+(?:while|whereas|but|although)\s+/gi;

type RefPos = { id: string; start: number; end: number; clause: number };

export function render(markup: string, ms: MetricSet): string {
  return markup.replace(REF, (_, id) => ms.metrics.get(id)?.display ?? `[unknown figure ${id}]`);
}

export function checkDraft(markup: string, ms: MetricSet, draftSnapshotFingerprint: string): DraftResult {
  const sentences = splitSentences(markup.replace(/\s+/g, ' ').trim());
  const results: SentenceResult[] = [];
  const cited: Metric[] = [];
  let ctxPeriod: Period | null = null;
  let ctxEntity: string | null = null;

  for (const s of sentences) {
    const findings: Finding[] = [];
    // Mask refs with same-length placeholders so positions line up for scanning.
    const refs: RefPos[] = [];
    let masked = s.replace(REF, (m, id, off) => {
      refs.push({ id, start: off, end: off + m.length, clause: 0 });
      return '\u0001'.repeat(m.length);
    });
    // Clause index for each position.
    const breaks: number[] = [];
    for (const m of masked.matchAll(CLAUSE_BREAK)) breaks.push(m.index!);
    const clauseOf = (pos: number) => breaks.filter((b) => b < pos).length;
    for (const r of refs) r.clause = clauseOf(r.start);
    const rawHits = scan(masked.replace(/\u0001/g, ' ')).map((h) => ({ ...h, clause: clauseOf(h.start) }));
    // "[[x]] of agency revenue": the figure is a share, whatever words sit between "of" and "revenue".
    const SHARE_AFTER = /^\s*\)?\s*(?:(?:of|in)\s+(?:(?:the|its|total|overall|agency|agency['’]s|august|august['’]s|month['’]s|year[- ]to[- ]date|monthly|all)\s+)*(?:revenue|fees|income|sales|billings)\b|of\s+the\s+month\b|of\s+the\s+total\b)/i;
    const shareSpans = new Map<RefPos, { start: number; end: number }>();
    for (const r of refs) {
      const sm = SHARE_AFTER.exec(masked.slice(r.end));
      if (sm) shareSpans.set(r, { start: r.end, end: r.end + sm[0].length });
    }
    // "its share of year-to-date agency revenue": the words after "share" describe the share, not another figure.
    for (const h of rawHits.filter((h) => h.cls === 'measure' && h.value === 'share')) {
      const nextRef = refs.find((r) => r.start > h.end);
      const obj = /^\s+of\s+(?:(?:the|its|total|overall|agency|agency['’]s|august|august['’]s|month['’]s|year[- ]to[- ]date|monthly|all)\s+)*(?:revenue|fees|income|sales|billings)\b/i.exec(masked.slice(h.end));
      if (obj && (!nextRef || nextRef.start >= h.end + obj[0].length)) shareSpans.set({ id: '', start: h.start, end: h.start, clause: h.clause }, { start: h.end, end: h.end + obj[0].length });
    }
    const inShare = (h: { start: number; end: number }) => [...shareSpans.values()].some((sp) => h.start >= sp.start && h.end <= sp.end);
    const qualifiesRevenue = (h: Hit) => h.cls === 'entity' && h.value === 'agency' && /^(?:['’]s)?\s+(?:revenue|fees|income)\b/i.test(masked.slice(h.end)) && /\bof\s+(?:the\s+)?$/i.test(masked.slice(0, h.start));
    const hits = rawHits.filter((h) => !(inShare(h) && (h.cls === 'entity' || h.cls === 'measure')) && !qualifiesRevenue(h));
    // The noun at the end of a share phrase still names revenue for the figures that follow it.
    for (const [r, sp] of shareSpans) if (r.id) hits.push({ cls: 'measure', value: 'revenue', start: sp.end - 1, end: sp.end, phrase: 'revenue', clause: clauseOf(sp.end) });
    hits.sort((a, b) => a.start - b.start);
    const respectively = /\brespective(ly)?\b/i.test(masked);
    // "A and B ... [[x]] ([[x%]]) and [[y]] ([[y%]]) respectively": the k-th group of client figures after the names
    // belongs to the k-th client named (cycling when the pattern repeats); a parenthesised figure joins its group.
    const respectiveOwner = new Map<RefPos, string | null>();
    if (respectively) {
      const named = [...new Set(hits.filter((h) => h.cls === 'entity' && h.value !== 'agency').map((h) => h.value))];
      const lastName = Math.max(-1, ...hits.filter((h) => h.cls === 'entity' && h.value !== 'agency').map((h) => h.end));
      const clientRefs = refs.filter((r) => r.start > lastName && ms.metrics.get(r.id)?.entity !== 'agency' && ms.metrics.has(r.id));
      const groups: RefPos[][] = [];
      clientRefs.forEach((r, i) => {
        const prev = clientRefs[i - 1];
        if (prev && /^\s*\(\s*$/.test(masked.slice(prev.end, r.start))) groups[groups.length - 1].push(r);
        else groups.push([r]);
      });
      const ok = named.length > 1 && groups.length % named.length === 0;
      groups.forEach((g, k) => g.forEach((r) => respectiveOwner.set(r, ok ? named[k % named.length] : null)));
    }

    // Figures typed by hand: digits outside refs, after masking years that follow a month name or FY.
    const noYears = masked.replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december|fy)\s+(19|20)\d{2}\b/gi, (m) => m.replace(/\d/g, 'Y'))
      .replace(/\b(three|3)-month\b/gi, 'three-month');
    for (const m of noYears.matchAll(/[£$€]?\d[\d,.]*\s*(?:%|k\b|m\b|bn\b|pp\b)?/g)) {
      findings.push({ severity: 'fail', rule: 'typed-figure', message: `"${m[0].trim()}" is typed, not referenced: the checker cannot tie it to a figure.` });
    }
    for (const r of refs) {
      const after = masked.slice(r.end, r.end + 24).toLowerCase();
      const before = masked.slice(Math.max(0, r.start - 2), r.start);
      if (/^\s*(%|per ?cent|percent|pp\b|percentage points?|points?\b|k\b|m\b)/.test(after) || /£\s*$/.test(before)) {
        findings.push({ severity: 'fail', rule: 'unit-by-hand', ref: r.id, message: `A unit is written next to [[${r.id}]]; the code renders units.` });
      }
    }
    for (const h of hits.filter((h) => h.cls === 'excluded')) {
      findings.push({ severity: 'fail', rule: 'excluded-phrase', message: `"${h.phrase}" is outside the checked language (magnitude words are not verified).` });
    }
    const causal = hits.filter((h) => h.cls === 'causal');
    if (causal.length) findings.push({ severity: 'review', rule: 'interpretation', message: `States a cause ("${causal.map((h) => h.phrase).join('", "')}"). Nothing in the snapshot proves causes: reviewer to confirm or cut.` });
    const kinds: [string, string, string][] = [
      ['rank', 'ranking', 'Ranks or compares over time ("%s"): not checked, reviewer to confirm.'],
      ['relational', 'relation', 'Relates two figures or entities ("%s"): not checked, reviewer to confirm.'],
      ['judgement', 'judgement', 'Makes a judgement or recommends ("%s"): reviewer to confirm.'],
    ];
    for (const [cls, rule, msg] of kinds) {
      const hs = hits.filter((h) => h.cls === cls);
      if (hs.length) findings.push({ severity: 'review', rule, message: msg.replace('%s', hs.map((h) => h.phrase).join('", "')) });
    }
    const degree = /\bwell\s+(?=above|below|ahead|behind|short|up|down)/i.exec(masked);
    if (degree && !findings.some((f) => f.rule === 'judgement')) findings.push({ severity: 'review', rule: 'judgement', message: 'Makes a judgement ("well"): reviewer to confirm.' });
    const neg = /\b(not|never|no longer|neither|nor|none|without)\b|n['’]t\b/i.exec(masked);
    if (neg) findings.push({ severity: 'review', rule: 'negation', message: `Contains a negation ("${neg[0]}"): the checker does not read negations, reviewer to confirm.` });
    for (const h of hits.filter((h) => h.cls === 'unsupported')) {
      findings.push({ severity: 'fail', rule: 'unsupported-measure', message: `"${h.phrase}" is not a figure this pack calculates.` });
    }
    // Months other than August, outside the documented comparator and period phrases, are not in this snapshot.
    const covered = (a: number, b: number) => rawHits.some((h) => (h.cls === 'comp' || h.cls === 'period') && h.start <= a && h.end >= b);
    for (const mo of masked.matchAll(/\b(January|February|March|April|May|June|July|September|October|November|December)\b/g)) {
      if (mo.index === 0 && mo[1] === 'May') continue;
      if (!covered(mo.index!, mo.index! + mo[0].length)) findings.push({ severity: 'fail', rule: 'period-outside', message: `Names ${mo[1]}; this pack covers August 2026, the year to date and the May to July average only.` });
    }
    // Two different clients in the clause of a client figure, without "respectively": pairing not read.
    for (const r of refs) {
      const mm = ms.metrics.get(r.id);
      if (!mm || mm.entity === 'agency' || respectively) continue;
      const names = new Set(hits.filter((h) => h.cls === 'entity' && h.value !== 'agency' && h.clause === r.clause).map((h) => h.value));
      if (names.size > 1) { findings.push({ severity: 'review', rule: 'two-entities', message: `Names ${[...names].join(' and ')} around one client figure: pairing not checked, reviewer to confirm.` }); break; }
    }
    const fwd = hits.filter((h) => h.cls === 'forward');
    if (fwd.length) findings.push({ severity: 'review', rule: 'forward-looking', message: `Forward-looking or advisory ("${fwd.map((h) => h.phrase).join('", "')}"): reviewer to confirm.` });

    const nearest = (pos: number, cls: string, clause: number, side: 'both' | 'before' = 'both') => {
      let best: (typeof hits)[number] | null = null;
      for (const h of hits) {
        if (h.cls !== cls || h.clause !== clause) continue;
        if (side === 'before' && h.end > pos) continue;
        const d = h.end <= pos ? pos - h.end : h.start - pos;
        if (!best || d < (best.end <= pos ? pos - best.end : best.start - pos)) best = h;
      }
      return best;
    };
    // Binding a figure to its direction and comparator words:
    //  postfix  "[[x]] above budget", "[[x]] up on last year"
    //  prefix   "above budget by [[x]] ([[y]])", "down [[x]] on last year"
    const dirHits = hits.filter((h) => h.cls === 'dir' || h.cls === 'pol');
    const compHits = hits.filter((h) => h.cls === 'comp');
    const bind = (r: RefPos) => {
      const inClause = (h: Hit & { clause: number }) => h.clause === r.clause;
      const nextRef = refs.filter((x) => x.start > r.start && x.clause === r.clause).map((x) => x.start)[0] ?? Infinity;
      const compAfter = (from: number) => compHits.find((h) => inClause(h) && h.start >= from && h.start < nextRef) ?? null;
      const compBefore = (to: number, from = -1) => compHits.filter((h) => inClause(h) && h.end <= to && h.start >= from).pop() ?? null;
      // "up [[a]] and [[b]] respectively against their averages": the comparator comes after both figures.
      const compAnyAfter = (from: number) => compHits.find((h) => inClause(h) && h.start >= from) ?? null;
      const post = dirHits.find((h) => inClause(h) && h.start >= r.end && /^[\s)]*$/.test(masked.slice(r.end, h.start)));
      if (post) return { dir: post, comp: compAfter(post.end) ?? compBefore(r.start) ?? compAnyAfter(post.end), gapBefore: '', gapAfter: masked.slice(r.end, post.start) };
      const pre = dirHits.filter((h) => inClause(h) && h.end <= r.start).pop();
      if (pre) return { dir: pre, comp: compBefore(r.start, pre.end) ?? compAfter(r.end) ?? compBefore(r.start) ?? compAnyAfter(r.end), gapBefore: masked.slice(pre.end, r.start), gapAfter: null };
      return { dir: null, comp: compAfter(r.end) ?? compBefore(r.start) ?? compAnyAfter(r.end), gapBefore: null, gapAfter: null };
    };
    const sayOf = (h: Hit, polarity: number) => (h.value === 'inline' ? 0 : h.value === 'up' ? 1 : h.value === 'down' ? -1 : (h.value === 'good' ? 1 : -1) * polarity);

    for (const r of refs) {
      const m = ms.metrics.get(r.id);
      if (!m) {
        findings.push({ severity: 'fail', rule: 'unknown-figure', ref: r.id, message: `[[${r.id}]] is not a figure in this snapshot.` });
        continue;
      }
      cited.push(m);
      // Approval status.
      if (m.status === 'proposed') {
        const cond = hits.some((h) => h.cls === 'cond' && h.clause === r.clause);
        findings.push(cond
          ? { severity: 'review', rule: 'proposed-figure', ref: r.id, message: `${m.display} includes an adjustment not yet approved; stated conditionally, reviewer to confirm.` }
          : { severity: 'fail', rule: 'proposed-figure', ref: r.id, message: `${m.display} includes an adjustment not yet approved, stated as fact.` });
      }
      // Period: the nearest statement before the figure in its clause, else after it, else earlier in the sentence.
      const sp = shareSpans.get(r);
      const ph = (sp && hits.find((h) => h.cls === 'period' && h.start >= sp.start && h.end <= sp.end))
        ?? hits.find((h) => h.cls === 'period' && h.clause === r.clause && h.start >= r.end && /^[\s,)]*(?:in|for)?\s*$/i.test(masked.slice(r.end, h.start)))
        ?? hits.filter((h) => h.cls === 'period' && h.clause === r.clause && h.end <= r.start).pop()
        ?? hits.find((h) => h.cls === 'period' && h.clause === r.clause && h.start >= r.end)
        ?? hits.filter((h) => h.cls === 'period' && h.end <= r.start).pop() ?? null;
      const period = (ph?.value as Period | undefined) ?? ctxPeriod;
      const periodWord = (p: Period) => (p === 'ytd' ? 'year to date' : 'August');
      if (!period) findings.push({ severity: 'review', rule: 'period-unstated', ref: r.id, message: `No period stated for ${m.display}.` });
      else if (period !== m.period && ph) findings.push({ severity: 'fail', rule: 'period', ref: r.id, message: `${m.display} is ${m.period === 'ytd' ? 'a year-to-date' : 'an August'} figure; the sentence reads as ${periodWord(period)}.` });
      else if (period !== m.period) findings.push({ severity: 'review', rule: 'period-unstated', ref: r.id, message: `${m.display} is ${m.period === 'ytd' ? 'a year-to-date' : 'an August'} figure; this sentence states no period and the one before is about ${periodWord(period)}.` });
      // Measure: a share phrase after the figure, else the last measure named before it (a figure earlier in the
      // sentence counts as naming its own measure: "revenue of [[a]], above budget by [[b]]").
      let stated: string | null = sp ? 'share' : null;
      if (!stated) {
        const cands = [
          ...hits.filter((h) => h.cls === 'measure' && h.end <= r.start).map((h) => ({ pos: h.end, clause: h.clause, value: h.value })),
          ...refs.filter((x) => x.end <= r.start && !shareSpans.has(x) && ms.metrics.has(x.id)).map((x) => ({ pos: x.end, clause: x.clause, value: ms.metrics.get(x.id)!.measure as string })),
        ].sort((a, b) => a.pos - b.pos);
        stated = (cands.filter((c) => c.clause === r.clause).pop() ?? cands.pop())?.value ?? null;
      }
      if (!stated) findings.push({ severity: 'review', rule: 'measure-unstated', ref: r.id, message: `The sentence does not name the measure for ${m.display}.` });
      else if (stated !== m.measure) findings.push({ severity: 'fail', rule: 'measure', ref: r.id, message: `${m.display} is ${m.measure.replace('_', ' ')}; the words say ${stated.replace('_', ' ')}.` });
      // Entity.
      const ents = hits.filter((h) => h.cls === 'entity' && h.end <= r.start);
      const clientBefore = ents.filter((h) => h.value !== 'agency');
      const nearestInClause = ents.filter((h) => h.clause === r.clause).pop() ?? null;
      if (m.entity !== 'agency') {
        const named = (clientBefore.filter((h) => h.clause === r.clause).pop() ?? clientBefore.pop())?.value ?? ctxEntity;
        const agencyWordsFirst = nearestInClause?.value === 'agency' && m.measure !== 'share';
        if (respectively && respectiveOwner.has(r)) {
          const owner = respectiveOwner.get(r);
          if (owner === null) findings.push({ severity: 'review', rule: 'entity-pairing', ref: r.id, message: `Cannot pair ${m.display} with one of the clients named "respectively": reviewer to confirm.` });
          else if (owner !== m.entity) findings.push({ severity: 'fail', rule: 'entity', ref: r.id, message: `${m.display} belongs to ${m.entity}; read "respectively", it is attributed to ${owner}.` });
        }
        else if (agencyWordsFirst) findings.push({ severity: 'fail', rule: 'entity', ref: r.id, message: `${m.display} belongs to ${m.entity}; the words present it as an agency total.` });
        else if (named !== m.entity) findings.push({ severity: 'fail', rule: 'entity', ref: r.id, message: `${m.display} belongs to ${m.entity}; the sentence ${named && named !== 'agency' ? `names ${named}` : 'names no client'}.` });
      } else if (nearestInClause && nearestInClause.value !== 'agency') {
        findings.push({ severity: 'fail', rule: 'entity', ref: r.id, message: `${m.display} is an agency total; the sentence attaches it to ${nearestInClause.value}.` });
      }
      // Comparator.
      const bound = bind(r);
      const needComp = m.kind === 'variance' || m.scenario !== 'actual';
      if (needComp) {
        const comp = bound.comp?.value as Comparator | undefined;
        if (!comp) findings.push({ severity: 'fail', rule: 'comparator-unstated', ref: r.id, message: `${m.display} is measured against ${compName(m.comparator)}; the sentence does not say so.` });
        else if (comp !== m.comparator) findings.push({ severity: 'fail', rule: 'comparator', ref: r.id, message: `${m.display} is against ${compName(m.comparator)}; the words say ${compName(comp)}.` });
      }
      // Direction.
      if (m.kind === 'variance' && m.value !== null) {
        const is = roundsToZero(m.value, m.unit) ? 0 : Math.sign(m.value);
        if (!bound.dir) findings.push({ severity: 'fail', rule: 'direction-unstated', ref: r.id, message: `${m.display} prints without a sign; the sentence must say which way.` });
        else if (sayOf(bound.dir, m.polarity) !== is) findings.push({ severity: 'fail', rule: 'direction', ref: r.id, message: `Says "${bound.dir.phrase}", but ${describe(m)} is ${is === 0 ? 'level with' : is > 0 ? 'above' : 'below'} ${compName(m.comparator)}.` });
      } else if (m.kind === 'level' && m.scenario === 'actual' && bound.dir && bound.comp) {
        // "Revenue rose to £X against budget", "revenue of £X, below budget": the implied variance must agree.
        // Adjacent: "rose to [[x]]", "[[x]], below budget", "ran lower than budget at [[x]]".
        const gapB = bound.gapBefore === null ? null : bound.gapBefore.replace(new RegExp(bound.comp.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
        const adjacent = (bound.gapAfter !== null && /^[\s,]*$/.test(bound.gapAfter)) || (gapB !== null && /^\s*(?:(?:than|against|on|versus|compared with)\s+)?(?:the\s+)?\s*(?:to|at|of)?\s*$/i.test(gapB));
        const comp = bound.comp.value as Comparator;
        const twin = ms.metrics.get(m.id.replace(/\.actual(@proposed)?$/, `.vs_${comp}${m.unit === 'pct' ? '_pp' : ''}$1`));
        if (adjacent && twin && twin.value !== null) {
          const is = roundsToZero(twin.value, twin.unit) ? 0 : Math.sign(twin.value);
          if (sayOf(bound.dir, m.polarity) !== is) findings.push({ severity: 'fail', rule: 'direction', ref: r.id, message: `Says "${bound.dir.phrase}", but ${describe(m)} is ${is > 0 ? 'above' : is < 0 ? 'below' : 'level with'} ${compName(comp)}.` });
        }
      }
    }
    if (!refs.length && !findings.length) findings.push({ severity: 'review', rule: 'narrative', message: 'No figure in this sentence: reviewer to confirm the statement.' });

    // Context carried to the next sentence.
    const lastPeriod = hits.filter((h) => h.cls === 'period').pop();
    if (lastPeriod) ctxPeriod = lastPeriod.value as Period;
    const lastEntity = hits.filter((h) => h.cls === 'entity' && h.value !== 'agency').pop();
    if (lastEntity) ctxEntity = lastEntity.value;

    const status = findings.some((f) => f.severity === 'fail') ? 'fail' : findings.length ? 'review' : 'verified';
    results.push({ markup: s, rendered: render(s, ms), refs: refs.map((r) => r.id), status, findings: dedupe(findings) });
  }

  const omissions: Finding[] = [];
  for (const c of requiredCoverage(ms)) {
    if (!cited.some(c.matches)) omissions.push({ severity: c.adverse ? 'fail' : 'review', rule: 'omission', message: `Does not mention ${c.description}.` });
  }
  const counts = { verified: 0, review: 0, fail: 0 };
  for (const r of results) counts[r.status]++;
  return { draftFingerprint: fingerprint(markup), stale: draftSnapshotFingerprint !== ms.snapshotFingerprint, sentences: results, omissions, counts };
}

function dedupe(f: Finding[]): Finding[] {
  const seen = new Set<string>();
  return f.filter((x) => (seen.has(x.message) ? false : (seen.add(x.message), true)));
}

function describe(m: Metric): string {
  const when = m.period === 'ytd' ? 'year-to-date' : 'August';
  const what = m.measure === 'share' ? 'share of revenue' : m.measure.replace('_', ' ');
  return m.entity === 'agency' ? `${when} ${what}` : `${m.entity}'s ${when} ${what}`;
}

function compName(c: Comparator | null | string): string {
  return c === 'budget' ? 'budget' : c === 'py' ? 'the prior year' : c === 'avg3m' ? 'the May to July average' : 'nothing';
}

export type { Measure };
