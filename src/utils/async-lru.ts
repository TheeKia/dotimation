/**
 * Tiny promise-valued LRU over an insertion-ordered Map. `get` refreshes
 * recency; `set` evicts the oldest entries past `max` (invoking `onEvict`
 * so resource-backed values — e.g. ImageBitmaps — can be released).
 * `delete` is for the owner discarding a failed load; it does NOT evict-notify.
 */
export interface AsyncLru<V> {
  get(key: string): Promise<V> | undefined
  set(key: string, value: Promise<V>): void
  delete(key: string): void
}

export function createAsyncLru<V>(
  max: number,
  onEvict?: (value: Promise<V>) => void,
): AsyncLru<V> {
  const map = new Map<string, Promise<V>>()
  return {
    get(key): Promise<V> | undefined {
      const value = map.get(key)
      if (value !== undefined) {
        map.delete(key)
        map.set(key, value)
      }
      return value
    },
    set(key, value): void {
      map.delete(key)
      map.set(key, value)
      for (const oldest of map.keys()) {
        if (map.size <= max) break
        const evicted = map.get(oldest)
        map.delete(oldest)
        if (evicted !== undefined) onEvict?.(evicted)
      }
    },
    delete(key): void {
      map.delete(key)
    },
  }
}
