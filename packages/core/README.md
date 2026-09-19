# @kiaa/dotimation-core

Framework-independent animation engine and browser runtime for [dotimation](https://github.com/TheeKia/dotimation).

React users install `@kiaa/dotimation-react`; Svelte users install `@kiaa/dotimation-svelte`. Both adapters share this package automatically. It includes Canvas2D, WebGL2 and WebGPU backends plus an inlined rasterization worker.

## Adapter integration

`createDotimationController({ replaceCanvas })` creates an SSR-safe controller without acquiring browser resources. Call `update(options)` with a complete `DotimationOptions` snapshot after committing props, then `connect(canvas)` after mounting the element. The returned cleanup ends only that canvas session and must run on unmount.

When `replaceCanvas` fires, render a fresh element and connect it. A canvas cannot switch context types after a failed backend initialization. The host owns DOM markup, CSS dimensions, accessibility and native element references; the controller owns resources, option comparisons, rasterization and simulation.

Imports, option types and controller construction are safe on the server. Connection is browser-only. See the [architecture guide](https://github.com/TheeKia/dotimation/blob/main/docs/architecture.md) for lifecycle details and invariants.

MIT
