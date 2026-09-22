export function findById<T extends { id: string }>(items: readonly T[] | undefined, id: string): T | undefined {
  return items?.find((item) => item.id === id);
}

export function replaceById<T extends { id: string }>(items: readonly T[] | undefined, replacement: T): T[] {
  const current = items ?? [];
  if (!current.some((item) => item.id === replacement.id)) return [...current, replacement];
  return current.map((item) => item.id === replacement.id ? replacement : item);
}