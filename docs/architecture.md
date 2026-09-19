# Framework adapters and shared runtime

The workspace contains three independently packaged libraries with a single implementation of animation behavior:

```text
dotimation (React) ────────┐
                          ├── @dotimation/core
@dotimation/svelte ────────┘
```

Core contains both pure algorithms and browser-bound code. Framework independence means no React/Svelte imports, not the absence of DOM APIs. Pure simulation, reconciliation, sampling and scheduling remain directly unit-testable; browser behavior is exercised through both adapters.

## Ownership

| Owner | Responsibilities |
| --- | --- |
| Core engine | Physics, matching, field buffers, settle policy, frame loop and backends |
| Core runtime | Raster jobs, initialization/cancellation, observers, font readiness, reconciliation and stats |
| Adapter | Canvas markup, CSS sizing, accessibility, native props/references, lifecycle and keyed replacement |

The adapter creates a controller without side effects, supplies complete option snapshots after commit, and connects a rendered canvas. `connect` returns a cleanup scoped to that specific session. It can be replayed during React StrictMode; a stale cleanup cannot destroy a new session. When fallback or configuration requires a different canvas, the controller ends the old session and calls the host's replacement callback. The framework renders a fresh keyed element and reconnects it.

This avoids two conflicting owners of the DOM. It also preserves backend fallback: once a canvas has acquired a rendering context, it cannot switch context types.

Motion and dot-size updates change backend parameters without replacing the canvas. Raster scheduling compares values rather than object identity, serializes work and retains only the latest queued request. Every async completion is checked against its session or raster generation. Failed raster inputs can retry on a subsequent adapter update; retrying is not an unbounded background loop.

Svelte snapshots nested prop values inside a tracked effect before calling the runtime under `untrack`. Attachment setup is untracked and separate from updates, so changing props does not destroy the session. React updates after every commit, with primitive comparisons handled by the runtime.

## Public contracts

Both adapters share content, dot/motion options, sizing, backend selection, matching, reduced motion and stats. React exposes `className`, a CSSProperties object and `ref`. Svelte exposes `class`, a CSS string and `bind:canvas`. Fixed dimensions and `fill` remain a discriminated union in both generated public APIs.

React retains its existing `dotimation` import and previously exported implementation types. Core explicitly exports those compatibility types, but internal constructors and file paths are not package entry points. New framework adapters should use the controller rather than import internals.

Imports and controller construction are SSR-safe. Effects/attachments acquire browser resources only after mounting. Both adapters emit a canvas with CSS dimensions and accessibility attributes on the server, so hydration has a stable DOM shape and reserved space.

## Build and validation

Core and React use the explicit browser-targeted bunup scripts. React uses a build-only TS config without source aliases so its declarations reference the core package instead of duplicating core types; source tests still work without a prior build. The worker is generated before core builds and remains inlined. GPU implementations stay dynamically imported. React retains a `use client` entry directive. Svelte uses `@sveltejs/package`, preserving preprocessed components and generating declarations for Svelte-aware consumers.

Source-linked playgrounds provide fast development. They are complemented by packed-consumer fixtures that install tarballs in temporary directories outside the repository. Those checks exercise public declarations, a production Vite build, server rendering without browser globals, hydration preserving the server canvas, and actual browser output. The Svelte consumer has no React dependency. The unpublished core tarball is an explicit override, and its packed dependency version is checked separately.

Use `bun run build`, `bun run check:dist`, `bun run type-check`, `bun run lint`, `bun test`, `bun run test:e2e`, and `bun run test:packages` before release. Build both playgrounds as well. Browser validation currently targets Chromium with SwiftShader; Metal parity can be selected locally. This change does not establish Firefox/Safari or comprehensive hardware/device-loss coverage.

## Release process

The root is private; published packages live under `packages/`. Keep the three package versions aligned. `workspace:*` is converted to the actual core version when packed, so adapters require that version of core.

1. Notes are generated from commits by default. Optionally supply `--notes <file>` or commit custom notes at `docs/releases/<version>.md`. Generated notes preserve scopes and PR references and group conventional commits; write migration guidance manually for breaking changes.
2. Run `bun run release <version> --dry-run` to check prerequisites and preview the release. This does not mutate files, refs or dependencies, and does not run validation.
3. Run `bun run release <version>` from clean, up-to-date `main`. It bumps the three package manifests together (not the private root version), refreshes `bun.lock`, runs the full local validation suite, creates a release commit and annotated tag, and pushes `main` and the tag atomically.
4. The tag triggers the shared CI validation. The publishing job sends the exact verified tarballs to npm in core → React → Svelte order, then creates or updates GitHub release notes from the Markdown snapshot saved in the release commit. Prerelease versions publish to npm `next` and are marked as GitHub prereleases; stable versions use `latest`.

See [release instructions](releases/README.md) for examples, prerequisites and recovery. Failed validation restores the release's input edits; a failed push retains the local commit/tag for retry. A failed CI publication can be rerun: existing package versions are skipped, registry errors fail the job, and GitHub notes update idempotently. No token-based fallback is used.
The new scoped package names require access to the `@dotimation` registry scope before the first release. This refactor does not publish packages or change the existing release version. Every package's prepublish hook rebuilds and validates output for manual publication. CI uses `bun run pack:packages` after building, then `DOTIMATION_PACKAGE_DIR=release-packages bun run test:packages` to test those archives. Publishing the verified tarballs skips rebuild hooks. Without `DOTIMATION_PACKAGE_DIR`, consumer tests still pack their own temporary archives.

Bun is pinned in `.bun-version`. CI runs on pull requests and pushes to `main`; tags run only the release workflow. Builds, distribution checks and unit tests run on all three operating systems; lint, types, playgrounds and browser tests run on Linux. Linux GPU tests use `xvfb-run --auto-servernum bun run test:e2e` with Vulkan/SwiftShader compositing enabled: headless Chromium still needs a display for WebGPU canvas presentation. Playwright's `install --with-deps chromium` installs Xvfb. Browser failures retain screenshots and Playwright traces for seven days. Release runs are serialized without cancellation, and release-note failures fail the publishing job so they can be retried.

Release authentication uses npm Trusted Publishing, with npm supplied by the pinned Node version in `release.yml`. Bun still handles installation, builds, tests and packing. Configure each package to trust GitHub owner `TheeKia`, repository `dotimation`, workflow `release.yml`, with no environment and direct publishing allowed. The publishing job has `id-token: write`; no `NPM_TOKEN` secret is consumed. After the first successful OIDC release, revoke the old npm token and remove the unused GitHub secret. Publishing authentication can only be verified during a real release; a dry run does not exchange OIDC credentials.
