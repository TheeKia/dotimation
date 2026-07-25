import { describe, expect, test } from 'bun:test'
import { createLatestWins } from '@/utils/latest-wins'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('createLatestWins', () => {
  test('runs immediately when idle', async () => {
    const ran: number[] = []
    const schedule = createLatestWins<number>(async (n) => {
      ran.push(n)
    })
    schedule(1)
    await Bun.sleep(0)
    expect(ran).toEqual([1])
  })

  test('while busy, keeps only the newest input and runs it after', async () => {
    const ran: number[] = []
    const gate = deferred()
    const schedule = createLatestWins<number>(async (n) => {
      ran.push(n)
      if (n === 1) await gate.promise
    })
    schedule(1) // starts, blocks on the gate
    schedule(2) // queued
    schedule(3) // replaces 2
    expect(ran).toEqual([1])
    gate.resolve()
    await Bun.sleep(0)
    expect(ran).toEqual([1, 3])
  })

  test('an input submitted after completion runs fresh', async () => {
    const ran: number[] = []
    const schedule = createLatestWins<number>(async (n) => {
      ran.push(n)
    })
    schedule(1)
    await Bun.sleep(0)
    schedule(2)
    await Bun.sleep(0)
    expect(ran).toEqual([1, 2])
  })
})
