import { describe, expect, test } from 'bun:test'
import { createAsyncLru } from '@/utils/async-lru'

describe('createAsyncLru', () => {
  test('stores and retrieves values', async () => {
    const lru = createAsyncLru<number>(2)
    lru.set('a', Promise.resolve(1))
    expect(await lru.get('a')).toBe(1)
    expect(lru.get('missing')).toBeUndefined()
  })

  test('evicts the least-recently-used entry past max', () => {
    const lru = createAsyncLru<string>(2)
    lru.set('a', Promise.resolve('A'))
    lru.set('b', Promise.resolve('B'))
    lru.get('a') // refresh: 'b' is now oldest
    lru.set('c', Promise.resolve('C'))
    expect(lru.get('b')).toBeUndefined()
    expect(lru.get('a')).toBeDefined()
    expect(lru.get('c')).toBeDefined()
  })

  test('eviction callback receives the evicted promise', async () => {
    const evicted: number[] = []
    const lru = createAsyncLru<number>(1, (v) => {
      void v.then((n) => evicted.push(n))
    })
    lru.set('a', Promise.resolve(1))
    lru.set('b', Promise.resolve(2))
    await Bun.sleep(0)
    expect(evicted).toEqual([1])
    expect(lru.get('a')).toBeUndefined()
    expect(lru.get('b')).toBeDefined()
  })

  test('delete removes without the evict callback', () => {
    const evicted: number[] = []
    const lru = createAsyncLru<number>(2, (v) => {
      void v.then((n) => evicted.push(n))
    })
    lru.set('a', Promise.resolve(1))
    lru.delete('a')
    expect(lru.get('a')).toBeUndefined()
    expect(evicted).toEqual([])
  })

  test('re-setting a key does not double-count toward max', () => {
    const lru = createAsyncLru<number>(2)
    lru.set('a', Promise.resolve(1))
    lru.set('a', Promise.resolve(2))
    lru.set('b', Promise.resolve(3))
    expect(lru.get('a')).toBeDefined()
    expect(lru.get('b')).toBeDefined()
  })
})
