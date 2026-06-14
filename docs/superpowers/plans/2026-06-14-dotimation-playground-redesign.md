# Dotimation Playground Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-file `test/ui` playground with a refined sidebar-inspector + resizable-stage test harness that exposes every `<Dotimation>` prop live, exercises spring morphs (A/B swap + resize), and persists config to localStorage.

**Architecture:** A `useConfig()` hook holds one `PlaygroundConfig` (two morph slots + all props + UI-only stage/bg) and round-trips it through localStorage. `app.tsx` is pure composition: a header with a minimal stats readout, a collapsible `Inspector` (Content/Rendering/Backend/Performance sections built from reusable control primitives), and a `Stage` that owns canvas geometry and hosts `<Dotimation>`. Decomposition mirrors the library's pure-core/shell discipline: presentational `controls/`, config-owning `config/`, geometry-owning `stage/`.

**Tech Stack:** React 19 + React Compiler (already enabled in the playground via Vite babel preset), Tailwind v4, clsx, native form controls (range/color/select/number — no new deps). Library imported from `src/` via the existing Vite/tsconfig `dotimation` alias.

---

## Testing approach (read first)

This plan touches **only `test/ui/`**, which is the library's manual-verification surface. Per repo convention (`CLAUDE.md`: "DOM/React-bound code … is exercised manually through the `test/ui` playground"), the playground has **no unit-test runner** — do not add vitest/jest. Each task is verified by:

- **Type-check:** `bunx tsc -b test/ui` → Expected: exits 0 with no diagnostics printed.
- **Format + lint (Biome, repo-wide, also runs in pre-commit):** `bun run lint:fix` then `bun run lint` → Expected: `Checked N files … No fixes applied.` and exit 0.
- **ESLint (playground-specific: react-hooks, react-refresh, no-unused-vars):** `bun run --cwd test/ui lint` → Expected: no output, exit 0.
- **Manual (only where something renders):** `bun run dev`, open the printed Vite URL (default `http://localhost:5173/`), observe the stated behavior.

**Incremental safety:** the existing `app.tsx` keeps working and rendering the *old* UI until the final assembly task swaps it. New modules added in Tasks 1–7 are type-checked/linted but not yet imported by `app.tsx`, so the playground stays runnable the whole way. Unused *exports across modules* don't fail `tsc`/ESLint (only unused *locals/imports within a file* do).

**Style:** Biome owns formatting — single quotes, no semicolons, 2-space indent, trailing commas. Write code in that style; `bun run lint:fix` will normalize anything missed. Use `import type` for type-only imports (`verbatimModuleSyntax` is on). Every clickable element is a `<button type="button">` (Biome a11y). Don't use `<label>` without an associated control — use a `<div>`+`<span>`.

---

## File structure

```
test/ui/src/
  main.tsx                      (unchanged — imports default App)
  app.tsx                       REWRITTEN: layout shell + Space shortcut
  index.css                     MODIFIED: font-var fix + .dot-checker + range styling
  config/
    types.ts                    NEW: ItemConfig, StageSize, BgKind, PlaygroundConfig
    presets.ts                  NEW: TEXT_DEFAULT, IMAGE_DEFAULT, PRESETS, DEFAULT_CONFIG
    to-item.ts                  NEW: toAnimateItem(ItemConfig) → AnimateItem
    use-config.ts               NEW: state + localStorage + slots/swap/reset (exports ConfigApi)
  hooks/
    use-screen.ts               (kept; may become unused → remove in final task if so)
    use-fps.ts                  NEW: rAF fps meter (extracted)
    use-element-size.ts         NEW: ResizeObserver content-box size
  components/
    stats-bar.tsx               NEW
    controls/
      field.tsx                 NEW: label/control row
      slider.tsx                NEW
      segmented.tsx             NEW
      text-field.tsx            NEW
      text-area.tsx             NEW
      select.tsx                NEW
      color-field.tsx           NEW
      number-field.tsx          NEW
      toggle.tsx                NEW
    inspector/
      section.tsx               NEW: collapsible (localStorage-remembered)
      content-controls.tsx      NEW
      rendering-controls.tsx    NEW
      backend-controls.tsx      NEW
      performance-controls.tsx  NEW
      inspector.tsx             NEW: sidebar shell
    stage/
      resize-handle.tsx         NEW
      stage-toolbar.tsx         NEW
      stage.tsx                 NEW: geometry + hosts <Dotimation>
```

---

## Task 1: CSS — font vars, checker bg, range styling

**Files:**
- Modify: `test/ui/src/index.css`

- [ ] **Step 1: Point the `font-sans`/`font-mono` theme utilities at the fonts that are actually imported, and add playground utilities.**

In `@theme inline`, replace the existing `--font-mono` and `--font-sans` lines (currently `--font-mono: "VT323", monospace;` and `--font-sans: "Nunito Sans", sans-serif;`) with:

```css
  --font-mono: "Geist Mono Variable", monospace;
  --font-sans: "Nunito Sans Variable", sans-serif;
```

`VT323` is never imported (so the mono readout currently falls back to the browser default), and `@fontsource-variable/*` register the families as `… Variable` — these names match what's actually loaded.

Then append to the end of the file:

```css
/* Playground: native range slider uses the theme accent */
input[type="range"] {
  accent-color: var(--primary);
  cursor: pointer;
  height: 1.25rem;
}

/* Playground: transparency checker background for the stage */
.dot-checker {
  background-color: #1a1a1a;
  background-image:
    linear-gradient(45deg, #2a2a2a 25%, transparent 25%),
    linear-gradient(-45deg, #2a2a2a 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #2a2a2a 75%),
    linear-gradient(-45deg, transparent 75%, #2a2a2a 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
```

- [ ] **Step 2: Verify dev still boots.**

Run: `bun run dev` → Expected: Vite prints `Local: http://localhost:5173/`; the old UI still renders with no console errors. Stop the server (Ctrl-C).

- [ ] **Step 3: Lint + commit.**

```bash
bun run lint:fix && bun run lint
git add test/ui/src/index.css
git commit -m "test(ui): font-var fix + checker/range styling for playground redesign"
```

---

## Task 2: Config layer — types, presets, item mapping

**Files:**
- Create: `test/ui/src/config/types.ts`
- Create: `test/ui/src/config/presets.ts`
- Create: `test/ui/src/config/to-item.ts`

- [ ] **Step 1: Create `config/types.ts`.**

```ts
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
```

- [ ] **Step 2: Create `config/presets.ts`.**

```ts
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
  textColor: '#ff00ff',
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
```

- [ ] **Step 3: Create `config/to-item.ts`.**

```ts
import type { AnimateItem } from 'dotimation'
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
```

- [ ] **Step 4: Type-check + lint.**

Run: `bunx tsc -b test/ui` → Expected: no errors.
Run: `bun run lint:fix && bun run lint` → Expected: clean.

- [ ] **Step 5: Commit.**

```bash
git add test/ui/src/config
git commit -m "test(ui): config types, presets, and item mapping"
```

---

## Task 3: Config hook — state, persistence, slots, swap, reset

**Files:**
- Create: `test/ui/src/config/use-config.ts`

- [ ] **Step 1: Create `config/use-config.ts`.**

```ts
import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_CONFIG } from './presets'
import type { ItemConfig, PlaygroundConfig } from './types'

const STORAGE_KEY = 'dotimation-playground:v1'

function load(): PlaygroundConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    const parsed = JSON.parse(raw) as Partial<PlaygroundConfig>
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      slots: { ...DEFAULT_CONFIG.slots, ...parsed.slots },
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

export type ConfigApi = {
  config: PlaygroundConfig
  update: (patch: Partial<PlaygroundConfig>) => void
  setActiveItem: (item: ItemConfig) => void
  updateActiveItem: (fn: (item: ItemConfig) => ItemConfig) => void
  swap: () => void
  reset: () => void
}

export function useConfig(): ConfigApi {
  const [config, setConfig] = useState<PlaygroundConfig>(load)

  // Persist (debounced so slider drags don't thrash localStorage).
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
      } catch {
        // ignore quota / unavailable storage
      }
    }, 150)
    return () => clearTimeout(id)
  }, [config])

  const update = useCallback((patch: Partial<PlaygroundConfig>) => {
    setConfig((c) => ({ ...c, ...patch }))
  }, [])

  const setActiveItem = useCallback((item: ItemConfig) => {
    setConfig((c) => ({ ...c, slots: { ...c.slots, [c.active]: item } }))
  }, [])

  const updateActiveItem = useCallback(
    (fn: (item: ItemConfig) => ItemConfig) => {
      setConfig((c) => ({
        ...c,
        slots: { ...c.slots, [c.active]: fn(c.slots[c.active]) },
      }))
    },
    [],
  )

  const swap = useCallback(() => {
    setConfig((c) => ({ ...c, active: c.active === 'A' ? 'B' : 'A' }))
  }, [])

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
    setConfig(DEFAULT_CONFIG)
  }, [])

  return { config, update, setActiveItem, updateActiveItem, swap, reset }
}
```

- [ ] **Step 2: Type-check + lint.**

Run: `bunx tsc -b test/ui` → Expected: no errors.
Run: `bun run lint:fix && bun run lint` → Expected: clean.
Run: `bun run --cwd test/ui lint` → Expected: clean (no react-hooks/exhaustive-deps warnings).

- [ ] **Step 3: Commit.**

```bash
git add test/ui/src/config/use-config.ts
git commit -m "test(ui): useConfig hook with localStorage + A/B slots"
```

---

## Task 4: Hooks — fps meter + element size

**Files:**
- Create: `test/ui/src/hooks/use-fps.ts`
- Create: `test/ui/src/hooks/use-element-size.ts`

- [ ] **Step 1: Create `hooks/use-fps.ts`** (extracted from the old `app.tsx`).

```ts
import { useEffect, useRef, useState } from 'react'

/** Rolling frames-per-second meter, sampled every ~500ms. */
export function useFps(): number {
  const [fps, setFps] = useState(0)
  const frames = useRef(0)
  const t0 = useRef(performance.now())
  useEffect(() => {
    let id = 0
    const tick = (): void => {
      frames.current++
      const now = performance.now()
      if (now - t0.current >= 500) {
        setFps(Math.round((frames.current * 1000) / (now - t0.current)))
        frames.current = 0
        t0.current = now
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [])
  return fps
}
```

- [ ] **Step 2: Create `hooks/use-element-size.ts`.**

```ts
import { useEffect, useRef, useState } from 'react'

type Size = { width: number; height: number }

/** Tracks an element's content-box size via ResizeObserver. */
export function useElementSize<T extends HTMLElement>(): [
  React.RefObject<T | null>,
  Size,
] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize({ width: Math.round(width), height: Math.round(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}
```

- [ ] **Step 3: Type-check + lint.**

Run: `bunx tsc -b test/ui` → Expected: no errors.
Run: `bun run lint:fix && bun run lint` → Expected: clean.

- [ ] **Step 4: Commit.**

```bash
git add test/ui/src/hooks/use-fps.ts test/ui/src/hooks/use-element-size.ts
git commit -m "test(ui): useFps + useElementSize hooks"
```

---

## Task 5: Control primitives

**Files:**
- Create: `test/ui/src/components/controls/field.tsx`
- Create: `test/ui/src/components/controls/slider.tsx`
- Create: `test/ui/src/components/controls/segmented.tsx`
- Create: `test/ui/src/components/controls/text-field.tsx`
- Create: `test/ui/src/components/controls/text-area.tsx`
- Create: `test/ui/src/components/controls/select.tsx`
- Create: `test/ui/src/components/controls/color-field.tsx`
- Create: `test/ui/src/components/controls/number-field.tsx`
- Create: `test/ui/src/components/controls/toggle.tsx`

Each file exports exactly one component (keeps ESLint `react-refresh/only-export-components` happy).

- [ ] **Step 1: `controls/field.tsx`** — the shared label/control row.

```tsx
import type { ReactNode } from 'react'

export function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}): React.ReactNode {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3 py-1 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-2">
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `controls/slider.tsx`.**

```tsx
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}): React.ReactNode {
  return (
    <div className="flex w-40 items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1"
      />
      <span className="w-9 text-right tabular-nums text-foreground">
        {value}
      </span>
    </div>
  )
}
```

- [ ] **Step 3: `controls/segmented.tsx`** — generic single-select pill group.

```tsx
import clsx from 'clsx'

type Option<T extends string> = { label: string; value: T }

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Option<T>[]
  value: T
  onChange: (v: T) => void
}): React.ReactNode {
  return (
    <div className="inline-flex gap-0.5 rounded-md bg-secondary p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded px-2 py-1 text-xs transition-colors',
            value === o.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: `controls/text-field.tsx`.**

```tsx
export function TextField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}): React.ReactNode {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-44 rounded border border-input bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
    />
  )
}
```

- [ ] **Step 5: `controls/text-area.tsx`.**

```tsx
export function TextArea({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}): React.ReactNode {
  return (
    <textarea
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      rows={3}
      className="w-44 resize-y rounded border border-input bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
    />
  )
}
```

- [ ] **Step 6: `controls/select.tsx`** — generic styled native select.

```tsx
export function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { label: string; value: T }[]
  onChange: (v: T) => void
}): React.ReactNode {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-44 rounded border border-input bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
```

- [ ] **Step 7: `controls/color-field.tsx`** — swatch + free-text CSS color.

```tsx
const HEX = /^#[0-9a-fA-F]{6}$/

export function ColorField({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}): React.ReactNode {
  const pickerValue = HEX.test(value) ? value : '#000000'
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={pickerValue}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Pick color"
        className="size-6 cursor-pointer rounded border border-border bg-transparent"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 rounded border border-input bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
      />
    </div>
  )
}
```

- [ ] **Step 8: `controls/number-field.tsx`** — supports optional (empty → undefined).

```tsx
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  placeholder,
}: {
  value: number | undefined
  onChange: (v: number | undefined) => void
  min?: number
  max?: number
  step?: number
  placeholder?: string
}): React.ReactNode {
  return (
    <input
      type="number"
      value={value ?? ''}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value
        onChange(raw === '' ? undefined : Number(raw))
      }}
      className="w-24 rounded border border-input bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
    />
  )
}
```

- [ ] **Step 9: `controls/toggle.tsx`.**

```tsx
import clsx from 'clsx'

export function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}): React.ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-5 w-9 rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-input',
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 size-4 rounded-full transition-transform',
          checked
            ? 'translate-x-4 bg-primary-foreground'
            : 'translate-x-0.5 bg-muted-foreground',
        )}
      />
    </button>
  )
}
```

- [ ] **Step 10: Type-check + lint.**

Run: `bunx tsc -b test/ui` → Expected: no errors.
Run: `bun run lint:fix && bun run lint` → Expected: clean.
Run: `bun run --cwd test/ui lint` → Expected: clean.

- [ ] **Step 11: Commit.**

```bash
git add test/ui/src/components/controls
git commit -m "test(ui): reusable control primitives"
```

---

## Task 6: Inspector sections + shell

**Files:**
- Create: `test/ui/src/components/inspector/section.tsx`
- Create: `test/ui/src/components/inspector/content-controls.tsx`
- Create: `test/ui/src/components/inspector/rendering-controls.tsx`
- Create: `test/ui/src/components/inspector/backend-controls.tsx`
- Create: `test/ui/src/components/inspector/performance-controls.tsx`
- Create: `test/ui/src/components/inspector/inspector.tsx`

- [ ] **Step 1: `inspector/section.tsx`** — collapsible group that remembers open/closed.

```tsx
import clsx from 'clsx'
import { type ReactNode, useEffect, useState } from 'react'

function loadOpen(title: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(`dotimation-playground:section:${title}`)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

export function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}): React.ReactNode {
  const [open, setOpen] = useState(() => loadOpen(title, defaultOpen))
  useEffect(() => {
    try {
      localStorage.setItem(
        `dotimation-playground:section:${title}`,
        open ? '1' : '0',
      )
    } catch {
      // ignore
    }
  }, [title, open])

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>{title}</span>
        <span
          className={clsx('transition-transform', open && 'rotate-90')}
          aria-hidden
        >
          ›
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-0.5 px-4 pb-3 pt-0.5">{children}</div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: `inspector/content-controls.tsx`** — A/B, presets, type switch, text/image editors.

```tsx
import type { ConfigApi } from '../../config/use-config'
import { IMAGE_DEFAULT, PRESETS, TEXT_DEFAULT } from '../../config/presets'
import { Field } from '../controls/field'
import { Segmented } from '../controls/segmented'
import { TextArea } from '../controls/text-area'
import { TextField } from '../controls/text-field'
import { Select } from '../controls/select'
import { ColorField } from '../controls/color-field'
import { NumberField } from '../controls/number-field'
import { Slider } from '../controls/slider'
import { Toggle } from '../controls/toggle'

const FONT_FAMILIES = [
  { label: 'sans-serif', value: 'sans-serif' },
  { label: 'serif', value: 'serif' },
  { label: 'monospace', value: 'monospace' },
  { label: 'system-ui', value: 'system-ui' },
  { label: 'cursive', value: 'cursive' },
]

export function ContentControls({ api }: { api: ConfigApi }): React.ReactNode {
  const { config, update, setActiveItem, updateActiveItem } = api
  const item = config.slots[config.active]
  // Narrow, explicitly-typed mode so it matches the Segmented value type
  // (without this annotation, the numeric `fontSize` would widen the union).
  const fontSizeMode: 'AUTO' | 'AUTO_MONO' | 'Fixed' =
    item.type !== 'text'
      ? 'AUTO'
      : typeof item.fontSize === 'number'
        ? 'Fixed'
        : item.fontSize

  return (
    <>
      <Field label="slot">
        <Segmented
          value={config.active}
          options={[
            { label: 'A', value: 'A' },
            { label: 'B', value: 'B' },
          ]}
          onChange={(v) => update({ active: v })}
        />
      </Field>

      <div className="flex flex-wrap gap-1 py-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setActiveItem(p.item)}
            className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
          >
            {p.label}
          </button>
        ))}
      </div>

      <Field label="type">
        <Segmented
          value={item.type}
          options={[
            { label: 'Text', value: 'text' },
            { label: 'Image', value: 'image' },
          ]}
          onChange={(v) =>
            setActiveItem(v === 'text' ? TEXT_DEFAULT : IMAGE_DEFAULT)
          }
        />
      </Field>

      {item.type === 'text' ? (
        <>
          <Field label="text">
            <TextArea
              value={item.data}
              onChange={(v) =>
                updateActiveItem((it) =>
                  it.type === 'text' ? { ...it, data: v } : it,
                )
              }
            />
          </Field>
          <Field label="font">
            <Select
              value={item.fontFamily}
              options={FONT_FAMILIES}
              onChange={(v) =>
                updateActiveItem((it) =>
                  it.type === 'text' ? { ...it, fontFamily: v } : it,
                )
              }
            />
          </Field>
          <Field label="size">
            <Segmented
              value={fontSizeMode}
              options={[
                { label: 'Auto', value: 'AUTO' },
                { label: 'Mono', value: 'AUTO_MONO' },
                { label: 'Fixed', value: 'Fixed' },
              ]}
              onChange={(m) =>
                updateActiveItem((it) =>
                  it.type === 'text'
                    ? { ...it, fontSize: m === 'Fixed' ? 36 : m }
                    : it,
                )
              }
            />
          </Field>
          {typeof item.fontSize === 'number' && (
            <Field label="px">
              <Slider
                value={item.fontSize}
                min={8}
                max={200}
                onChange={(v) =>
                  updateActiveItem((it) =>
                    it.type === 'text' ? { ...it, fontSize: v } : it,
                  )
                }
              />
            </Field>
          )}
          <Field label="color">
            <ColorField
              value={item.textColor}
              onChange={(v) =>
                updateActiveItem((it) =>
                  it.type === 'text' ? { ...it, textColor: v } : it,
                )
              }
            />
          </Field>
        </>
      ) : (
        <>
          <Field label="url">
            <TextField
              value={item.data}
              placeholder="https://…"
              onChange={(v) =>
                updateActiveItem((it) =>
                  it.type === 'image' ? { ...it, data: v } : it,
                )
              }
            />
          </Field>
          <Field label="maxW">
            <NumberField
              value={item.maxWidth}
              min={1}
              placeholder="auto"
              onChange={(v) =>
                updateActiveItem((it) =>
                  it.type === 'image' ? { ...it, maxWidth: v } : it,
                )
              }
            />
          </Field>
          <Field label="maxH">
            <NumberField
              value={item.maxHeight}
              min={1}
              placeholder="auto"
              onChange={(v) =>
                updateActiveItem((it) =>
                  it.type === 'image' ? { ...it, maxHeight: v } : it,
                )
              }
            />
          </Field>
          <Field label="invert">
            <Toggle
              checked={item.invert}
              onChange={(v) =>
                updateActiveItem((it) =>
                  it.type === 'image' ? { ...it, invert: v } : it,
                )
              }
            />
          </Field>
        </>
      )}
    </>
  )
}
```

- [ ] **Step 3: `inspector/rendering-controls.tsx`.**

```tsx
import type { ConfigApi } from '../../config/use-config'
import { Field } from '../controls/field'
import { Slider } from '../controls/slider'
import { Select } from '../controls/select'

const FONT_FAMILIES = [
  { label: 'sans-serif', value: 'sans-serif' },
  { label: 'serif', value: 'serif' },
  { label: 'monospace', value: 'monospace' },
  { label: 'system-ui', value: 'system-ui' },
]

export function RenderingControls({
  api,
}: {
  api: ConfigApi
}): React.ReactNode {
  const { config, update } = api
  return (
    <>
      <Field label="dotSize">
        <Slider
          value={config.dotSize}
          min={1}
          max={6}
          onChange={(v) => update({ dotSize: v })}
        />
      </Field>
      <Field label="spacing">
        <Slider
          value={config.pointSpacingCss}
          min={1}
          max={8}
          onChange={(v) => update({ pointSpacingCss: v })}
        />
      </Field>
      <Field label="alpha">
        <Slider
          value={config.alpha}
          min={0}
          max={255}
          onChange={(v) => update({ alpha: v })}
        />
      </Field>
      <Field label="defaultFont">
        <Select
          value={config.defaultFontFamily}
          options={FONT_FAMILIES}
          onChange={(v) => update({ defaultFontFamily: v })}
        />
      </Field>
    </>
  )
}
```

- [ ] **Step 4: `inspector/backend-controls.tsx`.**

```tsx
import type { BackendKind, IdleBehavior } from 'dotimation'
import type { ConfigApi } from '../../config/use-config'
import { Field } from '../controls/field'
import { Segmented } from '../controls/segmented'

export function BackendControls({ api }: { api: ConfigApi }): React.ReactNode {
  const { config, update } = api
  return (
    <>
      <Field label="backend">
        <Segmented<BackendKind>
          value={config.backend}
          options={[
            { label: 'Auto', value: 'auto' },
            { label: '2D', value: 'canvas2d' },
            { label: 'GL', value: 'webgl2' },
            { label: 'GPU', value: 'webgpu' },
          ]}
          onChange={(v) => update({ backend: v })}
        />
      </Field>
      <Field label="idle">
        <Segmented<IdleBehavior>
          value={config.idle}
          options={[
            { label: 'Sleep', value: 'sleep' },
            { label: 'Animate', value: 'animate' },
          ]}
          onChange={(v) => update({ idle: v })}
        />
      </Field>
    </>
  )
}
```

- [ ] **Step 5: `inspector/performance-controls.tsx`.**

```tsx
import type { ConfigApi } from '../../config/use-config'
import { Field } from '../controls/field'
import { Slider } from '../controls/slider'
import { Toggle } from '../controls/toggle'

export function PerformanceControls({
  api,
}: {
  api: ConfigApi
}): React.ReactNode {
  const { config, update, reset } = api
  const capped = config.maxParticles !== undefined
  return (
    <>
      <Field label="cap dots">
        <Toggle
          checked={capped}
          onChange={(v) => update({ maxParticles: v ? 20000 : undefined })}
        />
      </Field>
      {capped && (
        <Field label="maxParticles">
          <Slider
            value={config.maxParticles ?? 20000}
            min={1000}
            max={50000}
            step={1000}
            onChange={(v) => update({ maxParticles: v })}
          />
        </Field>
      )}
      <div className="pt-2">
        <button
          type="button"
          onClick={reset}
          className="w-full rounded border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-foreground"
        >
          ↺ Reset all
        </button>
      </div>
    </>
  )
}
```

- [ ] **Step 6: `inspector/inspector.tsx`** — the sidebar shell.

```tsx
import type { ConfigApi } from '../../config/use-config'
import { Section } from './section'
import { ContentControls } from './content-controls'
import { RenderingControls } from './rendering-controls'
import { BackendControls } from './backend-controls'
import { PerformanceControls } from './performance-controls'

export function Inspector({ api }: { api: ConfigApi }): React.ReactNode {
  return (
    <aside className="w-[300px] shrink-0 overflow-y-auto border-r border-border bg-card/30">
      <Section title="Content">
        <ContentControls api={api} />
      </Section>
      <Section title="Rendering">
        <RenderingControls api={api} />
      </Section>
      <Section title="Backend">
        <BackendControls api={api} />
      </Section>
      <Section title="Performance">
        <PerformanceControls api={api} />
      </Section>
    </aside>
  )
}
```

- [ ] **Step 7: Type-check + lint.**

Run: `bunx tsc -b test/ui` → Expected: no errors.
Run: `bun run lint:fix && bun run lint` → Expected: clean.
Run: `bun run --cwd test/ui lint` → Expected: clean (watch for `react-refresh/only-export-components` — each file here exports exactly one component, so it should pass; and for unused `clsx` in content-controls).

- [ ] **Step 8: Commit.**

```bash
git add test/ui/src/components/inspector
git commit -m "test(ui): inspector sections + sidebar shell"
```

---

## Task 7: Stage — geometry, toolbar, resize handle, stats bar

**Files:**
- Create: `test/ui/src/components/stage/resize-handle.tsx`
- Create: `test/ui/src/components/stage/stage-toolbar.tsx`
- Create: `test/ui/src/components/stage/stage.tsx`
- Create: `test/ui/src/components/stats-bar.tsx`

- [ ] **Step 1: `components/stage/resize-handle.tsx`.**

```tsx
import { useRef } from 'react'

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export function ResizeHandle({
  onResize,
  maxW,
  maxH,
}: {
  onResize: (w: number, h: number) => void
  maxW: number
  maxH: number
}): React.ReactNode {
  const ref = useRef<HTMLButtonElement>(null)

  function onPointerDown(e: React.PointerEvent): void {
    e.preventDefault()
    const frame = ref.current?.parentElement
    if (!frame) return
    const rect = frame.getBoundingClientRect()
    const move = (ev: PointerEvent): void => {
      onResize(
        clamp(Math.round(ev.clientX - rect.left), 80, maxW),
        clamp(Math.round(ev.clientY - rect.top), 80, maxH),
      )
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <button
      ref={ref}
      type="button"
      aria-label="Resize stage"
      onPointerDown={onPointerDown}
      className="absolute bottom-0 right-0 size-4 cursor-nwse-resize border-b-2 border-r-2 border-muted-foreground/40 transition-colors hover:border-primary"
    />
  )
}
```

- [ ] **Step 2: `components/stage/stage-toolbar.tsx`.**

```tsx
import clsx from 'clsx'
import type { BgKind } from '../../config/types'
import type { ConfigApi } from '../../config/use-config'

const SIZE_PRESETS = [
  { label: '320', w: 320, h: 240 },
  { label: '640', w: 640, h: 360 },
  { label: '800', w: 800, h: 600 },
]

const BGS: BgKind[] = ['dark', 'light', 'checker']

function chip(active: boolean): string {
  return clsx(
    'rounded px-2 py-1 text-xs transition-colors',
    active
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-primary/10 hover:text-foreground',
  )
}

export function StageToolbar({
  api,
  width,
  height,
}: {
  api: ConfigApi
  width: number
  height: number
}): React.ReactNode {
  const { config, update } = api
  const size = config.stageSize
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs">
      <span className="font-mono tabular-nums text-muted-foreground">
        {width}×{height}
      </span>
      <div className="flex gap-0.5">
        {SIZE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => update({ stageSize: { mode: 'preset', w: p.w, h: p.h } })}
            className={chip(
              size.mode === 'preset' && size.w === p.w && size.h === p.h,
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => update({ stageSize: { mode: 'fill' } })}
          className={chip(size.mode === 'fill')}
        >
          Fill
        </button>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <span className="text-muted-foreground">bg</span>
        {BGS.map((b) => (
          <button
            key={b}
            type="button"
            aria-label={`Background ${b}`}
            onClick={() => update({ bg: b })}
            className={clsx(
              'size-5 rounded border',
              b === 'dark' && 'bg-[#0a0a0a]',
              b === 'light' && 'bg-[#f5f5f5]',
              b === 'checker' && 'dot-checker',
              config.bg === b ? 'border-primary' : 'border-border',
            )}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: `components/stage/stage.tsx`** — owns geometry, hosts `<Dotimation>`.

```tsx
import clsx from 'clsx'
import { Dotimation } from 'dotimation'
import type { DotimationStats } from 'dotimation'
import type { BgKind, StageSize } from '../../config/types'
import { toAnimateItem } from '../../config/to-item'
import type { ConfigApi } from '../../config/use-config'
import { useElementSize } from '../../hooks/use-element-size'
import { ResizeHandle } from './resize-handle'
import { StageToolbar } from './stage-toolbar'

const BG_CLASS: Record<BgKind, string> = {
  dark: 'bg-[#0a0a0a]',
  light: 'bg-[#f5f5f5]',
  checker: 'dot-checker',
}

function resolveSize(
  size: StageSize,
  availW: number,
  availH: number,
): { width: number; height: number } {
  if (availW <= 0 || availH <= 0) return { width: 0, height: 0 }
  if (size.mode === 'fill') return { width: availW, height: availH }
  return { width: Math.min(size.w, availW), height: Math.min(size.h, availH) }
}

export function Stage({
  api,
  onStats,
}: {
  api: ConfigApi
  onStats: (s: DotimationStats) => void
}): React.ReactNode {
  const { config, update, swap } = api
  const [areaRef, area] = useElementSize<HTMLDivElement>()
  const { width, height } = resolveSize(config.stageSize, area.width, area.height)
  const item = toAnimateItem(config.slots[config.active])

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <StageToolbar api={api} width={width} height={height} />
      <div
        ref={areaRef}
        className="flex min-h-0 flex-1 items-center justify-center p-4"
      >
        <div
          className={clsx(
            'relative overflow-hidden rounded-lg border border-border shadow-inner',
            BG_CLASS[config.bg],
          )}
          style={{ width, height }}
        >
          {width > 0 && height > 0 && (
            <Dotimation
              item={item}
              width={width}
              height={height}
              dotSize={config.dotSize}
              pointSpacingCss={config.pointSpacingCss}
              alpha={config.alpha}
              defaultFontFamily={config.defaultFontFamily}
              backend={config.backend}
              idle={config.idle}
              maxParticles={config.maxParticles}
              onStats={onStats}
            />
          )}
          <ResizeHandle
            maxW={area.width}
            maxH={area.height}
            onResize={(w, h) =>
              update({ stageSize: { mode: 'custom', w, h } })
            }
          />
        </div>
      </div>
      <div className="flex items-center justify-center pb-3">
        <button
          type="button"
          onClick={swap}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
        >
          ⇄ Swap A/B
          <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
            Space
          </kbd>
        </button>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: `components/stats-bar.tsx`.**

```tsx
import type { DotimationStats } from 'dotimation'
import { useFps } from '../hooks/use-fps'

export function StatsBar({
  stats,
}: {
  stats: DotimationStats | null
}): React.ReactNode {
  const fps = useFps()
  return (
    <div className="font-mono text-xs tabular-nums text-muted-foreground">
      {fps} fps · {stats?.backend ?? '—'} ·{' '}
      {stats ? stats.particles.toLocaleString() : '0'} dots
    </div>
  )
}
```

- [ ] **Step 5: Type-check + lint.**

Run: `bunx tsc -b test/ui` → Expected: no errors.
Run: `bun run lint:fix && bun run lint` → Expected: clean.
Run: `bun run --cwd test/ui lint` → Expected: clean.

- [ ] **Step 6: Commit.**

```bash
git add test/ui/src/components/stage test/ui/src/components/stats-bar.tsx
git commit -m "test(ui): stage geometry, toolbar, resize handle, stats bar"
```

---

## Task 8: Assemble `app.tsx` + Space shortcut

**Files:**
- Modify (full rewrite): `test/ui/src/app.tsx`

- [ ] **Step 1: Replace the entire contents of `test/ui/src/app.tsx`.**

```tsx
import './index.css'

import { useEffect, useState } from 'react'
import type { DotimationStats } from 'dotimation'
import { useConfig } from './config/use-config'
import { Inspector } from './components/inspector/inspector'
import { Stage } from './components/stage/stage'
import { StatsBar } from './components/stats-bar'

function Wordmark(): React.ReactNode {
  return (
    <div className="flex items-center gap-2">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <title>dotimation</title>
        {[2, 8, 14].map((y) =>
          [2, 8, 14].map((x) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" fill="currentColor" />
          )),
        )}
      </svg>
      <span className="text-sm font-semibold tracking-tight">dotimation</span>
    </div>
  )
}

export default function App(): React.ReactNode {
  const api = useConfig()
  const [stats, setStats] = useState<DotimationStats | null>(null)

  // Space toggles A/B (ignored while typing into a form control).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.code !== 'Space') return
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      e.preventDefault()
      api.swap()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api.swap])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <Wordmark />
        <StatsBar stats={stats} />
      </header>
      <div className="flex min-h-0 flex-1">
        <Inspector api={api} />
        <Stage api={api} onStats={setStats} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check + lint.**

Run: `bunx tsc -b test/ui` → Expected: no errors.
Run: `bun run lint:fix && bun run lint` → Expected: clean.
Run: `bun run --cwd test/ui lint` → Expected: clean (the `useEffect` dep is `api.swap`, which is `useCallback`-stable, so no exhaustive-deps warning).

- [ ] **Step 3: Commit.**

```bash
git add test/ui/src/app.tsx
git commit -m "test(ui): assemble redesigned playground layout"
```

---

## Task 9: Cleanup + full manual verification

**Files:**
- Possibly delete: `test/ui/src/hooks/use-screen.ts` (only if now unused)

- [ ] **Step 1: Check whether `use-screen.ts` is still imported anywhere.**

Run: `grep -rn "use-screen" test/ui/src` → Expected: no matches (the redesign uses `useElementSize` for the stage and no longer needs window size).
If there are no matches, delete the file:

```bash
git rm test/ui/src/hooks/use-screen.ts
```

If it IS still referenced, leave it.

- [ ] **Step 2: Full type-check + lint.**

Run: `bunx tsc -b test/ui` → Expected: no errors.
Run: `bun run lint:fix && bun run lint` → Expected: `Checked N files … No fixes applied.`
Run: `bun run --cwd test/ui lint` → Expected: clean.

- [ ] **Step 3: Manual verification matrix.**

Run: `bun run dev`, open `http://localhost:5173/`, and confirm each row:

| Check | Expected |
| --- | --- |
| Initial render | Header wordmark + `… fps · <backend> · <n> dots`; sidebar with 4 sections; stage fills the area showing "Hello / Dotimation" in magenta dots |
| Content → text edit | Typing in the text area re-rasterizes; dots morph to new text |
| fontSize Auto/Mono/Fixed | Switching to Fixed reveals a px slider; dragging it rescales the glyphs |
| color | Picker + hex both change dot color live |
| type → Image | Switches to URL/maxW/maxH/invert; logo image renders as dots; invert toggle flips it |
| Presets | Hello/Mono/Stress/Logo each load into the active slot |
| A/B + Swap + Space | Set A=Hello, B=Logo; clicking A/B, the Swap button, and pressing Space each morph between them; Space ignored while focused in the text area |
| Rendering sliders | dotSize/spacing/alpha visibly change rendering (spacing change re-rasterizes) |
| Backend segmented | Switching auto/2D/GL/GPU updates the stats backend readout; unsupported tiers fall back (readout shows the resolved tier) |
| idle | `sleep` lets dots settle and stop; `animate` keeps them alive |
| Performance cap | Toggling the cap thins dots; slider adjusts the count; stats `dots` reflects it |
| Stage sizes | 320/640/800 frame the canvas at those sizes (clamped to area); Fill tracks the area; drag the corner handle to resize → morph |
| bg swatch | dark/light/checker change the stage background; checker reveals transparency |
| Reset all | Restores defaults and clears persisted state |
| Reload | Config (including section open/closed) is restored from localStorage |

Stop the server when done.

- [ ] **Step 4: Commit any cleanup.**

```bash
git add -A
git commit -m "test(ui): remove unused use-screen hook" || echo "nothing to clean up"
```

---

## Self-review notes (already applied)

- **Spec coverage:** every prop in the spec's controls-inventory table maps to a control in Tasks 5–6; A/B morph + resize + bg + localStorage + minimal stats all have tasks. Aesthetic handled via shared oklch tokens + Task 1 CSS.
- **Type consistency:** `ConfigApi` (Task 3) is the single prop type threaded through Inspector/sections/Stage; `update`/`setActiveItem`/`updateActiveItem`/`swap`/`reset` names are used verbatim everywhere; `toAnimateItem`, `StageSize`, `BgKind`, `DotimationStats` referenced consistently.
- **No placeholders:** every step contains complete code. The one judgment call (`clsx` import in `content-controls.tsx`) is flagged inline with the exact remediation.
- **Object identity / perf:** `toAnimateItem` returns a fresh object each render, but `useFieldTargets` does a field-value `shallowEqual` on `item` (verified in `src/hooks/use-field-targets.ts`), so equal values do not re-rasterize; React Compiler (enabled in the playground) further memoizes the call on slot identity.
