// Everything the page and the export need, from one place: the state of the review and what it renders to.
import { computeMetrics, sourceChecks, type Sources, type Decisions, type MetricSet, type Metric } from './engine.ts';
import { checkDraft, splitSentences, type DraftResult } from './claims.ts';
import { releaseGates, canRelease, canSignOff, type Signoff, type Gate } from './release.ts';

export type Draft = { key: string; label: string; markup: string; snapshotFingerprint: string; model: string; started: string; run: number; batch: string };

export type Review = {
  decisions: Decisions;
  markup: string;
  draft: Draft; // the frozen draft the markup started from
  edited: boolean;
  authored?: string[]; // sentences written by the reviewer, not by Claude
  reviewed: Set<number>;
  signoff: Signoff | null;
};

export type Evaluated = {
  ms: MetricSet; checks: ReturnType<typeof sourceChecks>['checks']; questions: ReturnType<typeof sourceChecks>['questions'];
  result: DraftResult; gates: Gate[]; releasable: boolean; signable: boolean;
};

export function evaluate(s: Sources, r: Review): Evaluated {
  const ms = computeMetrics(s, r.decisions);
  const { checks, questions } = sourceChecks(s, r.decisions);
  const result = checkDraft(r.markup, ms, r.draft.snapshotFingerprint);
  const st = { checks, questions, draft: result, snapshotFingerprint: ms.snapshotFingerprint, reviewed: r.reviewed, signoff: r.signoff };
  return { ms, checks, questions, result, gates: releaseGates(st), releasable: canRelease(st), signable: canSignOff(st) };
}

export const TABLE_ROWS = [
  { label: 'Revenue', m: 'revenue' },
  { label: 'Gross profit', m: 'gross_profit' },
  { label: 'Gross margin', m: 'gross_margin' },
  { label: 'Overheads', m: 'overheads' },
  { label: 'Operating profit', m: 'operating_profit' },
] as const;

export function tableCells(ms: MetricSet) {
  const d = (id: string) => ms.metrics.get(id)!;
  return TABLE_ROWS.map((row) => ({
    label: row.label,
    month: [d(`${row.m}.month.actual`), d(`${row.m}.month.budget`), d(`${row.m}.month.py`)],
    ytd: [d(`${row.m}.ytd.actual`), d(`${row.m}.ytd.budget`)],
  }));
}

// One date format everywhere, page and export: "3 September 2026, 10:00" (UTC).
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `${date}, ${time} UTC`;
}

// Evidence that travels with the export: one note per sentence, numbered like the markers on the slide.
export function evidenceNotes(ms: MetricSet, markup: string): string[] {
  return sentencesOf(markup).map((sent, i) => {
    const ids = [...new Set([...sent.matchAll(/\[\[([a-z0-9_.@-]+)\]\]/g)].map((m) => m[1]))];
    const figs = ids.map((id) => ms.metrics.get(id)).filter((m): m is Metric => !!m)
      .map((m) => `${m.display} = ${m.label}; ${m.calc}; source ${m.sources.join(', ')}; metric ${m.id}`);
    return `[${i + 1}] ${figs.length ? figs.join(' | ') : 'No figure.'}`;
  });
}

export function sentencesOf(markup: string) {
  return splitSentences(markup.replace(/\s+/g, ' ').trim());
}

// The one-page PowerPoint export. Editable text and a native table; a prototype layout, not the firm's master.
// Each sentence carries a superscript [n]; note [n] lists the evidence for its figures.
export function buildPptx(PptxGenJS: any, ms: MetricSet, markup: string, meta: { agency: string; released: string; draftLabel: string; authored?: string[] }) {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pres.title = `${meta.agency}: management commentary, August 2026`;
  const s = pres.addSlide();
  const ink = '1E2A3A';
  const grey = '6B7280';
  s.addText(meta.agency.replace(' (fictional)', ''), { x: 0.6, y: 0.35, w: 8, h: 0.35, fontFace: 'Arial', fontSize: 12, color: grey });
  s.addText('Management commentary, August 2026', { x: 0.6, y: 0.68, w: 12, h: 0.55, fontFace: 'Georgia', fontSize: 24, color: ink });
  // Lead: the operating-profit bridge and the Marlow & Finch credit note, computed from the figures.
  const g = (id: string) => ms.metrics.get(id);
  const lead: string[] = [];
  const op = g('operating_profit.month.actual'), opv = g('operating_profit.month.vs_budget');
  const rv = g('revenue.month.vs_budget'), dc = g('direct_costs.month.vs_budget'), oh = g('overheads.month.vs_budget');
  const word = (m: any) => (m.value > 0 ? 'above' : m.value < 0 ? 'below' : 'in line with');
  if (op && opv && rv && dc && oh) lead.push(`Operating profit ${op.display}, ${opv.display} ${word(opv)} budget: revenue ${rv.display} ${word(rv)}, direct costs ${dc.display} ${word(dc)}, overheads ${oh.display} ${word(oh)}.`);
  const mf = g('client.marlow-finch.revenue.month.actual'), mfv = g('client.marlow-finch.revenue.month.vs_avg3m_pct'), cn = g('client.marlow-finch.credit_notes.month.actual'), exv = g('client.marlow-finch.revenue_ex_credit.month.vs_avg3m_pct');
  if (mf && mfv && cn && exv) lead.push(`Marlow & Finch ${mf.display}, ${mfv.display} ${word(mfv)} its May to July average; ${cn.display} of that is a credit note on July work (excluding it, ${exv.display} ${word(exv)}).`);
  s.addText(lead.map((t, i) => ({ text: t, options: { bold: true, breakLine: i < lead.length - 1 } })), { x: 0.6, y: 1.3, w: 12.1, h: 0.8, fontFace: 'Arial', fontSize: 13, color: ink, valign: 'top', paraSpaceAfter: 4 });
  const groups = paragraphGroups(markup);
  const authored = new Set(meta.authored ?? []);
  const runs: any[] = [];
  const sents = sentencesOf(markup);
  sents.forEach((sent, i) => {
    const text = sent.replace(/\[\[([a-z0-9_.@-]+)\]\]/g, (_, id) => ms.metrics.get(id)?.display ?? id);
    const breakAfter = i + 1 < groups.length && groups[i + 1] !== groups[i];
    runs.push({ text: (i > 0 && groups[i] === groups[i - 1] ? ' ' : '') + text, options: {} });
    runs.push({ text: `[${i + 1}${authored.has(sent) ? ' R' : ''}]`, options: { superscript: true, color: grey, breakLine: breakAfter } });
  });
  s.addText(runs, { x: 0.6, y: 2.2, w: 12.1, h: 2.55, fontFace: 'Arial', fontSize: 11, color: ink, valign: 'top', paraSpaceAfter: 6, lineSpacingMultiple: 1.1 });
  const head = (t: string) => ({ text: t, options: { bold: true, color: grey, fontSize: 10, align: 'right' } });
  const rows: any[] = [[{ text: '', options: {} }, head('August'), head('Budget'), head('Last year'), head('Year to date'), head('Budget, year to date')]];
  for (const r of tableCells(ms)) {
    rows.push([
      { text: r.label, options: { color: ink, fontSize: 11 } },
      ...[...r.month, ...r.ytd].map((m: Metric) => ({ text: m.display, options: { color: ink, fontSize: 11, align: 'right' } })),
    ]);
  }
  s.addTable(rows, { x: 0.6, y: 4.85, w: 12.1, colW: [2.35, 1.85, 1.85, 1.85, 2.1, 2.1], fontFace: 'Arial', border: { type: 'solid', pt: 0.5, color: 'D5D8D2' }, rowH: 0.3, margin: [0.03, 0.08, 0.03, 0.08] });
  const rNotes = sents.map((x, i) => (authored.has(x) ? i + 1 : 0)).filter(Boolean);
  s.addText(`Fictional agency, synthetic data. Prototype layout, not your master template. ${rNotes.length ? `R: reviewer edit (sentences ${rNotes.join(', ')}); other sentences as Claude wrote them. ` : ''}${meta.released}`, { x: 0.6, y: 6.95, w: 12.1, h: 0.3, fontFace: 'Arial', fontSize: 8, color: grey });
  s.addNotes([`Draft: ${meta.draftLabel}.`, `Figures fingerprint ${ms.snapshotFingerprint} (binds the figures shown, not the source files).`, 'Evidence, by sentence:', ...evidenceNotes(ms, markup).map((n, i) => (authored.has(sents[i]) ? n.replace(/^\[(\d+)\]/, '[$1] Reviewer edit.') : n))].join('\n'));
  return pres;
}

// Layout only: the commentary set in three paragraphs (the month, the year to date, the clients), broken at existing
// sentence boundaries. No word of the draft changes.
export function paragraphGroups(markup: string): number[] {
  const clientStart = /^(on clients|by client|client|orchard|kestrel|brightwater|marlow|among clients)/i;
  let g = 0;
  return sentencesOf(markup).map((s) => {
    const next = /^(year to date|year-to-date|so far this year|for the year)/i.test(s) ? 1 : clientStart.test(s) ? 2 : g;
    g = Math.max(g, next);
    return g;
  });
}

// The two reviewer edits a finance director would make to draft B, labelled as hers, never as Claude's.
export const REVIEWER_EDITS = {
  bridge: 'Against budget, August revenue was [[revenue.month.vs_budget]] higher, but direct costs were [[direct_costs.month.vs_budget]] higher and overheads [[overheads.month.vs_budget]] lower, leaving operating profit [[operating_profit.month.vs_budget]] below budget.',
  credit: [
    "Marlow & Finch's August revenue of [[client.marlow-finch.revenue.month.actual]] was [[client.marlow-finch.revenue.month.vs_avg3m_pct]] below its May to July average; it includes a credit note of [[client.marlow-finch.credit_notes.month.actual]] for July work, and excluding it, August revenue was [[client.marlow-finch.revenue_ex_credit.month.actual]], [[client.marlow-finch.revenue_ex_credit.month.vs_avg3m_pct]] below its May to July average.",
    'The rest of the fall is to be confirmed with the account lead.',
  ],
};

export function applyReviewerEdits(markup: string): { markup: string; authored: string[] } {
  const sents = sentencesOf(markup);
  const out: string[] = [];
  let bridged = false, credited = false;
  for (const x of sents) {
    if (!credited && x.includes('[[client.marlow-finch.revenue.month.actual]]')) { out.push(...REVIEWER_EDITS.credit); credited = true; continue; }
    out.push(x);
    if (!bridged && x.includes('[[operating_profit.month.actual]]')) { out.push(REVIEWER_EDITS.bridge); bridged = true; }
  }
  if (!bridged) out.splice(1, 0, REVIEWER_EDITS.bridge);
  if (!credited) out.push(...REVIEWER_EDITS.credit);
  return { markup: out.join(' '), authored: [REVIEWER_EDITS.bridge, ...REVIEWER_EDITS.credit] };
}
