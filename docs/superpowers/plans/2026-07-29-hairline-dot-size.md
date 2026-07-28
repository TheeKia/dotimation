# `dots.size: 'hairline'` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users reliably request 1-device-pixel dots at any DPR via `dots={{ size: 'hairline' }}`, resolved entirely in the params core (zero backend/shader/engine changes).

**Architecture:** `resolveDots` maps the literal `'hairline'` to an internal `size: 0` sentinel. All three backends already derive the dot footprint as `max(1, round(dotSize * dpr))` (the cross-tier parity contract), so `0` floors to exactly 1 device pixel on every tier at every DPR. Numeric `size: 0` input keeps falling back to the default, so the sentinel is unreachable except through the explicit string. `ResolvedDots.size` stays `number`, so `toSimParams`, the live-params effect, `SimParams.dotSize`, and every backend are untouched.

**Tech Stack:** TypeScript, Bun (`bun test`), React 19, Biome. Spec: `docs/superpowers/specs/2026-07-29-hairline-dot-size-design.md`.

## Global Constraints

- **Bun only** — `bun install`, `bun test`, `bun run type-check`, `bun run lint`. Never npm/yarn/pnpm.
- **`isolatedDeclarations: true`** — every *exported* function needs an explicit return type (private helpers: add one anyway, it's house style).
- **Formatting is Biome-owned** — single quotes, no semicolons, 2-space indent. Run `bun run lint:fix` before committing; the pre-commit hook runs `lint` + `type-check`.
- **Degrade, never throw** — params sanitization silently clamps or falls back; do not add throws.
- **Root `tsc` covers `src/**` only; the playground type-checks via `cd test/ui && bunx tsc -b`** (its `paths` maps `dotimation` → `../../src/index.tsx`, so it sees source types directly, not `dist/`).
- **No release work** — ships in the next minor; version bump/publish is manual and out of scope.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: `'hairline'` resolution in the params core

**Files:**
- Modify: `src/engine/params.ts` (the `DotOptions.size` JSDoc/type at lines 4–13, and `resolveDots` at lines 87–104)
- Test: `test/engine/params.test.ts`

**Interfaces:**
- Consumes: existing `num()` helper and `DEFAULT_DOTS` in `src/engine/params.ts`.
- Produces: `DotOptions.size?: number | 'hairline'`; `resolveDots({ size: 'hairline' }).size === 0`. `ResolvedDots` is unchanged (`size: number`). Tasks 2–4 rely on the `0` sentinel meaning "hairline".

- [ ] **Step 1: Write the failing tests**

In `test/engine/params.test.ts`, append inside the `describe('resolveDots', …)` block (after the `'max: …'` test ending line 59):

```ts
  test("size: 'hairline' resolves to the internal 0 sentinel", () => {
    const r = resolveDots({ size: 'hairline' })
    expect(r.size).toBe(0)
    expect(r.spacing).toBe(DEFAULT_DOTS.spacing)
    expect(r.threshold).toBe(DEFAULT_DOTS.threshold)
    expect(r.max).toBe(DEFAULT_DOTS.max)
  })

  test('junk string sizes (JS consumers) fall back to the default', () => {
    expect(resolveDots({ size: 'chunky' as unknown as number }).size).toBe(
      DEFAULT_DOTS.size,
    )
  })
```

And inside the `describe('toSimParams', …)` block (after the `'defaults reproduce the 0.6.0 constants'` test):

```ts
  test('carries the hairline 0 sentinel through to dotSize', () => {
    const p = toSimParams(
      resolveMotion(),
      resolveDots({ size: 'hairline' }).size,
      false,
    )
    expect(p.dotSize).toBe(0)
  })
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `bun test test/engine/params.test.ts`
Expected: 2 failures — `"size: 'hairline' resolves to the internal 0 sentinel"` and `'carries the hairline 0 sentinel through to dotSize'`, both receiving `1` (the default — `num('hairline', 1)` falls back today) where `0` is expected. The junk-string test passes from the start (it pins existing fallback behavior). All pre-existing tests still pass.

- [ ] **Step 3: Implement the resolution**

In `src/engine/params.ts`:

Replace the `size` field of `DotOptions` (lines 5–6):

```ts
  /**
   * Dot footprint in CSS px (scales with devicePixelRatio), or `'hairline'`
   * for exactly 1 device pixel at any DPR. @default 1
   */
  size?: number | 'hairline'
```

Add a private helper directly above `resolveDots` (after `num()`):

```ts
/**
 * 'hairline' resolves to the internal 0 sentinel: every tier derives its dot
 * footprint as max(1, round(dotSize * dpr)) (the cross-tier parity contract —
 * see CLAUDE.md), so 0 floors to exactly one device pixel at any DPR and any
 * maxDpr. Numeric size <= 0 still falls back to the default, which keeps the
 * sentinel unreachable except through the explicit string.
 */
function resolveSize(raw: number | 'hairline' | undefined): number {
  if (raw === 'hairline') return 0
  const n = num(raw, DEFAULT_DOTS.size)
  return n > 0 ? n : DEFAULT_DOTS.size
}
```

Rewrite `resolveDots` to use it (drop the old `const size = num(input?.size, DEFAULT_DOTS.size)` line and the `size > 0 ? size : DEFAULT_DOTS.size` expression in the return):

```ts
/** Fills defaults and sanitizes out-of-range input (silently — degrade, never throw). */
export function resolveDots(input?: DotOptions): ResolvedDots {
  const spacing = num(input?.spacing, DEFAULT_DOTS.spacing)
  const threshold = num(input?.threshold, DEFAULT_DOTS.threshold)
  // Infinity is the valid "unbounded" value for max, so only NaN falls back.
  const rawMax = input?.max
  const max =
    typeof rawMax === 'number' && !Number.isNaN(rawMax)
      ? Math.max(0, Math.floor(rawMax))
      : DEFAULT_DOTS.max
  return {
    size: resolveSize(input?.size),
    spacing: Math.max(1, spacing),
    threshold: Math.min(255, Math.max(0, threshold)),
    max,
  }
}
```

- [ ] **Step 4: Run tests, type-check, lint**

Run: `bun test test/engine/params.test.ts` — Expected: all pass.
Run: `bun test` — Expected: full suite passes (nothing else consumes `DotOptions.size` as a type except the component, which receives the already-resolved number).
Run: `bun run type-check` — Expected: clean (the widened union never escapes `resolveDots`).
Run: `bun run lint:fix` then `bun run lint` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/engine/params.ts test/engine/params.test.ts
git commit -m "feat: dots.size 'hairline' — exactly 1 device pixel at any DPR

Resolved in the params core to the internal dotSize 0 sentinel; the
cross-tier footprint floor max(1, round(dotSize * dpr)) renders it as
one device pixel on every backend. No backend/shader changes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Pin the 1-device-pixel floor for the `0` sentinel (canvas2d)

**Files:**
- Test: `test/backends/canvas2d/render.test.ts`

**Interfaces:**
- Consumes: `renderField(view, field, devW, devH, dpr, dotSize, clearRect?)` and `computeDirtyRect(field, devW, devH, dpr, dotSize)` from `@/backends/canvas2d/render`; the `one(x, y)` targets helper already defined at the top of this test file.
- Produces: characterization tests that fail loudly if anyone ever removes the `max(1, round(dotSize * dpr))` floor Task 1's sentinel depends on.

These are **pin tests, not TDD red/green** — they assert behavior that already exists. Expected to PASS on first run. If any of them FAIL, STOP and report: the floor invariant does not hold and the whole design is invalid — do not "fix" the tests.

- [ ] **Step 1: Write the pin tests**

In `test/backends/canvas2d/render.test.ts`, append inside `describe('renderField', …)` (after the `'dotSize is CSS px: …'` test ending line 117):

```ts
  test('hairline sentinel: dotSize 0 floors to exactly 1 pixel at dpr 1', () => {
    const f = reconcile(createField(1), one(2, 3))
    f.x[0] = 2
    f.y[0] = 3
    f.alpha[0] = 1
    const view = new Uint32Array(8 * 8)
    renderField(view, f, 8, 8, 1, 0)
    expect(view[3 * 8 + 2]).not.toBe(0)
    expect(view.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0)).toBe(1)
  })

  test('hairline sentinel: dotSize 0 still paints exactly 1 device pixel at dpr 2', () => {
    const f = reconcile(createField(1), one(1, 1))
    f.x[0] = 1
    f.y[0] = 1
    f.alpha[0] = 1
    const view = new Uint32Array(8 * 8)
    renderField(view, f, 8, 8, 2, 0)
    // CSS (1,1) snaps to device (2,2); footprint max(1, round(0 * 2)) = 1.
    expect(view[2 * 8 + 2]).not.toBe(0)
    expect(view.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0)).toBe(1)
  })
```

And inside `describe('computeDirtyRect', …)` (after the `'clamps to the canvas bounds'` test):

```ts
  test('hairline sentinel: dotSize 0 yields a 1x1 dirty rect', () => {
    const f = reconcile(createField(1), one(2, 3))
    f.x[0] = 2
    f.y[0] = 3
    f.alpha[0] = 1
    expect(computeDirtyRect(f, 8, 8, 1, 0)).toEqual({ x: 2, y: 3, w: 1, h: 1 })
  })
```

- [ ] **Step 2: Run the tests**

Run: `bun test test/backends/canvas2d/render.test.ts`
Expected: ALL PASS on first run (see the pin-test note above; a failure here means STOP and report, not edit).

- [ ] **Step 3: Lint and commit**

Run: `bun run lint:fix` then `bun run lint` — Expected: clean.

```bash
git add test/backends/canvas2d/render.test.ts
git commit -m "test: pin the 1-device-px footprint floor the hairline sentinel relies on

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Playground hairline toggle

**Files:**
- Modify: `test/ui/src/config/types.ts` (PlaygroundConfig, line ~33)
- Modify: `test/ui/src/config/presets.ts` (DEFAULT_CONFIG, line ~52)
- Modify: `test/ui/src/components/inspector/rendering-controls.tsx` (size Field, lines 21–28)
- Modify: `test/ui/src/components/stage/stage.tsx` (dots prop, lines 62–67)

**Interfaces:**
- Consumes: `DotOptions.size?: number | 'hairline'` from Task 1 (the playground's `tsc` resolves `dotimation` to `../../src/index.tsx` via `paths`); the existing `Toggle` control (`test/ui/src/components/controls/toggle.tsx`, props `{ checked: boolean; onChange: (v: boolean) => void }`) and `Field` wrapper.
- Produces: a `hairline` switch in the rendering inspector so all three backends (canvas2d/webgl2/webgpu have no headless coverage) can be eyeballed at 1 device pixel.

There is no unit-test cycle here (the playground is DOM-shell code, covered by eyeball + type-check per project convention). The size slider intentionally stays enabled while hairline is on — it simply has no effect until toggled off; graying it out is UI polish this playground doesn't do elsewhere.

- [ ] **Step 1: Add the config field**

In `test/ui/src/config/types.ts`, inside `PlaygroundConfig`, directly after `size: number`:

```ts
  hairline: boolean
```

In `test/ui/src/config/presets.ts`, inside `DEFAULT_CONFIG`, directly after `size: 1,`:

```ts
  hairline: false,
```

(No storage migration needed: `load()` spreads `{ ...DEFAULT_CONFIG, ...parsed }`, so existing persisted configs pick up `hairline: false`.)

- [ ] **Step 2: Add the toggle to the rendering inspector**

In `test/ui/src/components/inspector/rendering-controls.tsx`, add the import (Biome will order it):

```ts
import { Toggle } from '../controls/toggle'
```

Directly after the `size` `<Field>` (closes line 28), insert:

```tsx
      <Field label="hairline">
        <Toggle
          checked={config.hairline}
          onChange={(v) => update({ hairline: v })}
        />
      </Field>
```

- [ ] **Step 3: Wire it into the Dotimation dots prop**

In `test/ui/src/components/stage/stage.tsx`, change the `dots` prop's `size` line (line 63) from `size: config.size,` to:

```ts
                size: config.hairline ? 'hairline' : config.size,
```

- [ ] **Step 4: Type-check the playground and lint**

Run: `cd test/ui && bunx tsc -b && cd ../..`
Expected: clean (proves the widened `number | 'hairline'` union flows through the real component props).
Run: `bun run lint:fix` then `bun run lint` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add test/ui/src/config/types.ts test/ui/src/config/presets.ts test/ui/src/components/inspector/rendering-controls.tsx test/ui/src/components/stage/stage.tsx
git commit -m "feat(playground): hairline toggle for eyeballing 1-device-px dots on all tiers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Documentation — README + CLAUDE.md

**Files:**
- Modify: `README.md` (dots table, line 63)
- Modify: `CLAUDE.md` (the `dots?: DotOptions` bullet under "Component props beyond the basics", and the "Cross-tier parity" paragraph in section 4)

**Interfaces:**
- Consumes: the Task 1 behavior (string `'hairline'` → internal `0` → 1 device px on every tier).
- Produces: user-facing and contributor-facing docs; nothing downstream.

- [ ] **Step 1: README dots table**

Replace the `size` row (line 63):

```markdown
| `size` | `1` | Dot footprint in CSS px (scales with devicePixelRatio — same visual size at every density), or `'hairline'` for exactly 1 device pixel at any DPR (the crispest possible dots). Non-positive or non-finite numbers fall back to the default |
```

- [ ] **Step 2: CLAUDE.md**

In the `**dots?: DotOptions**` bullet (under "Component props beyond the basics"), append after "`threshold`/`spacing`/`max` feed `useFieldTargets` (item 1).":

```markdown
 `size` also accepts `'hairline'` — resolved to the internal `dotSize: 0` sentinel, which the cross-tier footprint floor renders as exactly 1 device pixel at any DPR (numeric `0` still falls back to the default, so the sentinel is only reachable via the string).
```

In the "Cross-tier parity" paragraph (section 4), append after "so dots render the same visual size at every DPR.":

```markdown
 The `max(1, …)` floor is also a contract: `dots.size: 'hairline'` resolves to `dotSize: 0` and relies on it to render exactly 1 device pixel on every tier.
```

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document dots.size 'hairline'

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
