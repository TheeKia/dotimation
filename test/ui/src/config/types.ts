import type { BackendKind, IdleBehavior } from 'dotimation'

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
  dotSize: number
  pointSpacingCss: number
  alpha: number
  defaultFontFamily: string
  backend: BackendKind
  idle: IdleBehavior
  maxParticles: number | undefined
  stageSize: StageSize
  bg: BgKind
}
