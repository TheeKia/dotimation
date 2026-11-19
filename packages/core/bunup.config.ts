import type { BunPlugin } from 'bun'
import type { DefineConfigItem } from 'bunup'

// Bun >= 1.4 enables `modulePreload` for split browser builds. It injects a
// helper that appends <link rel="modulepreload"> using
// `new URL(chunk, import.meta.url)`. Consumer bundlers may rewrite
// `import.meta.url` (Next.js Turbopack emits file:///ROOT/...), which makes the
// browser request local files. The consumer's bundler owns chunk loading, so
// the library must not preload its own chunks. bunup does not forward this
// Bun.build option, so a plugin sets it before the build runs.
// `scripts/check-dist.ts` guards the output.
const noModulePreload: BunPlugin = {
  name: 'no-module-preload',
  setup(build) {
    ;(build.config as { modulePreload?: boolean }).modulePreload = false
  },
}

// Remaining options come from the package's build script flags.
const config: DefineConfigItem = { plugins: [noModulePreload] }

export default config
