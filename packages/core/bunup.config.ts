import type { BunPlugin } from 'bun'
import type { DefineConfigItem } from 'bunup'

// Bun's modulePreload helper resolves chunks via import.meta.url, which consumer
// bundlers rewrite (Turbopack: file:///ROOT/...). bunup doesn't forward the
// option, so a plugin sets it on Bun's mutable build config.
const noModulePreload: BunPlugin = {
  name: 'no-module-preload',
  setup(build) {
    build.config.modulePreload = false
  },
}

const config: DefineConfigItem = { plugins: [noModulePreload] }

export default config
