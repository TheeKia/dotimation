/**
 * Serializes async work with a one-slot queue: at most one `run` is in flight,
 * and while it runs only the NEWEST submitted input is kept. Used to coalesce
 * rasterization during input storms (e.g. a drag-resize) — every stale
 * intermediate is skipped, the latest always runs.
 *
 * `run` must handle its own errors; a rejection here would detach the chain.
 */
export function createLatestWins<T>(
  run: (input: T) => Promise<void>,
): (input: T) => void {
  let inFlight = false
  let queued: { input: T } | null = null

  const kick = (input: T): void => {
    inFlight = true
    void run(input).finally(() => {
      inFlight = false
      if (queued) {
        const next = queued.input
        queued = null
        kick(next)
      }
    })
  }

  return (input: T): void => {
    if (inFlight) queued = { input }
    else kick(input)
  }
}
