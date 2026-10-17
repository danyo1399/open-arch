/** Closest candidate to `input` by edit distance, if any is close enough to be a likely typo. */
export function suggest(input: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  const limit = Math.max(1, Math.floor(input.length / 3));
  for (const candidate of candidates) {
    const d = distance(input, candidate);
    if (d < bestDistance && d <= limit) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length]!;
}
