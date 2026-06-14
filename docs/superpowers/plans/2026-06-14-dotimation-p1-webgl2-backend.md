# Dotimation P1 — WebGL2 Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a WebGL2 `Backend` that runs the particle simulation on the GPU via transform feedback and renders dots as instanced quads, selectable at runtime with graceful fallback to Canvas2D — hitting ~250k particles at 60fps with visual parity.

**Architecture:** Pure helpers (`viewport`, `reconcile-plan`) are unit-tested under `bun test`; the GL pieces (context, shaders, programs, backend wiring) are verified in the `test/ui` playground because no headless GL is available here. The CPU `reconcile` is refactored onto a shared pure `planReconcile` so the WebGL2 backend can apply the same structural morph to GPU buffers **without GPU→CPU readback**, preserving live positions of kept particles.

**Tech Stack:** TypeScript (strict, `isolatedDeclarations`), React 19, WebGL2 (transform feedback, instanced rendering), Bun, Biome.

---

## Conventions for every task

- `isolatedDeclarations` → explicit return types on every export. `noUncheckedIndexedAccess` → `!` where provably valid. Biome: single quotes, no semicolons, 2-space indent; run `bun run lint:fix` before committing.
- Tests under `test/` mirror `src/`, import via `@/`. Run one file: `bun test test/engine/reconcile-plan.test.ts`.
- Commits run the pre-commit hook (`lint` + `type-check`). Both must stay green the whole way (P1 adds files; it does not break the existing tree), so **do not use `--no-verify`** unless a task explicitly says a mid-step is temporarily red.
- GL tasks have no unit tests. Each ends with a **playground verification checkpoint** and is committed once that passes by eye. The provided GLSL/GL code is a strong starting point; tune it in the playground if a driver disagrees, keeping the documented behavior.

## Shared contracts (defined in Tasks 1–2, used throughout)

```ts
// State buffer layout (per particle, float32): x, y, vx, vy, r, g, b, alpha
export const STATE_FLOATS = 8
// Targets buffer layout (per particle, float32): homeX, homeY, homeR, homeG, homeB, targetAlpha
export const TARGET_FLOATS = 6

// src/engine/reconcile-plan.ts
export interface FieldDelta {
  active: number
  count: number
  overlap: number // leading slots whose evolving state is preserved
  relocate: { from: number; to: number; len: number } | null
  spawn: { start: number; end: number } | null
  firstLoad: boolean
}
export function planReconcile(prevActive: number, prevCount: number, newActive: number): FieldDelta
```

---

## Task 1: Viewport transform (pure)

**Files:**
- Create: `src/engine/viewport.ts`
- Test: `test/engine/viewport.test.ts`

CSS-px → WebGL clip-space helpers used by the render vertex shader logic (and unit-testable on the CPU so the math is verified independently of GL).

- [ ] **Step 1: Write the failing test**

Create `test/engine/viewport.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { cssToClipX, cssToClipY } from '@/engine/viewport'

describe('cssToClipX', () => {
  test('maps left edge to -1 and right edge to +1', () => {
    // devW = 200, dpr = 2 → CSS width 100
    expect(cssToClipX(0, 200, 2)).toBeCloseTo(-1, 6)
    expect(cssToClipX(100, 200, 2)).toBeCloseTo(1, 6)
    expect(cssToClipX(50, 200, 2)).toBeCloseTo(0, 6)
  })
})

describe('cssToClipY', () => {
  test('flips Y: top edge to +1, bottom edge to -1', () => {
    expect(cssToClipY(0, 200, 2)).toBeCloseTo(1, 6)
    expect(cssToClipY(100, 200, 2)).toBeCloseTo(-1, 6)
    expect(cssToClipY(50, 200, 2)).toBeCloseTo(0, 6)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/engine/viewport.test.ts`
Expected: FAIL — `Cannot find module '@/engine/viewport'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/engine/viewport.ts`:

```ts
/**
 * CSS-pixel → WebGL clip-space mapping. Positions are in CSS px (as the SoA
 * field stores them); the canvas backing store is `devPx = cssPx * dpr`. These
 * mirror what the render vertex shader computes, kept here so the math is
 * unit-testable without a GL context.
 */
export function cssToClipX(xCss: number, devW: number, dpr: number): number {
  return (xCss * dpr) / devW * 2 - 1
}

export function cssToClipY(yCss: number, devH: number, dpr: number): number {
  return 1 - (yCss * dpr) / devH * 2
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/engine/viewport.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
bun run lint:fix && git add src/engine/viewport.ts test/engine/viewport.test.ts
git commit -m "feat: pure CSS-px to clip-space viewport helpers"
```

---

## Task 2: Reconcile planner (pure) + refactor reconcile onto it

**Files:**
- Create: `src/engine/reconcile-plan.ts`
- Test: `test/engine/reconcile-plan.test.ts`
- Modify: `src/engine/field.ts` (use the planner; behavior unchanged)

`planReconcile` extracts the structural decision P0's `reconcile` makes, so the WebGL2 backend can apply the same morph to GPU buffers. Mirrors `reconcile` exactly: firstLoad / shrink / growth (+ fader relocate).

- [ ] **Step 1: Write the failing test**

Create `test/engine/reconcile-plan.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { planReconcile } from '@/engine/reconcile-plan'

describe('planReconcile', () => {
  test('first load spawns all, no overlap', () => {
    expect(planReconcile(0, 0, 3)).toEqual({
      active: 3, count: 3, overlap: 0, relocate: null,
      spawn: { start: 0, end: 3 }, firstLoad: true,
    })
  })

  test('shrink keeps actives, fades surplus, no spawn/relocate', () => {
    // prevActive 4, prevCount 4, newActive 2
    expect(planReconcile(4, 4, 2)).toEqual({
      active: 2, count: 4, overlap: 2, relocate: null, spawn: null, firstLoad: false,
    })
  })

  test('growth without faders spawns new actives, no relocate', () => {
    // prevActive 2, prevCount 2 (no faders), newActive 4
    expect(planReconcile(2, 2, 4)).toEqual({
      active: 4, count: 4, overlap: 2, relocate: null,
      spawn: { start: 2, end: 4 }, firstLoad: false,
    })
  })

  test('growth with in-flight faders relocates them then spawns', () => {
    // prevActive 2, prevCount 5 (3 faders), newActive 4
    expect(planReconcile(2, 5, 4)).toEqual({
      active: 4, count: 7, overlap: 2,
      relocate: { from: 2, to: 4, len: 3 },
      spawn: { start: 2, end: 4 }, firstLoad: false,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/engine/reconcile-plan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/engine/reconcile-plan.ts`:

```ts
export const STATE_FLOATS = 8
export const TARGET_FLOATS = 6

export interface FieldDelta {
  active: number
  count: number
  overlap: number
  relocate: { from: number; to: number; len: number } | null
  spawn: { start: number; end: number } | null
  firstLoad: boolean
}

/**
 * Computes the structural morph from the previous layout to `newActive` targets,
 * matching `reconcile`'s slot semantics. Pure — drives both the CPU SoA mutation
 * (Canvas2D) and the GPU buffer ops (WebGL2).
 */
export function planReconcile(
  prevActive: number,
  prevCount: number,
  newActive: number,
): FieldDelta {
  const oldFaders = prevCount - prevActive

  if (prevCount === 0) {
    return {
      active: newActive,
      count: newActive,
      overlap: 0,
      relocate: null,
      spawn: { start: 0, end: newActive },
      firstLoad: true,
    }
  }

  if (newActive <= prevActive) {
    return {
      active: newActive,
      count: prevCount,
      overlap: newActive,
      relocate: null,
      spawn: null,
      firstLoad: false,
    }
  }

  return {
    active: newActive,
    count: newActive + oldFaders,
    overlap: prevActive,
    relocate: oldFaders > 0 ? { from: prevActive, to: newActive, len: oldFaders } : null,
    spawn: { start: prevActive, end: newActive },
    firstLoad: false,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/engine/reconcile-plan.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Refactor `reconcile` to consume the planner**

In `src/engine/field.ts`, replace the body of `reconcile` so it derives the structure from `planReconcile` and applies it to the SoA, preserving today's behavior. Keep `copySlot`/`retargetActive`. New `reconcile`:

```ts
import { planReconcile } from './reconcile-plan'

export function reconcile(field: ParticleField, targets: FieldTargets): ParticleField {
  const plan = planReconcile(field.active, field.count, targets.count)
  const f = growField(field, Math.max(field.count, plan.count))

  if (plan.firstLoad) {
    for (let i = 0; i < targets.count; i++) {
      f.x[i] = targets.homeX[i]!
      f.y[i] = targets.homeY[i]!
      f.vx[i] = 0
      f.vy[i] = 0
      f.r[i] = targets.homeR[i]!
      f.g[i] = targets.homeG[i]!
      f.b[i] = targets.homeB[i]!
      f.alpha[i] = 0
      retargetActive(f, i, targets)
    }
    f.active = plan.active
    f.count = plan.count
    return f
  }

  if (plan.relocate) {
    for (let j = plan.relocate.len - 1; j >= 0; j--) {
      copySlot(f, plan.relocate.from + j, plan.relocate.to + j)
    }
  }

  if (plan.spawn) {
    const prevActive = field.active
    for (let i = plan.spawn.start; i < plan.spawn.end; i++) {
      if (prevActive > 0) {
        copySlot(f, i % prevActive, i)
      } else {
        f.x[i] = targets.homeX[i]!
        f.y[i] = targets.homeY[i]!
        f.r[i] = targets.homeR[i]!
        f.g[i] = targets.homeG[i]!
        f.b[i] = targets.homeB[i]!
      }
      f.vx[i] = 0
      f.vy[i] = 0
      f.alpha[i] = 0
    }
  }

  for (let i = 0; i < plan.active; i++) retargetActive(f, i, targets)
  for (let i = plan.active; i < plan.count; i++) f.targetAlpha[i] = 0
  f.active = plan.active
  f.count = plan.count
  return f
}
```

- [ ] **Step 6: Verify P0 reconcile tests still pass**

Run: `bun test test/engine/reconcile.test.ts test/engine/reconcile-plan.test.ts`
Expected: PASS — all existing reconcile tests green (behavior unchanged) plus the 4 planner tests.

- [ ] **Step 7: Commit**

```bash
bun run lint:fix && git add src/engine/reconcile-plan.ts test/engine/reconcile-plan.test.ts src/engine/field.ts
git commit -m "feat: extract pure planReconcile; refactor reconcile onto it"
```

---

## Task 3: GLSL shader sources

**Files:**
- Create: `src/backends/webgl2/shaders/sim.vert.ts`
- Create: `src/backends/webgl2/shaders/draw.vert.ts`
- Create: `src/backends/webgl2/shaders/draw.frag.ts`

Shaders as exported strings. No unit test; compilation is verified when the programs link (Tasks 6–7) and visually in the playground.

- [ ] **Step 1: Simulation vertex shader**

Create `src/backends/webgl2/shaders/sim.vert.ts`:

```ts
export const SIM_VERT = `#version 300 es
precision highp float;

in vec2 aPos;
in vec2 aVel;
in vec3 aColor;
in float aAlpha;
in vec2 aHomePos;
in vec3 aHomeColor;
in float aTargetAlpha;

uniform float uDt;
uniform float uK;
uniform float uC;
uniform float uColorRate;
uniform float uOpacityRate;
uniform float uJitter; // amount (px) this step, or 0
uniform float uSeed;

out vec2 vPos;
out vec2 vVel;
out vec3 vColor;
out float vAlpha;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

void main() {
  // semi-implicit Euler spring
  vec2 a = uK * (aHomePos - aPos) - uC * aVel;
  vec2 vel = aVel + a * uDt;
  vec2 pos = aPos + vel * uDt;

  // X-only jitter (matches the Canvas2D backend), gated by the caller via uJitter
  float j = (hash(float(gl_VertexID) + uSeed) - 0.5) * uJitter;
  pos.x += j;

  // exponential color ease
  float kc = 1.0 - exp(-uColorRate * uDt);
  vec3 color = aColor + (aHomeColor - aColor) * kc;

  // alpha toward target
  float d = uOpacityRate * uDt;
  float alpha = aTargetAlpha > 0.5 ? min(1.0, aAlpha + d) : max(0.0, aAlpha - d);

  vPos = pos;
  vVel = vel;
  vColor = color;
  vAlpha = alpha;
}
`
```

- [ ] **Step 2: Render vertex shader**

Create `src/backends/webgl2/shaders/draw.vert.ts`:

```ts
export const DRAW_VERT = `#version 300 es
precision highp float;

in vec2 aCorner;       // unit quad corner in [0,1]
in vec2 aInstancePos;  // particle pos (CSS px), instanced
in vec3 aInstanceColor;
in float aInstanceAlpha;

uniform float uDevW;
uniform float uDevH;
uniform float uDpr;
uniform float uDotSize; // device px footprint

out vec3 vColor;
out float vAlpha;

void main() {
  // device-px position of this corner of the dot
  vec2 dev = aInstancePos * uDpr + (aCorner - 0.5) * uDotSize + uDotSize * 0.5;
  // device px -> clip space (Y flipped)
  vec2 clip = vec2(dev.x / uDevW * 2.0 - 1.0, 1.0 - dev.y / uDevH * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vColor = aInstanceColor / 255.0;
  vAlpha = aInstanceAlpha;
}
`
```

- [ ] **Step 3: Render fragment shader**

Create `src/backends/webgl2/shaders/draw.frag.ts`:

```ts
export const DRAW_FRAG = `#version 300 es
precision highp float;

in vec3 vColor;
in float vAlpha;
out vec4 fragColor;

void main() {
  if (vAlpha <= 0.0) discard;
  fragColor = vec4(vColor, vAlpha);
}
`
```

- [ ] **Step 4: Commit**

```bash
bun run lint:fix && git add src/backends/webgl2/shaders
git commit -m "feat: WebGL2 sim + draw GLSL shader sources"
```

---

## Task 4: GL context + program helpers

**Files:**
- Create: `src/backends/webgl2/gl.ts`

Low-level helpers: context acquisition, shader compile, program link (with optional transform-feedback varyings + error reporting). DOM/GL-bound; verified when programs link in later tasks.

- [ ] **Step 1: Implement helpers**

Create `src/backends/webgl2/gl.ts`:

```ts
export function getGL(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  return canvas.getContext('webgl2', {
    premultipliedAlpha: false,
    alpha: true,
    antialias: false,
  })
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('webgl2: createShader failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`webgl2: shader compile failed: ${log}`)
  }
  return shader
}

/**
 * Links a program from vertex+fragment sources. If `feedbackVaryings` is given,
 * configures transform-feedback capture (interleaved) before linking.
 */
export function createProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
  feedbackVaryings?: string[],
): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error('webgl2: createProgram failed')
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc)
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc)
  gl.attachShader(program, vert)
  gl.attachShader(program, frag)
  if (feedbackVaryings) {
    gl.transformFeedbackVaryings(program, feedbackVaryings, gl.INTERLEAVED_ATTRIBS)
  }
  gl.linkProgram(program)
  gl.deleteShader(vert)
  gl.deleteShader(frag)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`webgl2: program link failed: ${log}`)
  }
  return program
}
```

- [ ] **Step 2: Commit**

```bash
bun run lint:fix && git add src/backends/webgl2/gl.ts
git commit -m "feat: WebGL2 context + program/shader helpers"
```

---

## Task 5: Buffers + ping-pong state

**Files:**
- Create: `src/backends/webgl2/buffers.ts`

Owns the two ping-pong state VBOs, the targets VBO, the static unit-quad, capacity growth, and the upload/relocate/spawn primitives the backend calls. DOM/GL-bound; verified in playground.

- [ ] **Step 1: Implement**

Create `src/backends/webgl2/buffers.ts`:

```ts
import type { ParticleField } from '@/types'
import { STATE_FLOATS, TARGET_FLOATS } from '@/engine/reconcile-plan'

// Unit quad as a triangle strip (4 corners in [0,1]).
const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1])

export interface GLBuffers {
  capacity: number
  quad: WebGLBuffer
  state: [WebGLBuffer, WebGLBuffer] // ping-pong
  targets: WebGLBuffer
  read: 0 | 1 // index of the current (read) state buffer
}

function makeBuffer(gl: WebGL2RenderingContext, bytes: number, usage: number): WebGLBuffer {
  const b = gl.createBuffer()
  if (!b) throw new Error('webgl2: createBuffer failed')
  gl.bindBuffer(gl.ARRAY_BUFFER, b)
  gl.bufferData(gl.ARRAY_BUFFER, bytes, usage)
  return b
}

export function createBuffers(gl: WebGL2RenderingContext, capacity: number): GLBuffers {
  const quad = gl.createBuffer()
  if (!quad) throw new Error('webgl2: createBuffer failed')
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW)

  const stateBytes = capacity * STATE_FLOATS * 4
  const targetBytes = capacity * TARGET_FLOATS * 4
  return {
    capacity,
    quad,
    state: [
      makeBuffer(gl, stateBytes, gl.DYNAMIC_COPY),
      makeBuffer(gl, stateBytes, gl.DYNAMIC_COPY),
    ],
    targets: makeBuffer(gl, targetBytes, gl.DYNAMIC_DRAW),
    read: 0,
  }
}

/** Builds the interleaved state array [x,y,vx,vy,r,g,b,alpha] for slots [start,end). */
export function packState(field: ParticleField, start: number, end: number): Float32Array {
  const out = new Float32Array((end - start) * STATE_FLOATS)
  let o = 0
  for (let i = start; i < end; i++) {
    out[o++] = field.x[i]!
    out[o++] = field.y[i]!
    out[o++] = field.vx[i]!
    out[o++] = field.vy[i]!
    out[o++] = field.r[i]!
    out[o++] = field.g[i]!
    out[o++] = field.b[i]!
    out[o++] = field.alpha[i]!
  }
  return out
}

/** Builds the interleaved targets array for slots [0,count). */
export function packTargets(field: ParticleField, count: number): Float32Array {
  const out = new Float32Array(count * TARGET_FLOATS)
  let o = 0
  for (let i = 0; i < count; i++) {
    out[o++] = field.homeX[i]!
    out[o++] = field.homeY[i]!
    out[o++] = field.homeR[i]!
    out[o++] = field.homeG[i]!
    out[o++] = field.homeB[i]!
    out[o++] = field.targetAlpha[i]!
  }
  return out
}

export function disposeBuffers(gl: WebGL2RenderingContext, b: GLBuffers): void {
  gl.deleteBuffer(b.quad)
  gl.deleteBuffer(b.state[0])
  gl.deleteBuffer(b.state[1])
  gl.deleteBuffer(b.targets)
}
```

- [ ] **Step 2: Commit**

```bash
bun run lint:fix && git add src/backends/webgl2/buffers.ts
git commit -m "feat: WebGL2 ping-pong state + targets buffers and packers"
```

---

## Task 6: Render program (instanced quads)

**Files:**
- Create: `src/backends/webgl2/program-draw.ts`

Wraps the draw program: caches attribute/uniform locations and draws `count` instances from a given state buffer. DOM/GL-bound; **playground-verified by feeding CPU-uploaded state** (before TF exists) in Task 8's first checkpoint.

- [ ] **Step 1: Implement**

Create `src/backends/webgl2/program-draw.ts`:

```ts
import { createProgram } from './gl'
import { DRAW_FRAG } from './shaders/draw.frag'
import { DRAW_VERT } from './shaders/draw.vert'
import { STATE_FLOATS } from '@/engine/reconcile-plan'

export interface DrawProgram {
  use(stateBuffer: WebGLBuffer, quad: WebGLBuffer, count: number, u: DrawUniforms): void
  dispose(): void
}

export interface DrawUniforms {
  devW: number
  devH: number
  dpr: number
  dotSize: number
}

const STRIDE = STATE_FLOATS * 4

export function createDrawProgram(gl: WebGL2RenderingContext): DrawProgram {
  const program = createProgram(gl, DRAW_VERT, DRAW_FRAG)
  const aCorner = gl.getAttribLocation(program, 'aCorner')
  const aPos = gl.getAttribLocation(program, 'aInstancePos')
  const aColor = gl.getAttribLocation(program, 'aInstanceColor')
  const aAlpha = gl.getAttribLocation(program, 'aInstanceAlpha')
  const uDevW = gl.getUniformLocation(program, 'uDevW')
  const uDevH = gl.getUniformLocation(program, 'uDevH')
  const uDpr = gl.getUniformLocation(program, 'uDpr')
  const uDotSize = gl.getUniformLocation(program, 'uDotSize')
  const vao = gl.createVertexArray()

  return {
    use(stateBuffer, quad, count, u): void {
      if (count <= 0) return
      gl.useProgram(program)
      gl.bindVertexArray(vao)

      gl.bindBuffer(gl.ARRAY_BUFFER, quad)
      gl.enableVertexAttribArray(aCorner)
      gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0)
      gl.vertexAttribDivisor(aCorner, 0)

      gl.bindBuffer(gl.ARRAY_BUFFER, stateBuffer)
      gl.enableVertexAttribArray(aPos)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, STRIDE, 0)
      gl.vertexAttribDivisor(aPos, 1)
      gl.enableVertexAttribArray(aColor)
      gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, STRIDE, 4 * 4)
      gl.vertexAttribDivisor(aColor, 1)
      gl.enableVertexAttribArray(aAlpha)
      gl.vertexAttribPointer(aAlpha, 1, gl.FLOAT, false, STRIDE, 7 * 4)
      gl.vertexAttribDivisor(aAlpha, 1)

      gl.uniform1f(uDevW, u.devW)
      gl.uniform1f(uDevH, u.devH)
      gl.uniform1f(uDpr, u.dpr)
      gl.uniform1f(uDotSize, u.dotSize)

      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
      gl.bindVertexArray(null)
    },
    dispose(): void {
      gl.deleteProgram(program)
      if (vao) gl.deleteVertexArray(vao)
    },
  }
}
```

- [ ] **Step 2: Commit**

```bash
bun run lint:fix && git add src/backends/webgl2/program-draw.ts
git commit -m "feat: WebGL2 instanced-quad render program"
```

---

## Task 7: Simulation program (transform feedback)

**Files:**
- Create: `src/backends/webgl2/program-sim.ts`

Wraps the sim program: binds the read state buffer + targets buffer as inputs, captures the evolving state into the write buffer via transform feedback. DOM/GL-bound; verified in Task 8.

- [ ] **Step 1: Implement**

Create `src/backends/webgl2/program-sim.ts`:

```ts
import { createProgram } from './gl'
import { SIM_VERT } from './shaders/sim.vert'
import { STATE_FLOATS, TARGET_FLOATS } from '@/engine/reconcile-plan'

// Minimal passthrough fragment shader (sim never rasterizes).
const SIM_FRAG = `#version 300 es
precision highp float;
out vec4 c;
void main() { c = vec4(0.0); }
`

export interface SimUniforms {
  dt: number
  k: number
  c: number
  colorRate: number
  opacityRate: number
  jitter: number
  seed: number
}

export interface SimProgram {
  step(read: WebGLBuffer, write: WebGLBuffer, targets: WebGLBuffer, count: number, u: SimUniforms): void
  dispose(): void
}

const STATE_STRIDE = STATE_FLOATS * 4
const TARGET_STRIDE = TARGET_FLOATS * 4

export function createSimProgram(gl: WebGL2RenderingContext): SimProgram {
  const program = createProgram(gl, SIM_VERT, SIM_FRAG, ['vPos', 'vVel', 'vColor', 'vAlpha'])
  const loc = {
    aPos: gl.getAttribLocation(program, 'aPos'),
    aVel: gl.getAttribLocation(program, 'aVel'),
    aColor: gl.getAttribLocation(program, 'aColor'),
    aAlpha: gl.getAttribLocation(program, 'aAlpha'),
    aHomePos: gl.getAttribLocation(program, 'aHomePos'),
    aHomeColor: gl.getAttribLocation(program, 'aHomeColor'),
    aTargetAlpha: gl.getAttribLocation(program, 'aTargetAlpha'),
    uDt: gl.getUniformLocation(program, 'uDt'),
    uK: gl.getUniformLocation(program, 'uK'),
    uC: gl.getUniformLocation(program, 'uC'),
    uColorRate: gl.getUniformLocation(program, 'uColorRate'),
    uOpacityRate: gl.getUniformLocation(program, 'uOpacityRate'),
    uJitter: gl.getUniformLocation(program, 'uJitter'),
    uSeed: gl.getUniformLocation(program, 'uSeed'),
  }
  const vao = gl.createVertexArray()
  const tf = gl.createTransformFeedback()

  return {
    step(read, write, targets, count, u): void {
      if (count <= 0) return
      gl.useProgram(program)
      gl.bindVertexArray(vao)

      gl.bindBuffer(gl.ARRAY_BUFFER, read)
      gl.enableVertexAttribArray(loc.aPos)
      gl.vertexAttribPointer(loc.aPos, 2, gl.FLOAT, false, STATE_STRIDE, 0)
      gl.enableVertexAttribArray(loc.aVel)
      gl.vertexAttribPointer(loc.aVel, 2, gl.FLOAT, false, STATE_STRIDE, 2 * 4)
      gl.enableVertexAttribArray(loc.aColor)
      gl.vertexAttribPointer(loc.aColor, 3, gl.FLOAT, false, STATE_STRIDE, 4 * 4)
      gl.enableVertexAttribArray(loc.aAlpha)
      gl.vertexAttribPointer(loc.aAlpha, 1, gl.FLOAT, false, STATE_STRIDE, 7 * 4)

      gl.bindBuffer(gl.ARRAY_BUFFER, targets)
      gl.enableVertexAttribArray(loc.aHomePos)
      gl.vertexAttribPointer(loc.aHomePos, 2, gl.FLOAT, false, TARGET_STRIDE, 0)
      gl.enableVertexAttribArray(loc.aHomeColor)
      gl.vertexAttribPointer(loc.aHomeColor, 3, gl.FLOAT, false, TARGET_STRIDE, 2 * 4)
      gl.enableVertexAttribArray(loc.aTargetAlpha)
      gl.vertexAttribPointer(loc.aTargetAlpha, 1, gl.FLOAT, false, TARGET_STRIDE, 5 * 4)

      gl.uniform1f(loc.uDt, u.dt)
      gl.uniform1f(loc.uK, u.k)
      gl.uniform1f(loc.uC, u.c)
      gl.uniform1f(loc.uColorRate, u.colorRate)
      gl.uniform1f(loc.uOpacityRate, u.opacityRate)
      gl.uniform1f(loc.uJitter, u.jitter)
      gl.uniform1f(loc.uSeed, u.seed)

      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf)
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, write)
      gl.enable(gl.RASTERIZER_DISCARD)
      gl.beginTransformFeedback(gl.POINTS)
      gl.drawArrays(gl.POINTS, 0, count)
      gl.endTransformFeedback()
      gl.disable(gl.RASTERIZER_DISCARD)
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null)
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null)
      gl.bindVertexArray(null)
    },
    dispose(): void {
      gl.deleteProgram(program)
      if (vao) gl.deleteVertexArray(vao)
      if (tf) gl.deleteTransformFeedback(tf)
    },
  }
}
```

> Note: the read VAO binds both the read state buffer and the targets buffer, but a single VAO caches the last-bound `ARRAY_BUFFER` per attribute, so the attribute pointers above are re-specified each `step` (cheap, robust). If profiling shows this matters, cache per-`(read,targets)` VAOs later.

- [ ] **Step 2: Commit**

```bash
bun run lint:fix && git add src/backends/webgl2/program-sim.ts
git commit -m "feat: WebGL2 transform-feedback simulation program"
```

---

## Task 8: WebGL2 backend wiring + reconcile→GPU sync

**Files:**
- Create: `src/backends/webgl2/index.ts`

The `Backend` implementation: ties context, buffers, and the two programs together; applies the `FieldDelta` to GPU buffers on `uploadField` (readback-free); runs the 15Hz jitter clock; and handles context loss. This is the integration linchpin — verified in the playground with the checkpoint below.

- [ ] **Step 1: Implement the backend**

Create `src/backends/webgl2/index.ts`:

First, make the shared jitter amount DRY: add `export const JITTER_AMOUNT = 1` to `src/engine/constants.ts`, and in `src/backends/canvas2d/simulate.ts` replace its local `const JITTER_AMOUNT = 1` with an import from `@/engine/constants`. Both backends now reference one source. Then create `src/backends/webgl2/index.ts`:

```ts
import {
  COLOR_RATE, JITTER_AMOUNT, JITTER_HZ, OPACITY_RATE, SETTLE_TIME, ZETA,
} from '@/engine/constants'
import { planReconcile, STATE_FLOATS } from '@/engine/reconcile-plan'
import { tuneSpring } from '@/engine/settle'
import type { Backend, ParticleField } from '@/types'
import { createBuffers, disposeBuffers, packState, packTargets, type GLBuffers } from './buffers'
import { getGL } from './gl'
import { createDrawProgram, type DrawProgram } from './program-draw'
import { createSimProgram, type SimProgram } from './program-sim'

export interface WebGL2Options {
  dotSize: number
}

const STATE_STRIDE_BYTES = STATE_FLOATS * 4

export function createWebGL2Backend(opts: WebGL2Options): Backend {
  let gl: WebGL2RenderingContext | null = null
  let canvasEl: HTMLCanvasElement | null = null
  let buffers: GLBuffers | null = null
  let sim: SimProgram | null = null
  let draw: DrawProgram | null = null
  let devW = 0
  let devH = 0
  let dpr = 1
  let count = 0
  let active = 0
  let lost = false
  let lastUpload = 0
  const { k, c } = tuneSpring({ settleTime: SETTLE_TIME, zeta: ZETA })
  const jitterPeriod = 1 / JITTER_HZ
  let jitterClock = 0
  // Faders fade out at OPACITY_RATE; after this long they are invisible and the
  // tail can be dropped. The Canvas2D backend compacts faders in stepField; the
  // GPU sim doesn't change count, so we expire them here by elapsed time.
  const FADE_DURATION_MS = (1 / OPACITY_RATE + 0.15) * 1000

  const onLost = (e: Event): void => {
    e.preventDefault()
    lost = true
  }
  const onRestored = (): void => {
    // Best-effort: rebuild GL resources; field will be re-uploaded on next reconcile.
    if (canvasEl) init(canvasEl, dpr)
    lost = false
  }

  function ensureCapacity(cap: number): void {
    if (!gl || !buffers || buffers.capacity >= cap) return
    const old = buffers
    const next = createBuffers(gl, cap)
    // Preserve the live state buffer (only [0,count) is meaningful) so growing
    // past capacity doesn't wipe in-flight particles. Targets are re-uploaded by
    // uploadField right after, so they don't need preserving here.
    if (count > 0) {
      gl.bindBuffer(gl.COPY_READ_BUFFER, old.state[old.read])
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, next.state[0])
      gl.copyBufferSubData(
        gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, count * STATE_STRIDE_BYTES,
      )
    }
    next.read = 0
    disposeBuffers(gl, old)
    buffers = next
  }

  function init(canvas: HTMLCanvasElement, devicePixelRatio: number): void {
    canvasEl = canvas
    dpr = devicePixelRatio
    devW = canvas.width
    devH = canvas.height
    const context = getGL(canvas)
    if (!context) throw new Error('webgl2: context unavailable')
    gl = context
    canvas.addEventListener('webglcontextlost', onLost, false)
    canvas.addEventListener('webglcontextrestored', onRestored, false)
    buffers = createBuffers(gl, 1024)
    sim = createSimProgram(gl)
    draw = createDrawProgram(gl)
    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.viewport(0, 0, devW, devH)
  }

  return {
    init,
    uploadField(field: ParticleField): void {
      if (!gl || !buffers) return
      const plan = planReconcile(active, count, field.active) // field.active == new targets.count
      ensureCapacity(field.capacity)
      const b = buffers
      const current = b.state[b.read]
      const other = b.state[b.read ^ 1]

      // targets buffer: always full re-upload from the reconciled field.
      gl.bindBuffer(gl.ARRAY_BUFFER, b.targets)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, packTargets(field, field.count))

      if (plan.firstLoad) {
        gl.bindBuffer(gl.ARRAY_BUFFER, current)
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, packState(field, 0, field.count))
      } else if (plan.relocate) {
        // Overlap clobber-safe rebuild into the OTHER buffer, then swap.
        gl.bindBuffer(gl.COPY_READ_BUFFER, current)
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, other)
        // keep overlap [0, overlap)
        gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, plan.overlap * STATE_STRIDE_BYTES)
        // relocate faders [from,from+len) -> [to,to+len)
        gl.copyBufferSubData(
          gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER,
          plan.relocate.from * STATE_STRIDE_BYTES,
          plan.relocate.to * STATE_STRIDE_BYTES,
          plan.relocate.len * STATE_STRIDE_BYTES,
        )
        // spawn new actives into the gap [start,end)
        if (plan.spawn) {
          gl.bindBuffer(gl.ARRAY_BUFFER, other)
          gl.bufferSubData(
            gl.ARRAY_BUFFER, plan.spawn.start * STATE_STRIDE_BYTES,
            packState(field, plan.spawn.start, plan.spawn.end),
          )
        }
        b.read = (b.read ^ 1) as 0 | 1
      } else if (plan.spawn) {
        // growth without faders: spawn region is beyond old count -> safe in place.
        gl.bindBuffer(gl.ARRAY_BUFFER, current)
        gl.bufferSubData(
          gl.ARRAY_BUFFER, plan.spawn.start * STATE_STRIDE_BYTES,
          packState(field, plan.spawn.start, plan.spawn.end),
        )
      }
      // shrink: nothing to do for state (targets already re-uploaded).

      active = plan.active
      count = plan.count
      lastUpload = performance.now()
    },
    step(dt: number): void {
      if (!gl || !buffers || !sim || lost || count <= 0) return
      // Drop fully-faded faders (the GPU sim never shrinks count itself).
      if (count > active && performance.now() - lastUpload > FADE_DURATION_MS) {
        count = active
      }
      jitterClock += dt
      let jitter = 0
      if (jitterClock >= jitterPeriod) {
        jitter = JITTER_AMOUNT
        jitterClock -= jitterPeriod
      }
      const b = buffers
      sim.step(b.state[b.read], b.state[b.read ^ 1], b.targets, count, {
        dt, k, c, colorRate: COLOR_RATE, opacityRate: OPACITY_RATE,
        jitter, seed: Math.random() * 1000,
      })
      b.read = (b.read ^ 1) as 0 | 1
    },
    draw(): void {
      if (!gl || !buffers || !draw || lost) return
      gl.viewport(0, 0, devW, devH)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      const b = buffers
      draw.use(b.state[b.read], b.quad, count, { devW, devH, dpr, dotSize: opts.dotSize })
    },
    resize(w: number, h: number): void {
      devW = w
      devH = h
      if (gl) gl.viewport(0, 0, w, h)
    },
    dispose(): void {
      if (canvasEl) {
        canvasEl.removeEventListener('webglcontextlost', onLost)
        canvasEl.removeEventListener('webglcontextrestored', onRestored)
      }
      if (gl && buffers) disposeBuffers(gl, buffers)
      sim?.dispose()
      draw?.dispose()
      gl = null
      buffers = null
      sim = null
      draw = null
    },
  }
}
```

> Note on `uploadField`: it receives the already-`reconcile`d `field` from the component, and re-derives the same `plan` from its own tracked `active`/`count` (which mirror the field's previous state). `field.active` equals the new `targets.count`. The `targets` buffer is re-uploaded in full every call; only the evolving-state buffer uses the delta to preserve live GPU positions.

- [ ] **Step 2: Playground checkpoint (render path)**

Temporarily make `select.ts` return this backend (or hardcode in the playground import) and run `bun run dev`. Confirm: text/image renders as dots, fly-in works, morph between presets is smooth, settle/sleep and `idle="animate"` behave, `dotSize` thickens dots, and shrink→grow (faders) doesn't corrupt. Compare side-by-side with `canvas2d`. Fix shader/buffer issues here.

- [ ] **Step 3: Commit**

```bash
bun run lint:fix && git add src/backends/webgl2/index.ts
git commit -m "feat: WebGL2 backend (TF sim + instanced draw + readback-free reconcile sync)"
```

---

## Task 9: Async backend selection + dynamic import

**Files:**
- Modify: `src/engine/select.ts`

Make selection async and code-split the WebGL2 backend so Canvas2D-only users don't download it.

- [ ] **Step 1: Rewrite `select.ts`**

Replace `src/engine/select.ts` with:

```ts
import { createCanvas2DBackend } from '@/backends/canvas2d'
import type { Backend, BackendKind } from '@/types'
import { detectCapabilities, resolveBackendKind } from './backend'

export interface SelectOptions {
  requested: BackendKind
  dotSize: number
}

/**
 * Resolves and constructs the best available backend, loading GPU backends via
 * dynamic import so they stay out of the core bundle. Any failure falls back to
 * Canvas2D (always present).
 */
export async function selectBackend(opts: SelectOptions): Promise<Backend> {
  const kind = resolveBackendKind(opts.requested, detectCapabilities())
  if (kind === 'webgl2') {
    try {
      const mod = await import('@/backends/webgl2')
      return mod.createWebGL2Backend({ dotSize: opts.dotSize })
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.info('[dotimation] webgl2 backend failed to load, using canvas2d', err)
      }
    }
  }
  if (kind === 'webgpu' && typeof console !== 'undefined') {
    console.info('[dotimation] webgpu backend not yet available, using canvas2d')
  }
  return createCanvas2DBackend({ dotSize: opts.dotSize })
}
```

> Note: `selectBackend` constructing the backend doesn't guarantee `init` succeeds. The component (Task 10) wraps `init` in try/catch and falls back to Canvas2D if the WebGL2 context can't be created at init time.

- [ ] **Step 2: Commit**

```bash
bun run lint:fix && git add src/engine/select.ts
git commit -m "feat: async backend selection with dynamic import of webgl2"
```

---

## Task 10: Component async backend handling

**Files:**
- Modify: `src/components/dotimation.tsx`

The engine-creation effect must now await `selectBackend`, guard against races, and fall back to Canvas2D if WebGL2 `init` throws.

- [ ] **Step 0: Add a context-less `sizeCanvas` helper**

The component currently sizes the visible canvas with `getCtx`, which calls `getContext('2d')`. A canvas can only ever hold ONE context type, so that would make the WebGL2 backend's `getContext('webgl2')` return `null`. Add a sizing helper that does NOT acquire a context, and let each backend acquire its own. In `src/utils/utils.ts`, add below `getCtx`:

```ts
/**
 * Sizes a canvas's drawing buffer to device pixels and its CSS box to logical
 * pixels, WITHOUT acquiring a rendering context — so the caller's backend is
 * free to take either a '2d' or 'webgl2' context. Returns the dpr used.
 */
export function sizeCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): number {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  return dpr
}
```

(`getCtx` stays — the rasterizer still uses it for its offscreen 2D canvas.)

- [ ] **Step 1: Update the engine-creation effect**

In `src/components/dotimation.tsx`, replace the engine-creation `useEffect` with an async-aware version. Keep the rest of the component (props, hook, targets-push effect) unchanged:

```tsx
  // Create / recreate the engine when canvas geometry or backend config changes.
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let cancelled = false
    let engine: Engine | null = null

    const dpr = sizeCanvas(canvas, width, height)

    void (async () => {
      let be = await selectBackend({ requested: backend, dotSize })
      if (cancelled) {
        be.dispose()
        return
      }
      try {
        await be.init(canvas, dpr)
      } catch {
        // WebGL2 init failed at runtime — fall back to Canvas2D.
        be.dispose()
        be = createCanvas2DBackend({ dotSize })
        await be.init(canvas, dpr)
      }
      if (cancelled) {
        be.dispose()
        return
      }
      engine = createEngine({ backend: be, canvas, dpr, idle })
      engineRef.current = engine
      fieldRef.current = createField(1024)
      if (targetsRef.current) {
        fieldRef.current = reconcile(fieldRef.current, targetsRef.current)
        engine.setField(fieldRef.current)
      }
    })()

    return () => {
      cancelled = true
      engine?.dispose()
      engineRef.current = null
    }
  }, [width, height, backend, dotSize, idle])
```

Update the imports at the top of the file: add the Canvas2D fallback constructor, and swap the `getCtx` import for `sizeCanvas` (the component no longer needs a 2D context on the visible canvas):

```tsx
import { createCanvas2DBackend } from '@/backends/canvas2d'
import { sizeCanvas } from '@/utils/utils' // replaces the getCtx import
```

(`selectBackend` is already imported; ensure its usage is now awaited. `init` is typed `Promise<void> | void`, so `await` is valid for both backends.)

- [ ] **Step 2: Full gate**

Run: `bun run type-check && bun run lint && bun test`
Expected: all green (the new pure tests included; no regressions).

- [ ] **Step 3: Playground verification**

`bun run dev`: confirm default `auto` selects WebGL2 on a capable machine (check the dots render via GPU — temporarily log the chosen kind if unsure), switching to `canvas2d` still works, and rapidly toggling backend/dotSize never leaves a blank or crashed canvas (the `cancelled` guard).

- [ ] **Step 4: Commit**

```bash
bun run lint:fix && git add src/components/dotimation.tsx
git commit -m "feat: async backend selection in component with canvas2d fallback"
```

---

## Task 11: Playground — WebGL2 option + stress preset

**Files:**
- Modify: `test/ui/src/app.tsx`

- [ ] **Step 1: Add `webgl2` to the backend buttons and a high-count stress preset**

In `test/ui/src/app.tsx`:
- Add `'webgl2'` to the backend button list: change `(['auto', 'canvas2d'] as BackendKind[])` to `(['auto', 'canvas2d', 'webgl2'] as BackendKind[])`.
- Add a stress `TEST_ITEMS` entry that produces many particles, e.g. a large multi-line block at a small `pointSpacingCss`:

```tsx
  {
    label: 'Stress (many dots)',
    item: {
      type: 'text',
      data: 'DOTIMATION\nDOTIMATION\nDOTIMATION\nDOTIMATION',
      fontSize: 'AUTO',
      fontFamily: 'sans-serif',
    },
  },
```

(Keep the existing presets and the FPS overlay.)

- [ ] **Step 2: Manual verification checklist**

`bun run dev`. Confirm:
- `webgl2` button renders dots identically to `canvas2d` for each preset (parity).
- Morph between presets is smooth on `webgl2` (kept dots glide, new dots fly in, removed dots fade) — proves the readback-free sync.
- The stress preset holds 60fps on `webgl2` and the FPS overlay shows it far outperforming `canvas2d` at high counts.
- `dotSize` toggle and settle/sleep vs `idle="animate"` behave the same across backends.

- [ ] **Step 3: Commit**

```bash
git add test/ui/src/app.tsx
git commit -m "test: playground webgl2 backend option + stress preset"
```

---

## Task 12: Docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Backends bullet**

In `CLAUDE.md`'s architecture section, update the Backends bullet to note that **WebGL2 has shipped** alongside Canvas2D: transform-feedback GPU simulation + instanced-quad rendering, selected via async dynamic import in `src/engine/select.ts` with Canvas2D fallback; the readback-free reconcile sync uses `src/engine/reconcile-plan.ts` (shared pure planner). Note that `src/engine/viewport.ts` and `reconcile-plan.ts` are unit-tested while the GL pieces (`src/backends/webgl2/`) are playground-verified. Keep WebGPU listed as planned (P2).

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document shipped WebGL2 backend in CLAUDE.md"
```

---

## Definition of done (P1)

- `bun run type-check && bun run lint && bun test && bun run build` all green (pure helpers tested: viewport + planReconcile; reconcile refactor keeps P0 tests green).
- Playground: `webgl2` renders with visual parity to `canvas2d` (morph, fade, settle/sleep, dotSize, shimmer); the stress preset sustains 60fps on WebGL2 and visibly beats Canvas2D at high counts.
- `backend='auto'` selects WebGL2 when available and falls back to Canvas2D on any failure; dynamic import keeps WebGL2 out of the core bundle.
- WebGL2 context loss does not crash (no-op + restore handler).

## Self-review notes (done while writing)

- **Spec coverage:** TF GPU sim (T3/T7), instanced-quad render (T3/T6), readback-free reconcile→GPU sync via pure planner (T2/T8), async dynamic-import selection (T9), component async + fallback (T10), context-loss guard (T8), viewport math (T1), playground + parity (T11), docs (T12). Worker rasterization / benchmark harness / `maxParticles` remain P3 per the parent spec.
- **Type consistency:** `FieldDelta` and `STATE_FLOATS`/`TARGET_FLOATS` defined once in `reconcile-plan.ts` and reused by `buffers.ts`/`index.ts`; `planReconcile(prevActive, prevCount, newActive)`, `createWebGL2Backend({ dotSize })`, `selectBackend(): Promise<Backend>`, `createDrawProgram`/`createSimProgram` signatures match across tasks.
- **Risk note:** the readback-free state sync (T8 `uploadField`) is the highest-risk logic; the pure `planReconcile` is unit-tested and the clobber-safe rebuild (relocate via the other ping-pong buffer) is called out explicitly. The GL/GLSL is playground-tuned, not unit-tested, by necessity.
