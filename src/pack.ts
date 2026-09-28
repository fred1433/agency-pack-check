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

// Evidence references that travel with the export (speaker notes), one per figure in the commentary.
export function evidenceNotes(ms: MetricSet, markup: string): string[] {
  const ids = [...markup.matchAll(/\[\[([a-z0-9_.@-]+)\]\]/g)].map((m) => m[1]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const m = ms.metrics.get(id);
    if (!m) continue;
    out.push(`[${out.length + 1}] ${m.display}: ${m.label}. ${m.calc}. Source: ${m.sources.join('; ')}. Metric ${m.id}, snapshot ${ms.snapshotFingerprint}.`);
  }
  return out;
}

export function sentencesOf(markup: string) {
  return splitSentences(markup.replace(/\s+/g, ' ').trim());
}

// The one-page PowerPoint export. Editable text boxes and a native table; a prototype layout, not the firm's master.
export function buildPptx(PptxGenJS: any, ms: MetricSet, markup: string, meta: { agency: string; released: string; draftLabel: string }) {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pres.title = `${meta.agency}: management commentary, August 2026`;
  const s = pres.addSlide();
  const ink = '1E2A3A';
  const grey = '6B7280';
  s.addText(meta.agency.replace(' (fictional)', ''), { x: 0.6, y: 0.45, w: 8, h: 0.4, fontFace: 'Arial', fontSize: 12, color: grey });
  s.addText('Management commentary, August 2026', { x: 0.6, y: 0.8, w: 8, h: 0.6, fontFace: 'Georgia', fontSize: 26, color: ink });
  const text = markup.replace(/\[\[([a-z0-9_.@-]+)\]\]/g, (_, id) => ms.metrics.get(id)?.display ?? id).replace(/\s+/g, ' ').trim();
  s.addText(text, { x: 0.6, y: 1.6, w: 7.3, h: 4.9, fontFace: 'Georgia', fontSize: 13, color: ink, valign: 'top', paraSpaceAfter: 6, lineSpacingMultiple: 1.15 });
  const head = (t: string) => ({ text: t, options: { bold: true, color: grey, fontSize: 9, align: 'right' } });
  const rows: any[] = [[{ text: '', options: {} }, head('August'), head('Budget'), head('Last year'), head('Year to date'), head('Budget')]];
  for (const r of tableCells(ms)) {
    rows.push([
      { text: r.label, options: { color: ink, fontSize: 10 } },
      ...[...r.month, ...r.ytd].map((m: Metric) => ({ text: m.display, options: { color: ink, fontSize: 10, align: 'right' } })),
    ]);
  }
  s.addTable(rows, { x: 8.2, y: 1.65, w: 4.6, colW: [1.2, 0.72, 0.68, 0.68, 0.72, 0.6], fontFace: 'Arial', border: { type: 'solid', pt: 0.5, color: 'D5D8D2' }, rowH: 0.34 });
  s.addText(`Fictional agency, synthetic data. Prototype layout, not your master template. ${meta.released}`, { x: 0.6, y: 6.85, w: 12, h: 0.3, fontFace: 'Arial', fontSize: 8, color: grey });
  s.addNotes([`Draft: ${meta.draftLabel}.`, 'Evidence for each figure:', ...evidenceNotes(ms, markup)].join('\n'));
  return pres;
}
