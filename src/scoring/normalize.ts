export function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

export function scoreByBenchmark(value: number, maxValue: number): number {
  if (maxValue <= 0) {
    return 0;
  }

  return clampScore((value / maxValue) * 100);
}

// ── Log-scale benchmark scoring ───────────────────────────────────────────
// Population spans orders of magnitude (rural village: 500 → global city: 10M).
// Linear scoring against a 1M benchmark gives Times Square a score of 2/100
// because the neighbourhood population (17,749) is tiny relative to 1M.
// Log scale fixes this: log10(17749)/log10(1M) = 4.25/6 → 71/100.
// A city like NYC (pop ~8M) correctly scores 100/100.
// A small town (pop 5,000) scores log10(5000)/6 * 100 ≈ 62/100 — still
// meaningful for a real trading area.

export function scoreByLogBenchmark(value: number, maxValue: number): number {
  if (maxValue <= 0 || value <= 0) {
    return 0;
  }

  const logScore = Math.log10(value) / Math.log10(maxValue);
  return clampScore(logScore * 100);
}

export function weightedAverage(parts: Array<{ score: number; weight: number }>): number | null {
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  if (totalWeight <= 0) {
    return null;
  }

  const weighted = parts.reduce((sum, part) => sum + part.score * part.weight, 0);
  return clampScore(weighted / totalWeight);
}
