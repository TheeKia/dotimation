import type { BackendKind } from 'dotimation'

export type TextItemConfig = {
  type: 'text'
  data: string
  fontFamily: string
  fontSize: number | 'AUTO' | 'AUTO_MONO'
  textColor: string
}

export type ImageItemConfig = {
  type: 'image'
  data: string
  maxWidth: number | undefined
  maxHeight: number | undefined
  invert: boolean
}

export type ItemConfig = TextItemConfig | ImageItemConfig

export type SlotId = 'A' | 'B'

export type StageSize =
  | { mode: 'preset'; w: number; h: number }
  | { mode: 'fill' }
  | { mode: 'custom'; w: number; h: number }

export type BgKind = 'dark' | 'light' | 'checker'

export type PlaygroundConfig = {
  slots: Record<SlotId, ItemConfig>
  active: SlotId
  size: number
  spacing: number
  threshold: number
  max: number | undefined
  defaultFontFamily: string
  backend: BackendKind
  jitter: number
  settleTime: number
  damping: number
  fade: number
  reducedMotion: boolean
  stageSize: StageSize
  bg: BgKind
}
