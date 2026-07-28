// Sanity-checks dist/ before publish (runs via prepublishOnly, after `build`).
// Guards against shipping a dist built with the wrong flags: v0.7.0 was
// published from a bare-`bunup` run (default target: node), whose shared chunk
// imported `node:module` and broke every browser bundler that consumed it.

import { readdir } from 'node:fs/promises'

const fail = (msg: string): never => {
  console.error(`check-dist: ${msg}`)
  process.exit(1)
}

const index = Bun.file('dist/index.js')
if (!(await index.exists()))
  fail('dist/index.js is missing — run `bun run build`')

// The sideEffects/tree-shaking footgun (see CLAUDE.md) emits a ~44-byte shell.
const indexSource = await index.text()
if (indexSource.length < 1000)
  fail(`dist/index.js is ${indexSource.length} bytes — bundle is gutted`)

// The footer only appears when the build script's bunup flags were applied.
if (!indexSource.includes('// built with love')) {
  fail(
    'dist/index.js lacks the build footer — dist was not built by `bun run build`',
  )
}

const files = (await readdir('dist', { recursive: true })).filter((f) =>
  f.endsWith('.js'),
)
for (const f of files) {
  const source = await Bun.file(`dist/${f}`).text()
  const builtin = source.match(/["'](node|bun):[a-z/_]+["']/)
  if (builtin)
    fail(`dist/${f} references ${builtin[0]} — built for the wrong target`)
}

console.log(
  `check-dist: ok (${files.length} JS files, index.js ${indexSource.length} bytes)`,
)
