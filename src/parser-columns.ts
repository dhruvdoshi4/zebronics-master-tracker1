export function findColumnIndex(
  headers: string[],
  aliases: readonly string[],
  options?: { headerFilter?: (header: string) => boolean },
): number {
  const accept = options?.headerFilter ?? (() => true);
  for (const alias of aliases) {
    const exact = headers.findIndex((h) => h === alias && accept(h));
    if (exact >= 0) return exact;
    const partial = headers.findIndex(
      (h) => Boolean(h) && h.includes(alias) && accept(h),
    );
    if (partial >= 0) return partial;
  }
  return -1;
}

export function findColumnIndexInRange(
  headers: string[],
  aliases: readonly string[],
  start: number,
  end: number,
): number {
  for (let i = start; i < end; i++) {
    for (const alias of aliases) {
      const h = headers[i];
      if (!h) continue;
      if (h === alias || h.includes(alias)) return i;
    }
  }
  return -1;
}

export function findAllColumnIndices(
  headers: string[],
  aliases: readonly string[],
): number[] {
  const indices: number[] = [];
  for (let i = 0; i < headers.length; i++) {
    for (const alias of aliases) {
      const h = headers[i];
      if (!h) continue;
      if (h === alias || h.includes(alias)) {
        indices.push(i);
        break;
      }
    }
  }
  return indices;
}

export function findExactColumnIndices(
  headers: string[],
  names: readonly string[],
): number[] {
  return headers.map((h, i) => (names.includes(h) ? i : -1)).filter((i) => i >= 0);
}
