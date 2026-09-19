# Workspace and Svelte review — 2026-09-19

Reviewed the uncommitted workspace refactor on top of `ebd69cd`, including shared runtime ownership, adapter lifecycles, raster scheduling, GPU cleanup, generated packages, release configuration, and the Svelte playground. The findings below are verified issues, not speculative style preferences. The three open findings are not fixed by this review round.

## Open findings

### P2 — A stalled image blocks subsequent content

**Locations:** `packages/core/src/raster/rasterize.ts` (`loadImage`, line 21), `packages/core/src/runtime/raster.ts` (serialized `await run(inputs)`, line 64).

The main-thread path waits on `HTMLImageElement.decode()` without a deadline or cancellation. The latest-wins scheduler cannot start another request until that operation settles. Switching from an image whose load is stalled to ordinary text therefore updates the canvas label but leaves its old particle content indefinitely. Invalidating the session rejects stale results but does not release the scheduler. Worker request timeouts do not solve this because failures fall back to the same main-thread path.

**Verification:** In Chromium, disabled Worker and held the first image decode promise pending. Started a valid image request, then switched to text `Recovered`. After 500 ms, the canvas label was `Recovered` but no new stats/layout had published. Releasing only the obsolete image decode immediately allowed the text to rasterize:

```text
stalled_image_before_release { label: "Recovered", stats: null }
stalled_image_after_release { backend: "canvas2d", particles: 1071 }
```

**Remedy:** Make obsolete asynchronous image work cancellable or bounded so new inputs can proceed. Preserve one active pixel walk, stale-result protection, and identity-aware cache eviction. A timeout alone bounds the delay but still makes later text wait unnecessarily. Cover changing to text and disconnect/reconnect while image loading remains pending.

### P2 — Canvas replacement bypasses WebGL context release

**Locations:** `packages/core/src/backends/webgl2/index.ts`, lines 232–238; `packages/core/src/runtime/controller.ts`, `stop` and `replace`.

WebGL disposal calls `loseContext()` only when the old canvas is already disconnected. The controller disposes the engine before requesting framework canvas replacement, so the old canvas is connected during disposal. No later cleanup releases that context after detachment. Buffers/programs are deleted, but the context remains alive until browser reclamation. Frequent backend/DPR/motion switches can retain unnecessary contexts and pressure the browser's context limit.

**Verification:** In Chromium, initialized WebGL, retained the old canvas/context, switched to Canvas2D, and waited for the new backend plus old-canvas detachment. After another 200 ms:

```text
webgl_disposal { oldCanvasConnected: false, oldContextLost: false }
```

**Remedy:** Express whether disposal is final or permits same-canvas reuse, or arrange guarded release after detachment. Do not indiscriminately lose contexts during React StrictMode effect replay; the successor may reuse the same canvas. Verify both permanent replacement and same-canvas replay.

### P2 — Prerelease tags use the stable registry channel

**Locations:** `.github/workflows/release.yml`, tag trigger and publish steps at lines 60, 67, 74; `scripts/check-release.ts`.

The workflow accepts every `v*` tag, and the release check only requires equality with the package version. All three publish commands omit `--tag`. If versions are set to a prerelease such as `0.8.0-beta.1`, that tag passes the guard and publishes to `latest`, making the prerelease the default installation.

**Verification:** Ran the actual release-check script from an isolated temporary directory containing `{ "version": "0.8.0-beta.1" }`; `v0.8.0-beta.1` exited 0. The installed Bun CLI documents `--tag` as defaulting to `latest`. No registry publication was attempted.

**Remedy:** Either reject prerelease versions explicitly or choose an explicit prerelease channel consistently for all three packages. Validate the tag/channel mapping independently of publication.

## Svelte work completed

The adapter already implements the shared public animation API, native `class`/`style`, `bind:canvas`, SSR/hydration, live updates, and keyed backend replacement. The missing product surface was its playground.

The completed playground supports independent A/B text/image compositions, local uploads and image URLs, font sizing/color, all dot and motion options, matching, backend and DPR controls, fill/fixed dimensions, backgrounds, keyboard morphing, validated local persistence, reset, and compilable Svelte code export. Upload callbacks cannot overwrite a different slot after navigation. Optional numeric limits preserve zero and support clearing; required numeric fields restore their actual value on blur.

The old playground passed `reducedMotion={false}` by default, overriding the user's OS preference. Its default is now **Follow system**, with explicit reduce/animate overrides. Chromium verification under emulated reduced motion confirms still, nonempty pixels with positive configured jitter.

Added focused tests for malformed settings, numeric bounds, independent defaults, option mapping, and compiling snippets containing script-like text. Browser checks cover uploads using actual red pixels, A/B preservation, live canvas identity, zero-particle clearing, keyboard focus, dimensions, persistence/reset/corrupt storage, motion preference, and mobile layout. The existing shared lifecycle, GPU parity, and packed-consumer checks remain in place.

## Validation scope

Completed: 194 unit tests; type checking and lint; all library and both playground builds; distribution validation; React and Svelte Chromium suites; isolated packed-consumer types, production builds, SSR, hydration and rendering. Desktop and mobile screenshots were inspected. The final Svelte suite also verifies Canvas2D pixels after viewport changes; GPU pixel parity uses direct GPU readback because a presented, sleeping GPU canvas can remain visible while `drawImage` reads a cleared buffer.

Run `bun test`, `bun run type-check`, `bun run lint`, both playground builds, `bun run build`, `bun run check:dist`, `bun run test:e2e`, and `bun run test:packages` for the complete gate. The playground scenarios are integrated into the Svelte branch of `test/e2e/smoke.e2e.ts` and therefore run in CI. The three open defects above are review reproductions, not passing regression tests claiming they are fixed.

Browser coverage is Chromium/SwiftShader. This round does not establish Safari/Firefox behavior, arbitrary hardware/device-loss behavior, or live registry publication. Passing these checks does not invalidate the reproduced edge cases above.
