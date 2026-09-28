import PptxGenJS from 'pptxgenjs';
import { ASSUMPTIONS, accrualEvidence, type Sources, type Metric } from '../src/engine.ts';
import { evaluate, tableCells, sentencesOf, buildPptx, paragraphGroups, formatDateTime, type Review, type Draft } from '../src/pack.ts';
import { displayValue } from '../src/format.ts';
import { fingerprint } from '../src/hash.ts';
import sources from './generated/sources.json';
import pinned from './generated/pinned.json';
import results from './generated/results.json';

const S = sources as unknown as Sources;
const A = pinned.A as Draft;
const B = pinned.B as Draft;

const state: Review & { view: 'client' | 'reviewer'; editing: boolean } = {
  decisions: { accrual: 'open' }, markup: A.markup, draft: A, edited: false, reviewed: new Set(), signoff: null, view: 'reviewer', editing: false,
};

const $ = (id: string) => document.getElementById(id)!;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const REF = /\[\[([a-z0-9_.@-]+)\]\]/g;

// Reviewer's pen: tickmarks drawn as strokes, the only colour on the sheet.
const TICK = '<svg class="mk" viewBox="0 0 14 12" aria-hidden="true"><path d="M1.2 6.4 C2.6 7.6 3.6 8.9 4.9 10.6 C7.2 6.4 9.8 3.2 12.9 1.1"/></svg>';
const CROSS = '<svg class="mk" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 1.8 C4.5 4.6 7.6 7.8 10.6 10.6 M10.4 1.4 C7.6 4.4 4.6 7.6 1.6 10.7"/></svg>';
const circled = (n: number) => `<span class="mk-n" aria-label="note ${n}">${n}</span>`;

let ev = evaluate(S, state);

function update() {
  pop.hidden = true;
  ev = evaluate(S, state);
  renderSheet();
  renderReview();
  renderHow();
}

// ---------- The sheet ----------
function renderSheet() {
  const reviewer = state.view === 'reviewer';
  document.body.dataset.view = state.view;
  const sents = sentencesOf(state.markup);
  let noteNo = 0;
  const html = sents.map((sent, i) => {
    const r = ev.result.sentences[i];
    const failRefs = new Set(r.findings.filter((f) => f.severity === 'fail' && f.ref).map((f) => f.ref));
    const body = esc(sent).replace(REF, (_, id) => {
      const m = ev.ms.metrics.get(id);
      const shown = m ? m.display : `[unknown ${id}]`;
      const mark = reviewer && failRefs.has(id) ? CROSS : '';
      return `<span class="fig${failRefs.has(id) ? ' fig--bad' : ''}" data-ref="${id}" contenteditable="false" tabindex="${reviewer ? 0 : -1}">${esc(shown)}${mark}</span>`;
    });
    let tail = '';
    if (reviewer && r.status === 'verified') tail = TICK;
    if (reviewer && r.status !== 'verified') tail = circled(++noteNo);
    return `<span class="sent sent--${r.status}" data-i="${i}">${body}${tail}</span>`;
  });
  const groups = paragraphGroups(state.markup);
  const paras: string[][] = [];
  html.forEach((h, i) => { if (i === 0 || groups[i] !== groups[i - 1]) paras.push([]); paras[paras.length - 1].push(h); });
  const c = $('commentary');
  c.innerHTML = paras.map((p) => `<p>${p.join(' ')}</p>`).join('');
  c.setAttribute('contenteditable', state.editing ? 'true' : 'false');
  c.classList.toggle('commentary--editing', state.editing);

  $('legend').innerHTML = reviewer
    ? `<span>${TICK} every figure in the sentence agrees to the snapshot</span><span>${CROSS} this figure does not agree</span><span>${circled(1)} for the reviewer, see note</span>`
    : '';

  const rows = tableCells(ev.ms);
  $('figures').innerHTML = `<caption>Key figures, ${ev.ms.decisions.accrual === 'approved' ? 'with the approved accrual' : 'as posted'}</caption>
    <thead><tr><th></th><th>August</th><th>Budget</th><th>Last year</th><th class="gap">Year to date</th><th>Budget</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><th scope="row">${r.label}</th>${[...r.month, ...r.ytd].map((m, k) => `<td class="${k === 3 ? 'gap' : ''}${m.status === 'adjusted' ? ' adj' : ''}">${esc(m.display)}</td>`).join('')}</tr>`).join('')}</tbody>`;

  $('figuresYtd').innerHTML = `<caption>Year to date</caption><thead><tr><th></th><th>Actual</th><th>Budget</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><th scope="row">${r.label}</th>${r.ytd.map((m) => `<td class="${m.status === 'adjusted' ? 'adj' : ''}">${esc(m.display)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  // Other questions, not blocking: next to the commentary, where a finance director looks for them.
  const others = ev.questions.filter((q) => !q.blocksRelease && q.id !== 'accrual-aug-payroll');
  $('otherq').innerHTML = reviewer && others.length ? `<p class="otherq__h">Other questions, not blocking</p><ul>${others.map((q) => `<li><strong>${esc(q.title)}${/[?.]$/.test(q.title) ? '' : '.'}</strong> ${esc(q.detail)} ${esc(q.effect)}${q.hypotheses ? ` Possible reasons, not established: ${q.hypotheses.map((h) => esc(h.toLowerCase())).join('; ')}.` : ''}</li>`).join('')}</ul>` : '';
  const released = ev.releasable;
  const stamp = $('stamp');
  stamp.textContent = released ? `Released ${formatDateTime(state.signoff!.at)}` : 'Draft, not for release';
  stamp.classList.toggle('stamp--released', released);
  $('sheetFoot').textContent = `From the Xero snapshot of ${formatDateTime('2026-09-02T09:14:00Z')} and the payroll input approved on 1 September 2026. Figures fingerprint ${ev.ms.snapshotFingerprint}${ev.ms.decisions.accrual === 'approved' ? ', with one approved reporting adjustment' : ''}. Fictional agency. Prototype layout.`;
}

// ---------- The review column ----------
function renderReview() {
  const q = ev.questions.find((x) => x.id === 'accrual-aug-payroll')!;
  const acc = accrualEvidence(S);
  const open = computeProposed();
  const d = state.decisions.accrual;
  $('qc').innerHTML = d === 'approved'
    ? `<p class="qc__h">${TICK} Accrual of ${fmt(acc.total)} approved: gross margin ${open.gm1}, operating profit ${open.op1}.</p>
       ${ev.result.stale ? `<p class="qc__e">This draft was written for the posted figures; its claims below no longer hold.</p>` : ''}
       <div class="qc__a">${ev.result.stale ? '<button type="button" class="btn" data-act="useB">Use draft B, written for this snapshot</button>' : ''}<button type="button" class="btn btn--quiet" data-act="reopen">Reopen</button></div>`
    : `<p class="qc__k">Close question</p><p class="qc__h">${esc(q.title)}</p>
       <p class="qc__e">August gross margin ${open.gm0} → ${open.gm1} (budget ${open.gmb}); operating profit ${open.op0} → ${open.op1}. Payroll evidence below the page.</p>
       <div class="qc__a"><button type="button" class="btn" data-act="approve">Approve the accrual</button><button type="button" class="btn btn--quiet" data-act="hold"${d === 'held' ? ' disabled' : ''}>${d === 'held' ? 'On hold' : 'Hold for payroll'}</button></div>`;
  const slip = $('slip');
  $('review').classList.toggle('review--resolved', d === 'approved');
  slip.innerHTML = `
    <p class="slip__kind">Close question${d === 'approved' ? ', resolved' : d === 'held' ? ', on hold' : ''}</p>
    <h3 class="slip__q">${esc(q.title)}</h3>
    <p>The payroll input approved on 1 September 2026 for the September run holds ${acc.lines.length} lines earned in August. None is in the August ledger.</p>
    <table class="mini">
      <thead><tr><th>Earned in August</th><th>Gross</th><th>Employer NIC</th><th>Pension</th></tr></thead>
      <tbody>${acc.lines.map((l) => `<tr><td>${l.employee_ref}</td><td>${fmt(l.gross)}</td><td>${fmt(l.employer_nic)}</td><td>${fmt(l.employer_pension)}</td></tr>`).join('')}
      <tr class="tot"><td>Total</td><td>${fmt(acc.gross)}</td><td>${fmt(acc.nic)}</td><td>${fmt(acc.pension)}</td></tr></tbody>
    </table>
    <p class="mini__sum">Accrual: ${fmt(acc.gross)} + ${fmt(acc.nic)} + ${fmt(acc.pension)} = ${fmt(acc.total)}.</p>
    <table class="effect">
      <thead><tr><th>August</th><th>As posted</th><th>With the accrual</th></tr></thead>
      <tbody>
        <tr><td>Gross margin</td><td>${open.gm0}</td><td>${open.gm1}</td></tr>
        <tr><td>against budget of ${open.gmb}</td><td>${open.v0}</td><td>${open.v1}</td></tr>
        <tr><td>Operating profit</td><td>${open.op0}</td><td>${open.op1}</td></tr>
      </tbody>
    </table>
    <div class="slip__act">
      ${d === 'approved'
        ? `<p class="done">${TICK} Approved as a reporting adjustment. Post it in Xero as a manual journal dated 31 August, reversing 1 September.</p><button type="button" class="btn btn--quiet" data-act="reopen">Reopen the question</button>`
        : `<button type="button" class="btn" data-act="approve">Approve the accrual</button><button type="button" class="btn btn--quiet" data-act="hold"${d === 'held' ? ' disabled' : ''}>${d === 'held' ? 'On hold: waiting for payroll' : 'Hold for payroll'}</button>`}
    </div>`;

  // Notes: stale draft, failing and review sentences, omissions.
  const notes: string[] = [];
  if (ev.result.stale) {
    notes.push(`<div class="note note--stale"><p><strong>${esc(state.draft.key === 'A' ? 'Draft A' : 'This draft')} was written for the posted figures.</strong> Read against the snapshot with the accrual, its references now print different numbers and the words no longer fit them.</p>
      <button type="button" class="btn" data-act="useB">Use draft B, written for this snapshot</button></div>`);
  }
  let n = 0;
  ev.result.sentences.forEach((s, i) => {
    if (s.status === 'verified') return;
    n++;
    const accepted = state.reviewed.has(i);
    notes.push(`<div class="note note--${s.status}"><p class="note__h">${circled(n)} ${s.status === 'fail' ? 'Does not agree' : 'For the reviewer'}</p>
      <ul>${s.findings.map((f) => `<li>${esc(f.message)}</li>`).join('')}</ul>
      ${s.status === 'review' ? `<label class="accept"><input type="checkbox" data-accept="${i}"${accepted ? ' checked' : ''}> Accept as written</label>` : ''}</div>`);
  });
  for (const o of ev.result.omissions) notes.push(`<div class="note note--${o.severity}"><p class="note__h">${o.severity === 'fail' ? 'Missing' : 'Not mentioned'}</p><p>${esc(o.message)}</p></div>`);
  const editBtn = `<button type="button" class="btn btn--quiet" data-act="edit">${state.editing ? 'Done editing' : 'Edit the text'}</button>`;
  const header = `<div class="notes__head"><p><span class="count">${ev.result.counts.verified}</span> of ${ev.result.sentences.length} sentences agree to the snapshot${state.edited ? ', text edited by the reviewer' : ''}.</p>${editBtn}</div>`;
  $('notes').innerHTML = header + notes.join('') + `<p class="provenance">${esc(state.draft.label)}. Paragraph breaks are layout; the words are as Claude wrote them.</p>`;

  $('gates').innerHTML = `<p class="gates__h">Release</p><ul>${ev.gates.map((g) => `<li class="${g.ok ? 'ok' : 'no'}">${g.ok ? TICK : '<span class="box"></span>'}<span>${esc(g.label)}</span></li>`).join('')}</ul>
    <div class="gates__act">
      <button type="button" class="btn" data-act="signoff"${ev.signable && !ev.gates[5].ok ? '' : ' disabled'}>Sign off this version</button>
      <button type="button" class="btn" data-act="export"${ev.releasable ? '' : ' disabled'}>Export the page (.pptx)</button>
    </div>`;
}

function computeProposed() {
  const o = evaluate(S, { ...state, decisions: { accrual: 'open' } }).ms.metrics;
  const g = (id: string) => o.get(id)!;
  const dir = (m: Metric) => `${m.display} ${m.value! < 0 ? 'below' : 'above'}`;
  return {
    gm0: g('gross_margin.month.actual').display, gm1: g('gross_margin.month.actual@proposed').display, gmb: g('gross_margin.month.budget').display,
    v0: dir(g('gross_margin.month.vs_budget_pp')).replace(' percentage points', ' pts'), v1: dir(g('gross_margin.month.vs_budget_pp@proposed')).replace(' percentage points', ' pts'),
    op0: g('operating_profit.month.actual').display, op1: g('operating_profit.month.actual@proposed').display,
  };
}
const fmt = (n: number) => displayValue(n, 'gbp', false);

// ---------- Figure popover ----------
const pop = $('pop');
function showPop(el: HTMLElement) {
  const m = ev.ms.metrics.get(el.dataset.ref!);
  if (!m) return;
  const i = Number((el.closest('.sent') as HTMLElement)?.dataset.i);
  const findings = ev.result.sentences[i]?.findings.filter((f) => f.ref === m.id) ?? [];
  pop.innerHTML = `<p class="pop__v">${esc(m.display)}</p><p>${esc(m.label)}</p>
    <dl><dt>Calculation</dt><dd>${esc(m.calc)}</dd><dt>Source</dt><dd>${m.sources.map(esc).join('<br>')}</dd><dt>Status</dt><dd>${m.status === 'adjusted' ? 'Includes the approved accrual' : m.status === 'proposed' ? 'Includes an adjustment not yet approved' : 'As posted in Xero'}</dd><dt>Reference</dt><dd><code>${esc(m.id)}</code></dd></dl>
    ${findings.length ? `<ul class="pop__f">${findings.map((f) => `<li>${esc(f.message)}</li>`).join('')}</ul>` : `<p class="pop__ok">${TICK} Words and figure agree.</p>`}
    <button type="button" class="pop__x" data-act="closepop" aria-label="Close">Close</button>`;
  pop.hidden = false;
  const r = el.getBoundingClientRect();
  if (window.innerWidth > 720) {
    const w = 320;
    pop.style.left = `${Math.min(window.innerWidth - w - 16, Math.max(16, r.left + window.scrollX - 20))}px`;
    pop.style.top = `${r.bottom + window.scrollY + 8}px`;
  } else {
    pop.style.left = '';
    pop.style.top = '';
  }
}

// ---------- Editing: figures stay as references; words are free ----------
function serialise(root: HTMLElement): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) { out += n.textContent; return; }
    const el = n as HTMLElement;
    if (el.classList?.contains('fig')) { out += `[[${el.dataset.ref}]]`; return; }
    if (el.classList?.contains('mk-n') || el.tagName === 'svg') return;
    el.childNodes.forEach(walk);
    if (el.tagName === 'P') out += ' ';
  };
  root.childNodes.forEach(walk);
  return out.replace(/\s+/g, ' ').trim();
}
let t: number | undefined;
$('commentary').addEventListener('input', () => {
  clearTimeout(t);
  t = window.setTimeout(() => {
    const next = serialise($('commentary'));
    if (next === state.markup) return;
    state.markup = next;
    state.edited = true;
    state.signoff = null;
    state.reviewed = new Set();
    ev = evaluate(S, state);
    renderReview();
  }, 250);
});

// ---------- Actions ----------
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const fig = target.closest('.fig') as HTMLElement | null;
  if (fig && state.view === 'reviewer' && !state.editing) { showPop(fig); return; }
  const act = (target.closest('[data-act]') as HTMLElement | null)?.dataset.act;
  const view = (target.closest('button[data-view]') as HTMLElement | null)?.dataset.view as 'client' | 'reviewer' | undefined;
  if (view) {
    state.view = view;
    state.editing = false;
    document.querySelectorAll('button[data-view]').forEach((b) => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.view === view)));
    pop.hidden = true;
    renderSheet();
    return;
  }
  if (!act) { if (!pop.contains(target)) pop.hidden = true; return; }
  if (act === 'closepop') pop.hidden = true;
  if (act === 'approve') { state.decisions = { accrual: 'approved' }; state.signoff = null; }
  if (act === 'hold') { state.decisions = { accrual: 'held' }; state.signoff = null; }
  if (act === 'reopen') { state.decisions = { accrual: 'open' }; state.signoff = null; }
  if (act === 'useB') { state.draft = B; state.markup = B.markup; state.edited = false; state.reviewed = new Set(); state.signoff = null; }
  if (act === 'edit') { state.editing = !state.editing; }
  if (act === 'signoff') {
    state.signoff = { by: 'Reviewer (demo)', at: new Date().toISOString(), snapshotFingerprint: ev.ms.snapshotFingerprint, draftFingerprint: fingerprint(state.markup) };
  }
  if (act === 'export') {
    const pres = buildPptx(PptxGenJS, ev.ms, state.markup, { agency: ASSUMPTIONS.agency, released: `Released by ${state.signoff!.by}, ${formatDateTime(state.signoff!.at)}, text ${ev.result.draftFingerprint}.`, draftLabel: state.draft.label + (state.edited ? ', edited by the reviewer' : '') });
    pres.writeFile({ fileName: 'lowther-august-2026-commentary.pptx' });
    return;
  }
  update();
});
document.addEventListener('change', (e) => {
  const box = e.target as HTMLInputElement;
  if (box.dataset.accept === undefined) return;
  const i = Number(box.dataset.accept);
  if (box.checked) state.reviewed.add(i); else state.reviewed.delete(i);
  state.signoff = null;
  ev = evaluate(S, state);
  renderReview();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') pop.hidden = true;
  const el = document.activeElement as HTMLElement | null;
  if ((e.key === 'Enter' || e.key === ' ') && el?.classList.contains('fig') && !state.editing) { e.preventDefault(); showPop(el); }
});

// ---------- How it works ----------
function renderHow() {
  const { checks } = ev;
  $('checks').innerHTML = ev.checks.map((c) => `<li class="c--${c.status}">${c.status === 'pass' ? TICK : c.status === 'fail' ? CROSS : '<span class="mk-note">note</span>'}<div><p class="c__t">${esc(c.title)}</p><p>${esc(c.detail)}</p></div></li>`).join('');
  void checks;
  const basis: [string, string][] = [
    ['Period', 'August 2026; year to date 1 April to 31 August 2026, from the year end in Organisation (31 March, a fictional assumption).'],
    ['Snapshot', 'Pulled 1 and 2 September 2026, frozen and fingerprinted. August is not closed until the accrual question is answered.'],
    ['Revenue', 'Recognised when invoiced (illustrative policy), excluding VAT; credit notes reduce revenue in the month issued. No recharged costs in the period. GBP only.'],
    ['Budget', 'Xero Budgets endpoint, "FY2026-27 budget v2", approved by the board on 12 March 2026 (as its description states).'],
    ['Client margin', 'Not calculated: £96,000 of £120,000 August direct costs carry no client tracking. Needs time-based allocation from the timesheet tool.'],
    ['Utilisation, revenue per head', 'Not available: no timesheet or headcount source is connected.'],
    ['Adjustments', 'Posted, proposed and approved figures are kept apart; only approved ones reach the commentary.'],
    ['Materiality', `Set by us for the demo: £${ASSUMPTIONS.materialityGbp.toLocaleString('en-GB')} of gross profit or ${ASSUMPTIONS.materialityMarginPp.toFixed(1)} points of margin.`],
  ];
  $('basis').innerHTML = basis.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');

  const r = results as any;
  const bt = r.corrupted.byType as Record<string, { cases: number; failed: number; toReviewer: number; passed: number }>;
  $('results').innerHTML = `
    <h4>Test results, checker ${r.checker}</h4>
    <p>Twenty drafts written by Claude, ten per snapshot, as written:</p>
    <table class="res"><tbody>
      <tr><th>Sentences</th><td>${r.natural.sentences}</td></tr>
      <tr><th>Ticked: every figure checked, nothing outside the checked list</th><td>${r.natural.verified}</td></tr>
      <tr><th>To the reviewer (a cause, a judgement, a ranking, a negation, a figure without its measure)</th><td>${r.natural.review}</td></tr>
      <tr><th>Rejected</th><td>${r.natural.fail}</td></tr>
    </tbody></table>
    <p>Of the ${r.natural.fail} rejected, ${r.adjudication.realErrors} are real errors in what Claude wrote (${esc(r.adjudication.realSummary)}) and ${r.natural.fail - r.adjudication.realErrors} are the checker being wrong (${esc(r.adjudication.falseSummary)}). The previous version, ${r.previous.checker}, ticked ${r.previous.verified} of these sentences; a fresh review found wrong sentences it ticked, so ${r.checker} ticks fewer and asks the reviewer more. Both results are in the repository.</p>
    <p>The same sentences, corrupted on purpose, one change at a time:</p>
    <table class="res res--wide"><thead><tr><th>Change</th><th>Cases</th><th>Rejected</th><th>To the reviewer</th><th>Ticked</th></tr></thead><tbody>
      ${Object.entries(bt).map(([k, v]) => `<tr><th>${esc(k[0].toUpperCase() + k.slice(1))}</th><td>${v.cases}</td><td>${v.failed}</td><td>${v.toReviewer}</td><td>${v.passed}</td></tr>`).join('')}
      <tr class="tot"><th>All</th><td>${r.corrupted.cases}</td><td>${r.corrupted.failed}</td><td>${r.corrupted.toReviewer}</td><td>${r.corrupted.passed}</td></tr>
    </tbody></table>
    <p>Counts on one synthetic month, not an accuracy rate. Every case is listed in the repository.</p>`;
  $('modelLine').textContent = `${A.model} through Claude Code, on ${A.started.slice(0, 10)}`;
  $('links').innerHTML = `<a href="${r.repo}">Code, data and tests</a><a href="${r.repo}/blob/main/REFERENCE.md">The reference case, calculated by hand</a><a href="lowther-august-2026-commentary.pptx">The exported page (.pptx)</a>`;
}

update();
