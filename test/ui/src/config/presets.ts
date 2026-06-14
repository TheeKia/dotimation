import type {
  ImageItemConfig,
  ItemConfig,
  PlaygroundConfig,
  TextItemConfig,
} from './types'

export const TEXT_DEFAULT: TextItemConfig = {
  type: 'text',
  data: 'Hello\nDotimation',
  fontFamily: 'sans-serif',
  fontSize: 'AUTO',
  textColor: '#22d3ee',
}

export const IMAGE_DEFAULT: ImageItemConfig = {
  type: 'image',
  data: 'https://th-wave.s3.us-east-1.amazonaws.com/general/logo.svg',
  maxWidth: undefined,
  maxHeight: undefined,
  invert: false,
}

export const PRESETS: { label: string; item: ItemConfig }[] = [
  { label: 'Hello', item: TEXT_DEFAULT },
  {
    label: 'Mono',
    item: {
      type: 'text',
      data: 'DOTS\n0123456789',
      fontFamily: 'monospace',
      fontSize: 'AUTO_MONO',
      textColor: '#22d3ee',
    },
  },
  {
    label: 'Stress',
    item: {
      type: 'text',
      data: 'DOTIMATION\nDOTIMATION\nDOTIMATION\nDOTIMATION',
      fontFamily: 'sans-serif',
      fontSize: 'AUTO',
      textColor: '#a3e635',
    },
  },
  { label: 'Logo', item: IMAGE_DEFAULT },
]

export const DEFAULT_CONFIG: PlaygroundConfig = {
  slots: { A: TEXT_DEFAULT, B: IMAGE_DEFAULT },
  active: 'A',
  dotSize: 1,
  pointSpacingCss: 2,
  alpha: 128,
  defaultFontFamily: 'sans-serif',
  backend: 'auto',
  idle: 'animate',
  maxParticles: undefined,
  stageSize: { mode: 'fill' },
  bg: 'dark',
}
