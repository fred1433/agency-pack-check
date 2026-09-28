// Rounding and display. One rule everywhere: round half away from zero, at display precision,
// from the unrounded value (variances are computed before rounding, never from rounded parts).

export function roundHalfAway(x: number, dp: number): number {
  const f = 10 ** dp;
  // The epsilon absorbs binary noise such as 1.005 * 100 = 100.49999999999999.
  const r = Math.round(Math.abs(x) * f + 1e-9) / f;
  return x < 0 ? -r : r;
}

const GBP = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0, minimumFractionDigits: 0 });

export type Unit = 'gbp' | 'pct' | 'pp';

export function displayValue(value: number | null, unit: Unit, magnitudeOnly: boolean): string {
  if (value === null) return 'n/m';
  const v = magnitudeOnly ? Math.abs(value) : value;
  if (unit === 'gbp') {
    const r = roundHalfAway(v, 0);
    return (r < 0 ? '-£' : '£') + GBP.format(Math.abs(r));
  }
  const r = roundHalfAway(v, 1);
  if (unit === 'pct') return `${r.toFixed(1)}%`;
  return `${r.toFixed(1)} percentage point${r === 1 ? '' : 's'}`;
}

// Whether a value shows as zero at display precision (drives "in line with").
export function roundsToZero(value: number, unit: Unit): boolean {
  return roundHalfAway(value, unit === 'gbp' ? 0 : 1) === 0;
}
