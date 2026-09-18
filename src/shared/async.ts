// Sequential iteration preserves transaction ordering and short-circuit predicates.
export async function mapAsync<T, U>(items: readonly T[], fn: (item: T, index: number) => Promise<U>): Promise<U[]> {
  const result: U[] = [];
  for (const [index, item] of items.entries()) result.push(await fn(item, index));
  return result;
}
export async function flatMapAsync<T, U>(items: readonly T[], fn: (item: T, index: number) => Promise<U[]>): Promise<U[]> {
  return (await mapAsync(items, fn)).flat();
}
export async function filterAsync<T>(items: readonly T[], fn: (item: T, index: number) => Promise<unknown>): Promise<T[]> {
  const result: T[] = [];
  for (const [index, item] of items.entries()) if (await fn(item, index)) result.push(item);
  return result;
}
export async function someAsync<T>(items: readonly T[], fn: (item: T, index: number) => Promise<unknown>): Promise<boolean> {
  for (const [index, item] of items.entries()) if (await fn(item, index)) return true;
  return false;
}
export async function everyAsync<T>(items: readonly T[], fn: (item: T, index: number) => Promise<unknown>): Promise<boolean> {
  for (const [index, item] of items.entries()) if (!await fn(item, index)) return false;
  return true;
}
export async function forEachAsync<T>(items: readonly T[], fn: (item: T, index: number) => Promise<unknown>): Promise<void> {
  for (const [index, item] of items.entries()) await fn(item, index);
}
