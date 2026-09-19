import type { AnimateItem } from '@kiaa/dotimation-react'
import type { ItemConfig } from './types'

/** Map the playground's always-populated ItemConfig to the library's AnimateItem. */
export function toAnimateItem(item: ItemConfig): AnimateItem {
  if (item.type === 'text') {
    return {
      type: 'text',
      data: item.data,
      fontFamily: item.fontFamily,
      fontSize: item.fontSize,
      textColor: item.textColor,
    }
  }
  return {
    type: 'image',
    data: item.data,
    maxWidth: item.maxWidth,
    maxHeight: item.maxHeight,
    invert: item.invert,
  }
}
