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
export function buildPptx(PptxGenJS: any, ms: MetricSet, markup: string, meta: { agency: string; released: string; draftLabel: string }) {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pres.title = `${meta.agency}: management commentary, August 2026`;
  const s = pres.addSlide();
  const ink = '1E2A3A';
  const grey = '6B7280';
  s.addText(meta.agency.replace(' (fictional)', ''), { x: 0.6, y: 0.35, w: 8, h: 0.35, fontFace: 'Arial', fontSize: 12, color: grey });
  s.addText('Management commentary, August 2026', { x: 0.6, y: 0.68, w: 12, h: 0.55, fontFace: 'Georgia', fontSize: 24, color: ink });
  const groups = paragraphGroups(markup);
  const runs: any[] = [];
  sentencesOf(markup).forEach((sent, i) => {
    const text = sent.replace(/\[\[([a-z0-9_.@-]+)\]\]/g, (_, id) => ms.metrics.get(id)?.display ?? id);
    const breakAfter = i + 1 < groups.length && groups[i + 1] !== groups[i];
    runs.push({ text: (i > 0 && groups[i] === groups[i - 1] ? ' ' : '') + text, options: {} });
    runs.push({ text: `[${i + 1}]`, options: { superscript: true, color: grey, breakLine: breakAfter } });
  });
  s.addText(runs, { x: 0.6, y: 1.35, w: 12.1, h: 2.9, fontFace: 'Arial', fontSize: 12, color: ink, valign: 'top', paraSpaceAfter: 8, lineSpacingMultiple: 1.12 });
  const head = (t: string) => ({ text: t, options: { bold: true, color: grey, fontSize: 10, align: 'right' } });
  const rows: any[] = [[{ text: '', options: {} }, head('August'), head('Budget'), head('Last year'), head('Year to date'), head('Budget, year to date')]];
  for (const r of tableCells(ms)) {
    rows.push([
      { text: r.label, options: { color: ink, fontSize: 11 } },
      ...[...r.month, ...r.ytd].map((m: Metric) => ({ text: m.display, options: { color: ink, fontSize: 11, align: 'right' } })),
    ]);
  }
  s.addTable(rows, { x: 0.6, y: 4.45, w: 12.1, colW: [2.35, 1.85, 1.85, 1.85, 2.1, 2.1], fontFace: 'Arial', border: { type: 'solid', pt: 0.5, color: 'D5D8D2' }, rowH: 0.3, margin: [0.03, 0.08, 0.03, 0.08] });
  s.addText(`Fictional agency, synthetic data. Prototype layout, not your master template. ${meta.released}`, { x: 0.6, y: 6.95, w: 12.1, h: 0.3, fontFace: 'Arial', fontSize: 8, color: grey });
  s.addNotes([`Draft: ${meta.draftLabel}.`, `Figures fingerprint ${ms.snapshotFingerprint}.`, 'Evidence, by sentence:', ...evidenceNotes(ms, markup)].join('\n'));
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
