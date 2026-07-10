import type { AnimateItem, FieldTargets } from '@/types'
import { WORKER_SOURCE } from './worker-source'

interface Pending {
  resolve: (t: FieldTargets) => void
  reject: (e: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

// A stuck worker (or a message that never gets a reply) must reject rather
// than hang the caller's promise forever — the caller falls back to the
// main-thread rasterizer on rejection.
const REQUEST_TIMEOUT_MS = 15_000
// The worker is torn down after sitting idle so it doesn't hold a thread for
// the page's lifetime; the next request just spins up a fresh one.
const IDLE_TIMEOUT_MS = 10_000

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()
let idleTimer: ReturnType<typeof setTimeout> | null = null

function disarmIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

function armIdleTimer(): void {
  disarmIdleTimer()
  if (!worker || pending.size > 0) return
  idleTimer = setTimeout(() => {
    idleTimer = null
    worker?.terminate()
    worker = null
  }, IDLE_TIMEOUT_MS)
}

/** Removes and returns the pending entry, clearing its timeout. */
function take(id: number): Pending | undefined {
  const p = pending.get(id)
  if (p) {
    pending.delete(id)
    clearTimeout(p.timer)
  }
  return p
}

function failAll(err: Error): void {
  for (const [, p] of pending) {
    clearTimeout(p.timer)
    p.reject(err)
  }
  pending.clear()
  disarmIdleTimer()
  worker?.terminate()
  worker = null
}

function getWorker(): Worker | null {
  if (worker) return worker
  try {
    // The worker is bundled to a self-contained string at build time and
    // instantiated from a Blob URL, so it ships inlined in the library and
    // works in any consumer regardless of their bundler's worker handling.
    const url = URL.createObjectURL(
      new Blob([WORKER_SOURCE], { type: 'text/javascript' }),
    )
    worker = new Worker(url, { type: 'module' })
    // The worker has its own reference to the resource now, so the object URL
    // can be released immediately instead of leaking for the page's lifetime.
    URL.revokeObjectURL(url)
    worker.onmessage = (e: MessageEvent): void => {
      const { id, targets, error } = e.data as {
        id: number
        targets?: FieldTargets
        error?: string
      }
      const p = take(id)
      if (!p) return
      if (error || !targets)
        p.reject(new Error(error ?? 'worker: empty result'))
      else p.resolve(targets)
      armIdleTimer()
    }
    worker.onerror = (): void => failAll(new Error('worker: error'))
    // A reply that fails to deserialize carries no id, so every in-flight
    // request must be failed over to the main-thread fallback.
    worker.onmessageerror = (): void =>
      failAll(new Error('worker: message deserialization failed'))
  } catch {
    worker = null
  }
  return worker
}

/** True only where a module worker + OffscreenCanvas exist. */
export function workerRasterAvailable(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
}

export function rasterizeViaWorker(
  width: number,
  height: number,
  item: AnimateItem,
  defaultFontFamily: string,
  alpha: number,
  pointSpacingCss: number,
  maxParticles: number,
  dpr: number,
): Promise<FieldTargets> {
  const w = getWorker()
  if (!w) return Promise.reject(new Error('worker: unavailable'))
  disarmIdleTimer()
  const id = nextId++
  return new Promise<FieldTargets>((resolve, reject) => {
    const timer = setTimeout(() => {
      take(id)?.reject(new Error('worker: timed out'))
      armIdleTimer()
    }, REQUEST_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    w.postMessage({
      id,
      item,
      width,
      height,
      defaultFontFamily,
      alpha,
      pointSpacingCss,
      maxParticles,
      dpr,
    })
  })
}
