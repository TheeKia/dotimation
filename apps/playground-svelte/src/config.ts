import type {
  AnimateItem,
  BackendKind,
  DotimationProps,
} from '@kiaa/dotimation-svelte'

export interface TextContent {
  type: 'text'
  data: string
  fontFamily: string
  fontSize: number | 'AUTO' | 'AUTO_MONO'
  textColor: string
}
export interface ImageContent {
  type: 'image'
  data: string
  maxWidth?: number
  maxHeight?: number
  invert: boolean
}
export type Content = TextContent | ImageContent
export type Slot = 'A' | 'B'
export interface Config {
  slots: Record<Slot, Content>
  active: Slot
  backend: BackendKind
  matching: 'swarm' | 'nearest'
  reducedMotion: 'auto' | 'reduce' | 'animate'
  size: number
  hairline: boolean
  spacing: number
  threshold: number
  max?: number
  jitter: number
  settleTime: number
  damping: number
  fade: number
  maxDpr: number
  defaultFontFamily: string
  sizing: 'fill' | 'fixed'
  width: number
  height: number
  background: 'dark' | 'light' | 'checker'
}

export const STORAGE_KEY = 'dotimation-svelte-playground:v1'
const SAMPLE_IMAGE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><circle cx="120" cy="120" r="90" fill="#a7f3d0"/><circle cx="120" cy="120" r="45" fill="#101413"/></svg>')}`

export function textContent(): TextContent {
  return {
    type: 'text',
    data: 'Hello\nSvelte',
    fontFamily: 'sans-serif',
    fontSize: 'AUTO',
    textColor: '#a7f3d0',
  }
}
export function imageContent(): ImageContent {
  return { type: 'image', data: SAMPLE_IMAGE, invert: false }
}
export function defaults(): Config {
  return {
    slots: { A: textContent(), B: imageContent() },
    active: 'A',
    backend: 'auto',
    matching: 'swarm',
    reducedMotion: 'auto',
    size: 1,
    hairline: false,
    spacing: 2,
    threshold: 128,
    jitter: 1,
    settleTime: 0.85,
    damping: 1,
    fade: 2,
    maxDpr: 2,
    defaultFontFamily: 'sans-serif',
    sizing: 'fill',
    width: 640,
    height: 360,
    background: 'dark',
  }
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
function number(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}
function optional(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : undefined
}
function choice<const T extends string>(
  value: unknown,
  choices: readonly T[],
  fallback: T,
): T {
  return choices.includes(value as T) ? (value as T) : fallback
}
function string(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}
function content(value: unknown, fallback: Content): Content {
  const input = object(value)
  if (input.type === 'image')
    return {
      type: 'image',
      data: string(input.data, SAMPLE_IMAGE),
      invert: input.invert === true,
      maxWidth: optional(input.maxWidth, 1, 4096),
      maxHeight: optional(input.maxHeight, 1, 4096),
    }
  if (input.type !== 'text') return fallback
  const text = textContent()
  return {
    type: 'text',
    data: string(input.data, text.data),
    fontFamily: string(input.fontFamily, text.fontFamily),
    fontSize:
      typeof input.fontSize === 'number'
        ? number(input.fontSize, 48, 1, 512)
        : choice(input.fontSize, ['AUTO', 'AUTO_MONO'], 'AUTO'),
    textColor:
      typeof input.textColor === 'string' &&
      /^#[\da-f]{6}$/i.test(input.textColor)
        ? input.textColor
        : text.textColor,
  }
}

/** Validate persisted data instead of trusting a cast from JSON.parse. */
export function parseConfig(value: unknown): Config {
  const input = object(value)
  const base = defaults()
  const slots = object(input.slots)
  return {
    slots: {
      A: content(slots.A, base.slots.A),
      B: content(slots.B, base.slots.B),
    },
    active: choice(input.active, ['A', 'B'], 'A'),
    backend: choice(
      input.backend,
      ['auto', 'canvas2d', 'webgl2', 'webgpu'],
      base.backend,
    ),
    matching: choice(input.matching, ['swarm', 'nearest'], base.matching),
    reducedMotion: choice(
      input.reducedMotion,
      ['auto', 'reduce', 'animate'],
      'auto',
    ),
    size: number(input.size, base.size, 0.25, 8),
    hairline: input.hairline === true,
    spacing: number(input.spacing, base.spacing, 1, 16),
    threshold: number(input.threshold, base.threshold, 0, 255),
    max: optional(input.max, 0, 100_000),
    jitter: number(input.jitter, base.jitter, 0, 5),
    settleTime: number(input.settleTime, base.settleTime, 0.2, 10),
    damping: number(input.damping, base.damping, 0.3, 1),
    fade: number(input.fade, base.fade, 0.1, 20),
    maxDpr: number(input.maxDpr, base.maxDpr, 0.5, 4),
    defaultFontFamily: string(input.defaultFontFamily, base.defaultFontFamily),
    sizing: choice(input.sizing, ['fill', 'fixed'], 'fill'),
    width: number(input.width, base.width, 1, 2048),
    height: number(input.height, base.height, 1, 2048),
    background: choice(input.background, ['dark', 'light', 'checker'], 'dark'),
  }
}
export function loadConfig(): Config {
  try {
    return parseConfig(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    return defaults()
  }
}
export function toOptions(config: Config): DotimationProps {
  const item: AnimateItem = { ...config.slots[config.active] }
  return {
    ...(config.sizing === 'fill'
      ? { fill: true as const }
      : { width: config.width, height: config.height }),
    item,
    backend: config.backend,
    matching: config.matching,
    reducedMotion:
      config.reducedMotion === 'auto'
        ? undefined
        : config.reducedMotion === 'reduce',
    dots: {
      size: config.hairline ? 'hairline' : config.size,
      spacing: config.spacing,
      threshold: config.threshold,
      max: config.max,
    },
    motion: {
      jitter: config.jitter,
      settleTime: config.settleTime,
      damping: config.damping,
      fade: config.fade,
    },
    maxDpr: config.maxDpr,
    defaultFontFamily: config.defaultFontFamily,
    ariaLabel:
      item.type === 'image' ? `Image in slot ${config.active}` : undefined,
  }
}
export function snippet(config: Config): string {
  const options = JSON.stringify(toOptions(config), null, 2).replaceAll(
    '<',
    '\\u003c',
  )
  return `<script lang="ts">\n  import { Dotimation } from '@kiaa/dotimation-svelte'\n  import type { DotimationProps } from '@kiaa/dotimation-svelte'\n\n  const options: DotimationProps = ${options}\n</script>\n\n<Dotimation {...options} />${config.sizing === 'fill' ? '\n<!-- Place inside a container with a defined height. -->' : ''}`
}
