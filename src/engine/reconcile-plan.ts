export const STATE_FLOATS = 8
export const TARGET_FLOATS = 6

export interface FieldDelta {
  active: number
  count: number
  overlap: number
  relocate: { from: number; to: number; len: number } | null
  spawn: { start: number; end: number } | null
  firstLoad: boolean
}

/**
 * Computes the structural morph from the previous layout to `newActive` targets,
 * matching `reconcile`'s slot semantics. Pure — drives both the CPU SoA mutation
 * (Canvas2D) and the GPU buffer ops (WebGL2).
 *
 * Each transition keeps at most one generation of faders: only the live cluster
 * `[0, prevActive)` carries forward. Faders still in flight from an *earlier*
 * transition are superseded the moment a new one starts, so they are dropped
 * (left outside `count`) rather than carried/relocated. Otherwise leftovers from
 * the image two steps back stay visible at their old positions and bleed that
 * image into the current morph (the "parts of A surface during B->C" bug). The
 * plan therefore depends only on `prevActive` and `newActive` — never on the
 * accumulated `prevCount` — which also keeps it identical whether the previous
 * count came from the CPU field or a GPU backend that expires faders on its own.
 */
export function planReconcile(
  prevActive: number,
  prevCount: number,
  newActive: number,
): FieldDelta {
  if (prevCount === 0) {
    return {
      active: newActive,
      count: newActive,
      overlap: 0,
      relocate: null,
      spawn: { start: 0, end: newActive },
      firstLoad: true,
    }
  }

  if (newActive <= prevActive) {
    // Shrink: the live surplus [newActive, prevActive) becomes the new faders;
    // any older faders past prevActive are dropped (excluded from count).
    return {
      active: newActive,
      count: prevActive,
      overlap: newActive,
      relocate: null,
      spawn: null,
      firstLoad: false,
    }
  }

  // Growth: spawn the new actives from the live cluster (so they grow in from
  // the current image, not the old one). Older faders are dropped — the spawn
  // overwrites the slots it reuses and count stops at newActive, so nothing of
  // the previous image survives into this transition.
  return {
    active: newActive,
    count: newActive,
    overlap: prevActive,
    relocate: null,
    spawn: { start: prevActive, end: newActive },
    firstLoad: false,
  }
}
