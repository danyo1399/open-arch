/** Closest candidate to `input`: the only one it abbreviates ("desc"), else one a typo away. */
export function suggest(input: string, candidates: Iterable<string>): string | undefined {
  const list = [...candidates];
  const prefixed = input.length >= 3 ? list.filter((c) => c.startsWith(input) && c !== input) : [];
  if (prefixed.length === 1) return prefixed[0];
  let best: string | undefined;
  let bestDistance = Infinity;
  const limit = Math.max(1, Math.floor(input.length / 3));
  for (const candidate of list) {
    const d = distance(input, candidate);
    if (d < bestDistance && d <= limit) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

/** Edits to turn `a` into `b`: insert, delete, replace, or swap two neighbouring letters. */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}
