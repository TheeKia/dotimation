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

/**
 * Whether `item` can be rasterized in a Web Worker without a font discrepancy.
 * Images always can. Text can only when its resolved family is a CSS generic
 * (workers have a separate font set, so custom fonts must stay on the main
 * thread where the document's fonts are available).
 */
export function isWorkerSafe(
  item: AnimateItem,
  defaultFontFamily: string,
): boolean {
  if (item.type === 'image') return true
  const family = (item.fontFamily ?? defaultFontFamily).trim().toLowerCase()
  return GENERIC_FAMILIES.has(family)
}
