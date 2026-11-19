import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const fail = (message: string): never => {
  throw new Error(`check-dist: ${message}`)
}

const coreVersion = (await Bun.file('packages/core/package.json').json())
  .version

for (const name of ['core', 'react', 'svelte']) {
  const root = `packages/${name}`
  const manifest = await Bun.file(`${root}/package.json`).json()
  if (manifest.version !== coreVersion)
    fail(`${name}: package versions must stay synchronized`)
  if (
    name !== 'core' &&
    manifest.dependencies?.['@kiaa/dotimation-core'] !== 'workspace:*'
  )
    fail(`${name}: core must be a workspace dependency`)
  const entry = manifest.exports['.']
  const conditions =
    entry.import && typeof entry.import === 'object' ? entry.import : entry
  for (const path of Object.values(conditions)) {
    if (
      typeof path === 'string' &&
      !(await Bun.file(join(root, path)).exists())
    )
      fail(`${name}: missing export ${path}`)
  }
  const source = await Bun.file(`${root}/dist/index.js`).text()
  if (name === 'core' && source.length < 1000)
    fail('core bundle is gutted (check tree-shaking configuration)')
  if (
    name === 'core' &&
    (source.match(/import\(["']\.\/shared\/[\w-]+\.js["']\)/g) ?? []).length < 2
  )
    fail('core: WebGPU/WebGL2 backends must stay lazily imported chunks')
  if (name !== 'svelte' && !source.includes('// built with love'))
    fail(`${name}: missing browser build footer`)
  if (name === 'react' && !/^['"]use client['"]/.test(source))
    fail('React client boundary was stripped')
  if (
    name === 'svelte' &&
    !(await Bun.file(`${root}/dist/Dotimation.svelte`).exists())
  )
    fail('Svelte component was not packaged')
  const files = (await readdir(`${root}/dist`, { recursive: true })).filter(
    (file) => /\.(js|ts|svelte)$/.test(file),
  )
  for (const file of files) {
    const content = await Bun.file(`${root}/dist/${file}`).text()
    if (/["'](?:node|bun):[a-z/_]+["']/.test(content))
      fail(`${name}/${file}: browser output imports a runtime builtin`)
    if (/["'](?:@\/|\.\.\/.*packages\/|.*workspace:)/.test(content))
      fail(`${name}/${file}: unresolved source/workspace reference`)
    // Consumer bundlers may rewrite import.meta.url (Turbopack emits
    // file:///ROOT/...), so URLs derived from it break in production.
    // Bun's modulePreload helper is the usual source; see bunup.config.ts.
    if (/modulepreload|import\.meta\.url/i.test(content))
      fail(`${name}/${file}: output preloads chunks or uses import.meta.url`)
    if (
      name === 'core' &&
      /(?:from|import\()[\s]*["'](?:react|react-dom|svelte)(?:[/'"])/.test(
        content,
      )
    )
      fail(`${name}/${file}: core depends on a framework`)
  }
  console.log(`check-dist: ${name} ok (${files.length} files)`)
}
