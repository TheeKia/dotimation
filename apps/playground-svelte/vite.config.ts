import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      '@dotimation/core': fileURLToPath(
        new URL('../../packages/core/src/index.ts', import.meta.url),
      ),
      '@dotimation/svelte': fileURLToPath(
        new URL('../../packages/svelte/src/lib/index.ts', import.meta.url),
      ),
    },
  },
})
