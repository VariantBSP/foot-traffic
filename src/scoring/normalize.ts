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

export function weightedAverage(parts: Array<{ score: number; weight: number }>): number | null {
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  if (totalWeight <= 0) {
    return null;
  }

  const weighted = parts.reduce((sum, part) => sum + part.score * part.weight, 0);
  return clampScore(weighted / totalWeight);
}
