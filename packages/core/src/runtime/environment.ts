import { isGenericFamily } from '../raster/worker-safe'
import type { AnimateItem } from '../types'

export function systemReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

/** Re-arm the resolution query after every monitor/zoom change. */
export function watchDpr(change: () => void): () => void {
  let remove = (): void => {}
  const arm = (): void => {
    remove()
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia(
      `(resolution: ${window.devicePixelRatio}dppx)`,
    )
    const listener = (): void => {
      arm()
      change()
    }
    query.addEventListener('change', listener)
    remove = () => query.removeEventListener('change', listener)
  }
  arm()
  return () => remove()
}

export function watchReducedMotion(change: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const query = window.matchMedia('(prefers-reduced-motion: reduce)')
  query.addEventListener('change', change)
  return () => query.removeEventListener('change', change)
}

/** Watch the actual text so unicode-range font subsets load as needed. */
export function watchFont(
  item: AnimateItem,
  defaultFamily: string,
  loaded: () => void,
): () => void {
  let cancelled = false
  const family =
    item.type === 'text' ? (item.fontFamily ?? defaultFamily) : null
  if (
    family &&
    !isGenericFamily(family) &&
    typeof document !== 'undefined' &&
    document.fonts
  ) {
    try {
      if (!document.fonts.check(`16px ${family}`, item.data)) {
        void document.fonts
          .load(`16px ${family}`, item.data)
          .then((faces) => {
            if (!cancelled && faces.length > 0) loaded()
          })
          .catch(() => {})
      }
    } catch {
      // Invalid CSS font syntax has no loadable face.
    }
  }
  return () => {
    cancelled = true
  }
}
