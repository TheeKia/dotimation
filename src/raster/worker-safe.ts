import type { AnimateItem } from '@/types'

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
])

/** True when `family` is a CSS generic (available in workers and never async-loaded). */
export function isGenericFamily(family: string): boolean {
  return GENERIC_FAMILIES.has(family.trim().toLowerCase())
}

/**
 * Whether `item` can be rasterized in a Web Worker without a font discrepancy.
 * Images always can. Text can only when its resolved family is a CSS generic
 * (workers have a separate font set, so custom fonts must stay on the main
 * thread where the document's fonts are available) and its fill is a plain
 * color string.
 */
export function isWorkerSafe(
  item: AnimateItem,
  defaultFontFamily: string,
): boolean {
  if (item.type === 'image') return true
  // Gradient/pattern fills are bound to a main-thread context and are not
  // structured-cloneable — postMessage would throw DataCloneError.
  if (item.textColor !== undefined && typeof item.textColor !== 'string') {
    return false
  }
  return isGenericFamily(item.fontFamily ?? defaultFontFamily)
}
