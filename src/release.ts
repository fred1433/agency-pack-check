// Release control: a draft can leave the firm only when every condition below holds.
import type { DraftResult } from './claims.ts';
import type { CheckResult, Question } from './engine.ts';

export type Signoff = { by: string; at: string; snapshotFingerprint: string; draftFingerprint: string };
export type ReleaseState = {
  checks: CheckResult[]; questions: Question[]; draft: DraftResult; snapshotFingerprint: string;
  reviewed: Set<number>; // indexes of "review" sentences the reviewer has accepted
  signoff: Signoff | null;
};
export type Gate = { ok: boolean; label: string };

export function releaseGates(st: ReleaseState): Gate[] {
  const failedChecks = st.checks.filter((c) => c.status === 'fail');
  const blocking = st.questions.filter((q) => q.blocksRelease);
  const failing = st.draft.sentences.filter((s) => s.status === 'fail').length + st.draft.omissions.filter((o) => o.severity === 'fail').length;
  // Every sentence with a point for the reviewer counts, including those that also fail: nothing turns green unread.
  const unreviewed = st.draft.sentences.map((s, i) => (s.findings.some((f) => f.severity === 'review') && !(s.status === 'review' && st.reviewed.has(i)) ? 1 : 0)).reduce((a: number, b: number) => a + b, 0);
  const signoffValid = !!st.signoff && st.signoff.snapshotFingerprint === st.snapshotFingerprint && st.signoff.draftFingerprint === st.draft.draftFingerprint;
  return [
    { ok: failedChecks.length === 0, label: failedChecks.length ? `Source controls: ${failedChecks.length} not passing` : 'Source controls pass' },
    { ok: blocking.length === 0, label: blocking.length ? `Close questions open: ${blocking.map((q) => q.title).join('; ')}` : 'No material close question open' },
    { ok: !st.draft.stale, label: st.draft.stale ? 'Draft was written for a different snapshot' : 'Draft written for this snapshot' },
    { ok: failing === 0, label: failing ? `${failing} claim${failing === 1 ? '' : 's'} failing` : 'No failing claims' },
    { ok: unreviewed === 0, label: unreviewed ? `${unreviewed} statement${unreviewed === 1 ? '' : 's'} awaiting the reviewer` : 'No statement awaiting the reviewer' },
    { ok: signoffValid, label: signoffValid ? `Signed off by ${st.signoff!.by}` : st.signoff ? 'Sign-off void: text or snapshot changed since' : 'Not signed off' },
  ];
}

export const canRelease = (st: ReleaseState) => releaseGates(st).every((g) => g.ok);
// Sign-off is possible once everything but the sign-off itself holds.
export const canSignOff = (st: ReleaseState) => releaseGates(st).slice(0, 5).every((g) => g.ok);
