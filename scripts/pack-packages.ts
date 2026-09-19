import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const destination = resolve(root, 'release-packages')
await mkdir(destination, { recursive: true })

for (const name of ['core', 'react', 'svelte']) {
  const child = Bun.spawn(
    [
      'bun',
      'pm',
      'pack',
      '--filename',
      resolve(destination, `${name}.tgz`),
      '--ignore-scripts',
    ],
    {
      cwd: resolve(root, 'packages', name),
      stdout: 'inherit',
      stderr: 'inherit',
    },
  )
  if ((await child.exited) !== 0) throw new Error(`Failed to pack ${name}`)
}
