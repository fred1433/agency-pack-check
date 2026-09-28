// Produces the committed export from the released state: accrual approved, draft B, review items accepted, signed off.
// Refuses to export anything the release control would not release.
import PptxGenJS from 'pptxgenjs';
import { mkdirSync, copyFileSync } from 'node:fs';
import { loadSources } from '../src/sources-node.ts';
import { pinnedDrafts } from '../src/pinned-node.ts';
import { evaluate, buildPptx, formatDateTime, applyReviewerEdits, type Review } from '../src/pack.ts';
import { ASSUMPTIONS } from '../src/engine.ts';
import { fingerprint } from '../src/hash.ts';

const s = loadSources();
const { B } = pinnedDrafts(s);
const edits = applyReviewerEdits(B.markup);
const review: Review = { decisions: { accrual: 'approved' }, markup: edits.markup, draft: B, edited: true, authored: edits.authored, reviewed: new Set(), signoff: null };
let ev = evaluate(s, review);
ev.result.sentences.forEach((x, i) => { if (x.status === 'review') review.reviewed.add(i); });
// The sample release is signed when this script runs (no back-dated sign-off).
ev = evaluate(s, review);
if (!ev.signable) throw new Error('Not signable: ' + JSON.stringify(ev.gates));
review.signoff = { by: 'Reviewer (demo)', at: new Date().toISOString(), snapshotFingerprint: ev.ms.snapshotFingerprint, draftFingerprint: fingerprint(review.markup) };
ev = evaluate(s, review);
if (!ev.releasable) throw new Error('Not releasable: ' + JSON.stringify(ev.gates));
const pres = buildPptx(PptxGenJS, ev.ms, review.markup, { agency: ASSUMPTIONS.agency, released: `Released by Reviewer (demo), ${formatDateTime(review.signoff.at)}, text ${ev.result.draftFingerprint}.`, draftLabel: `${B.label}, with two reviewer edits`, authored: edits.authored });
mkdirSync(new URL('../exports/', import.meta.url), { recursive: true });
const out = new URL('../exports/lowther-august-2026-commentary.pptx', import.meta.url).pathname;
await pres.writeFile({ fileName: out });
mkdirSync(new URL('../site/', import.meta.url), { recursive: true });
copyFileSync(out, new URL('../site/lowther-august-2026-commentary.pptx', import.meta.url).pathname);
mkdirSync(new URL('../deploy/agency-pack/', import.meta.url), { recursive: true });
copyFileSync(out, new URL('../deploy/agency-pack/lowther-august-2026-commentary.pptx', import.meta.url).pathname);
console.log('exported', out, 'accepted review items:', [...review.reviewed]);
