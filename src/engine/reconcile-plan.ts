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
 */
export function planReconcile(
  prevActive: number,
  prevCount: number,
  newActive: number,
): FieldDelta {
  const oldFaders = prevCount - prevActive

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
    return {
      active: newActive,
      count: prevCount,
      overlap: newActive,
      relocate: null,
      spawn: null,
      firstLoad: false,
    }
  }

  return {
    active: newActive,
    count: newActive + oldFaders,
    overlap: prevActive,
    relocate:
      oldFaders > 0
        ? { from: prevActive, to: newActive, len: oldFaders }
        : null,
    spawn: { start: prevActive, end: newActive },
    firstLoad: false,
  }
}
