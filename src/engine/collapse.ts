import type { FieldTargets } from '@/types'

/**
 * A uniform spatial hash over a target layout's home positions, built once so
 * many nearest-neighbour queries are each ~O(1). Used when an image shrinks: the
 * surplus dots look up the nearest surviving dot to collapse into as they fade.
 *
 * Pure and self-contained — `buildTargetGrid` reads only the targets, and
 * `nearestTarget` reads only the grid, so both are unit-testable without DOM.
 */
export interface TargetGrid {
  minX: number
  minY: number
  cellSize: number
  cols: number
  rows: number
  /** CSR offsets: cell c owns items[cellStart[c] .. cellStart[c + 1]). */
  cellStart: Int32Array
  /** Target indices bucketed by cell. */
  items: Int32Array
  targets: FieldTargets
  count: number
}

function cellOf(
  grid: TargetGrid,
  x: number,
  y: number,
): { cx: number; cy: number } {
  let cx = Math.floor((x - grid.minX) / grid.cellSize)
  let cy = Math.floor((y - grid.minY) / grid.cellSize)
  // Clamp into the grid so a query outside the bounding box starts its search at
  // the nearest edge cell instead of expanding across empty space.
  if (cx < 0) cx = 0
  else if (cx >= grid.cols) cx = grid.cols - 1
  if (cy < 0) cy = 0
  else if (cy >= grid.rows) cy = grid.rows - 1
  return { cx, cy }
}

export function buildTargetGrid(
  targets: FieldTargets,
  count: number,
): TargetGrid {
  const { homeX, homeY } = targets
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < count; i++) {
    const x = homeX[i]!
    const y = homeY[i]!
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  if (count === 0) {
    minX = minY = 0
    maxX = maxY = 0
  }

  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  // Aim for roughly one target per cell on average, so a query scans only a
  // handful of cells before the nearest is found.
  const cellSize = Math.max(Math.sqrt((spanX * spanY) / Math.max(count, 1)), 1)
  const cols = Math.floor(spanX / cellSize) + 1
  const rows = Math.floor(spanY / cellSize) + 1

  const cellStart = new Int32Array(cols * rows + 1)
  const items = new Int32Array(count)
  const grid: TargetGrid = {
    minX,
    minY,
    cellSize,
    cols,
    rows,
    cellStart,
    items,
    targets,
    count,
  }

  // Counting sort into CSR buckets: tally per cell, prefix-sum, then scatter.
  for (let i = 0; i < count; i++) {
    const { cx, cy } = cellOf(grid, homeX[i]!, homeY[i]!)
    cellStart[cy * cols + cx + 1]!++
  }
  for (let c = 0; c < cols * rows; c++) cellStart[c + 1]! += cellStart[c]!
  const cursor = cellStart.slice(0, cols * rows)
  for (let i = 0; i < count; i++) {
    const { cx, cy } = cellOf(grid, homeX[i]!, homeY[i]!)
    const cell = cy * cols + cx
    items[cursor[cell]!++] = i
  }

  return grid
}

/**
 * Index of the target whose home position is closest to (x, y), or -1 when the
 * grid is empty. Expands ring by ring from the query's cell and stops once no
 * unexamined ring could hold anything closer than the best found so far.
 */
export function nearestTarget(grid: TargetGrid, x: number, y: number): number {
  if (grid.count === 0) return -1
  const { cols, rows, cellSize, cellStart, items, targets } = grid
  const { homeX, homeY } = targets
  const { cx, cy } = cellOf(grid, x, y)

  let best = -1
  let bestSq = Infinity
  const maxRing = cols + rows

  for (let r = 0; r <= maxRing; r++) {
    const y0 = Math.max(0, cy - r)
    const y1 = Math.min(rows - 1, cy + r)
    const x0 = Math.max(0, cx - r)
    const x1 = Math.min(cols - 1, cx + r)
    for (let gy = y0; gy <= y1; gy++) {
      const onYEdge = gy === cy - r || gy === cy + r
      for (let gx = x0; gx <= x1; gx++) {
        // Only the ring's perimeter is new at radius r; skip the interior the
        // earlier radii already covered.
        if (!onYEdge && gx !== cx - r && gx !== cx + r) continue
        const cell = gy * cols + gx
        for (let k = cellStart[cell]!; k < cellStart[cell + 1]!; k++) {
          const idx = items[k]!
          const dx = homeX[idx]! - x
          const dy = homeY[idx]! - y
          const d = dx * dx + dy * dy
          if (d < bestSq) {
            bestSq = d
            best = idx
          }
        }
      }
    }
    // Any cell in ring r+1 is at least r*cellSize away from the query point, so
    // once the best is within that bound no later ring can improve on it.
    if (best !== -1) {
      const ringMin = r * cellSize
      if (ringMin * ringMin >= bestSq) break
    }
  }

  return best
}
