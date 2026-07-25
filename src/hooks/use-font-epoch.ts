import { useEffect, useState } from 'react'
import { isGenericFamily } from '@/raster/worker-safe'
import type { AnimateItem } from '@/types'

/**
 * Bumps once when the item's custom font finishes loading, so text first
 * rasterized with fallback metrics gets re-rasterized with the real ones.
 * Generic families never load asynchronously; the epoch stays 0 for those.
 */
export function useFontEpoch(
  item: AnimateItem,
  defaultFontFamily: string,
): number {
  const [epoch, setEpoch] = useState(0)
  const family =
    item.type === 'text' ? (item.fontFamily ?? defaultFontFamily) : null

  useEffect(() => {
    if (family === null || isGenericFamily(family)) return
    if (typeof document === 'undefined' || !document.fonts) return
    let cancelled = false
    try {
      if (document.fonts.check(`16px ${family}`)) return
    } catch {
      // Unparseable family string — nothing to wait for.
      return
    }
    document.fonts
      .load(`16px ${family}`)
      .then((faces) => {
        // load() resolves with [] when no matching @font-face exists; only a
        // real arrival warrants a re-raster.
        if (!cancelled && faces.length > 0) setEpoch((e) => e + 1)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [family])

  return epoch
}
