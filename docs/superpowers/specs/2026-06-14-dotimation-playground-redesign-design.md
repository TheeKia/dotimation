# Dotimation Playground — Redesign Design Spec

**Date:** 2026-06-14
**Status:** Pending sign-off
**Scope:** `test/ui` only. No changes to the library (`src/`) or its public API.

## Summary

The `test/ui` playground is the only place the DOM/React-bound parts of the library
(rasterize, engine, backends, component) get exercised — but today it's a single 180-line
`app.tsx`: a row of toggle buttons over a full-bleed canvas, a tiny text overlay for stats,
and no way to enter custom content, tune continuous props, pick colors, or test resize/morph
behavior. It tests *some* things awkwardly and shows results plainly.

This redesign rebuilds the playground into a **refined-instrument** test harness: a docked
**sidebar inspector** exposing **every** `<Dotimation>` prop with proper live controls, beside a
**resizable canvas stage** with size presets, a background swatch, and an **A/B morph toolkit**
for exercising the library's signature spring-morph behavior on demand. Config persists to
**localStorage**. The chrome stays quiet so the dots are the hero.

This is a pure test-harness improvement — no library code changes, no new dependencies beyond
what `test/ui` already has (React 19, Tailwind v4, clsx).

## Goals & success criteria

| Goal | Success criterion |
| --- | --- |
| Test every prop | Every `<Dotimation>` prop (item text/image fields, `dotSize`, `pointSpacingCss`, `alpha`, `defaultFontFamily`, `backend`, `idle`, `maxParticles`) has a live, appropriate control |
| Exercise morphs | Content A/B swap (button + Space) and stage resize both visibly trigger spring morphs |
| See results clearly | Minimal live stats (`fps · backend · dots`); stage background swatch makes colored dots / transparency / `invert` legible |
| Beautiful, calm UI | Cohesive dark instrument aesthetic on the existing oklch tokens; smooth control micro-interactions; chrome never competes with the canvas |
| Maintainable | One big file → small, single-purpose components and hooks; each control primitive reusable and independently understandable |
| Survives reload | Full control config round-trips through localStorage |

**Non-goals:** changing the library or its API; a rich perf panel with frame-time graphs (user
chose the minimal readout); URL-shareable state (localStorage only); routing; a component/story
catalog; mobile-first layout (desktop test tool — must stay usable when narrow, not phone-optimized).

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│ ◉ dotimation             118 fps · webgpu · 8,412 dots       │ header + minimal stats
├──────────────────┬───────────────────────────────────────────┤
│ ▾ CONTENT        │  800×600   [320][640][800][Fill]   bg ◐   │ stage toolbar
│  [  A  |  B  ]   │  ┌─────────────────────────────────────┐  │
│  type  [text ▾]  │  │           ● ● ● ● ● ●               │  │
│  ┌─────────────┐ │  │         ●  D O T S  ●               │  │
│  │ Hello…      │ │  │           ● ● ● ● ● ●               │  │
│  └─────────────┘ │  │                                   ◢ │  │
│  font  [sans ▾]  │  └─────────────────────────────────────┘  │
│  size  AUTO ▒36  │        ⇄ Swap A/B  (Space)                │
│  color ▣ #ff00ff │                                           │
│ ▾ RENDERING      │                                           │
│  dotSize  ▭▭▭ 1  │                                           │
│  spacing  ▭▭  2  │                                           │
│  alpha   ▭▭▭ 128 │                                           │
│ ▾ BACKEND        │                                           │
│ [auto|2d|gl|gpu] │                                           │
│  idle [sleep|anim]                                           │
│ ▾ PERFORMANCE    │                                           │
│  maxParticles ∞  │                                           │
│  ↺ Reset all     │                                           │
└──────────────────┴───────────────────────────────────────────┘
```

- **Header** (full width): wordmark on the left, minimal stats readout on the right
  (`fps · backend · dots`).
- **Inspector** (fixed-width left column, ~280px, internally scrollable): collapsible sections
  Content / Rendering / Backend / Performance.
- **Stage** (fills remaining space): a toolbar row (current size, size presets, background swatch)
  above the framed canvas, with the A/B swap control beneath. The canvas frame is resizable via a
  bottom-right drag handle; "Fill" makes it track the available area.

## Architecture & file layout

Replace the monolithic `app.tsx` with small, single-purpose units. New structure under
`test/ui/src/`:

```
src/
  main.tsx                      (unchanged)
  app.tsx                       top-level layout shell; wires useConfig → Inspector + Stage + StatsBar
  index.css                     keep theme tokens; add a few playground-specific utilities only if needed
  config/
    types.ts                    PlaygroundConfig, slot/item shapes, StageSize, BgKind
    presets.ts                  named seed items (Hello, Logo, Mono, Stress) + DEFAULT_CONFIG
    use-config.ts               config state + localStorage persistence + A/B slot logic + reset
  hooks/
    use-screen.ts               (keep)
    use-fps.ts                  extracted rAF fps meter
    use-element-size.ts         ResizeObserver-based size for Fill mode
  components/
    stats-bar.tsx               minimal fps · backend · dots
    inspector/
      inspector.tsx             sidebar shell; renders the four sections
      section.tsx               collapsible labeled group (remembers open/closed)
      content-controls.tsx      A/B selector + text/image editors
      rendering-controls.tsx    dotSize, pointSpacingCss, alpha, defaultFontFamily
      backend-controls.tsx      backend segmented + idle segmented
      performance-controls.tsx  maxParticles (∞ ↔ numeric) + reset
    stage/
      stage.tsx                 owns stage size; hosts <Dotimation>; reports onStats up
      stage-toolbar.tsx         size readout + presets + Fill + background swatch
      resize-handle.tsx         bottom-right drag handle (pointer events)
    controls/
      field.tsx                 label + control row wrapper (consistent layout)
      slider.tsx                range track + live numeric value (+ optional numeric entry)
      segmented.tsx             segmented button group (single-select)
      text-field.tsx            single-line text input
      text-area.tsx             multi-line text input (item data)
      select.tsx                styled native <select>
      color-field.tsx           color swatch + hex input
      number-field.tsx          numeric input with min/max/step
      toggle.tsx                on/off switch
```

**Why this shape:** every control primitive in `controls/` is pure presentation
(`value` + `onChange`), reusable across sections, and understandable in isolation. Each section
component owns only its slice of the config. The stage owns geometry; the inspector owns props;
`app.tsx` owns nothing but composition. This mirrors the library's own pure-core / shell
discipline and keeps files small enough to reason about whole.

## Data model

```ts
type ItemConfig =
  | { type: 'text'; data: string; fontFamily?: string; fontSize: number | 'AUTO' | 'AUTO_MONO'; textColor?: string }
  | { type: 'image'; data: string; maxWidth?: number; maxHeight?: number; invert?: boolean }

type StageSize =
  | { mode: 'preset'; w: number; h: number }   // 320×240, 640×360, 800×600
  | { mode: 'fill' }                            // track container via ResizeObserver
  | { mode: 'custom'; w: number; h: number }    // set by the drag handle

type BgKind = 'dark' | 'light' | 'checker'

interface PlaygroundConfig {
  slots: { A: ItemConfig; B: ItemConfig }       // two morph slots
  active: 'A' | 'B'                              // which slot is live (and being edited)
  // rendering
  dotSize: number
  pointSpacingCss: number
  alpha: number
  defaultFontFamily: string
  // backend
  backend: BackendKind                          // 'auto' | 'canvas2d' | 'webgl2' | 'webgpu'
  idle: IdleBehavior                            // 'sleep' | 'animate'
  // performance
  maxParticles: number | undefined              // undefined = ∞
  // stage (UI-only, not a Dotimation prop)
  stageSize: StageSize
  bg: BgKind
}
```

The **live item** passed to `<Dotimation item>` is `slots[active]` mapped to the library's
`AnimateItem` (drop the `undefined` optionals so the component's shallow `item` compare is clean).
`ItemConfig` mirrors `AnimateItem` but keeps `fontSize` always-present in state for stable
controlled inputs.

## Data flow

1. `app.tsx` calls `useConfig()` → `{ config, update, swap, reset }`.
   - `update(patch)` merges a partial into config and writes localStorage (debounced ~150ms to
     avoid thrashing on slider drags).
   - `swap()` flips `active` A↔B (also bound to the **Space** key globally, except while typing
     in an input/textarea).
   - `reset()` restores `DEFAULT_CONFIG` and clears storage.
2. `Inspector` receives `config` + section-scoped update callbacks; editing a field updates the
   **active** slot or the relevant top-level field.
3. `Stage` receives the derived `item`, the rendering/backend/perf props, and `stageSize`/`bg`.
   It computes the canvas `width`/`height`:
   - `preset`/`custom` → those numbers, clamped to the available area.
   - `fill` → measured container size via `use-element-size`.
   It renders `<Dotimation ... onStats={onStats} />` and lifts stats to `app.tsx`.
4. `StatsBar` shows `useFps()` + the lifted `{ backend, particles }`.

**Morph mechanics:** changing `active` (via the segmented control, the Swap button, or Space)
swaps the live `item` reference → `useFieldTargets` re-rasterizes → the field reconciles and
springs to the new layout, exactly the production path. The precise selection-vs-edit rule is
spelled out under "A/B interaction" below.

### A/B interaction (precise rule)

- The `[ A | B ]` segmented control selects which slot is **both** live and being edited — one
  control, no ambiguity. Clicking the inactive letter morphs to it and focuses its values in the
  editor.
- The **Swap A/B** button and **Space** shortcut are a convenience that toggles `active` (same as
  clicking the other letter). They exist so you can repeatedly bounce between two configs to watch
  the transition without aiming at the segmented control.
- Both slots are independently editable: select A, edit; select B, edit; then swap back and forth.
- Presets (Hello / Logo / Mono / Stress) are buttons that **load into the active slot**, so you can
  set A = Hello and B = Logo and morph between them.

## Controls inventory (every prop, live)

| Section | Control | Prop | Widget |
| --- | --- | --- | --- |
| Content | type | item.type | segmented (text / image) |
| Content | text data | item.data (text) | textarea (multi-line) |
| Content | fontFamily | item.fontFamily | select (sans-serif, serif, monospace, system-ui, cursive) + free text |
| Content | fontSize | item.fontSize | segmented AUTO / AUTO_MONO / Fixed → when Fixed, a numeric slider |
| Content | textColor | item.textColor | color swatch + hex |
| Content | image url | item.data (image) | text field (+ preset image buttons) |
| Content | maxWidth/maxHeight | item.maxWidth/maxHeight | number fields (optional) |
| Content | invert | item.invert | toggle |
| Rendering | dotSize | dotSize | slider (1–6, step 1) |
| Rendering | pointSpacingCss | pointSpacingCss | slider (1–8, step 1) |
| Rendering | alpha | alpha | slider (0–255) |
| Rendering | defaultFontFamily | defaultFontFamily | select/text |
| Backend | backend | backend | segmented (auto / canvas2d / webgl2 / webgpu) |
| Backend | idle | idle | segmented (sleep / animate) |
| Performance | maxParticles | maxParticles | toggle ∞ ↔ slider (1k–50k) |
| Stage (UI only) | size | stageSize | preset buttons + Fill + drag handle |
| Stage (UI only) | background | bg | swatch cycle (dark / light / checker) |

Controls only show when relevant (e.g., text fields hidden in image mode and vice-versa;
fontSize numeric slider appears only for Fixed). `pointSpacingCss` and `maxParticles` changes
trigger re-rasterization (a morph) — expected and good to see.

## Aesthetic

- Reuse the existing oklch dark tokens in `index.css` (background, card, border, muted, primary).
  No new color system.
- Inspector: card surface, hairline borders, mono section headers (uppercase, tracked, muted),
  generous-but-tight spacing. Controls share one `Field` row layout (label left, control right) so
  the column reads as a calm grid.
- Micro-interactions: subtle hover/active background on segmented + buttons, smooth ~120ms
  transitions, sliders with a clear filled track. No bouncy/vibrant chrome — the *dots* animate,
  the UI stays still.
- Stage frame: thin border, rounded, soft inner shadow; background swatch lets dark/light/checker
  sit behind the dots. Resize handle is a small corner grip that brightens on hover.
- Header wordmark: a tiny static dot-cluster glyph + "dotimation" in the sans face; stats in mono.

## Edge cases & error handling

- **Invalid image URL / load failure:** `<Dotimation>` already no-ops on bad images; the stage
  shows nothing extra. Acceptable for a test tool; no error UI needed.
- **Empty text data:** allowed; produces zero particles. Stats show `0 dots`.
- **fontSize Fixed with empty/NaN number:** clamp to a sane min (e.g. 4) before passing down.
- **maxParticles below current sample:** expected; the cap applies and dots thin out.
- **Stage size larger than viewport:** clamp preset/custom sizes to the available stage area so the
  canvas never overflows; the drag handle is bounded to the container.
- **localStorage unavailable / corrupt JSON:** `use-config` wraps reads in try/catch and falls back
  to `DEFAULT_CONFIG`; schema-version key guards against stale shapes (bump → ignore old).
- **Space shortcut while typing:** ignored when the active element is an input/textarea/select.
- **backend not supported (e.g. no WebGPU):** the library's async cascade already falls back; the
  stats readout shows the *resolved* backend via `onStats`, which is exactly how you'd notice.

## Testing approach

Consistent with the repo convention that DOM/React-bound code is verified through the playground
itself (no unit tests for `test/ui`):

- Manual verification matrix run via `bun run dev`: each control changes the canvas as expected;
  A/B swap + Space morph; every size preset + Fill + drag-resize reflow correctly; background swatch
  cycles; backend segmented switches tiers (confirmed by the stats readout); reload restores config;
  Reset clears it.
- `bun run type-check` and `bun run lint` must pass (the playground has its own
  tsconfig/eslint; keep it clean).
- No new runtime dependencies; confirm the import-from-`src` Vite alias still resolves and HMR works.

## Rollout

Single self-contained change to `test/ui/`. The old `app.tsx` content is fully replaced; the
`use-screen` hook is retained (now used by `use-element-size`/Fill logic or removed if unused).
No migration, no API surface touched.
