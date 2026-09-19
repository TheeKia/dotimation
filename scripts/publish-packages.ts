import { resolve } from 'node:path'
import { releaseMetadata } from './release-version'

const registry = 'https://registry.npmjs.org'

/** Skip only an existing version; registry failures must stop the release. */
export async function publishIfMissing(
  name: string,
  version: string,
  publish: () => Promise<void>,
  fetchMetadata: (url: string) => Promise<Response> = fetch,
): Promise<void> {
  const response = await fetchMetadata(
    `${registry}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
  )
  if (response.status === 404) {
    await publish()
    return
  }
  if (!response.ok)
    throw new Error(
      `Registry lookup failed for ${name}@${version}: ${response.status}`,
    )
  const metadata = await response.json()
  if (metadata.name !== name || metadata.version !== version)
    throw new Error(`Unexpected registry metadata for ${name}@${version}`)
  console.log(`Already published: ${name}@${version}`)
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, '..')
  const { channel } = await releaseMetadata(root, process.env.GITHUB_REF_NAME)
  const packages = await Promise.all(
    ['core', 'react', 'svelte'].map(async (directory) => {
      const { name, version } = await Bun.file(
        resolve(root, 'packages', directory, 'package.json'),
      ).json()
      const archive = resolve(root, 'release-packages', `${directory}.tgz`)
      if (!(await Bun.file(archive).exists()))
        throw new Error(`Missing verified archive: ${archive}`)
      return { name, version, archive }
    }),
  )
  // Core must exist before either adapter is published.
  for (const { name, version, archive } of packages) {
    await publishIfMissing(name, version, async () => {
      const child = Bun.spawn(
        [
          'npm',
          'publish',
          archive,
          '--access',
          'public',
          '--ignore-scripts',
          '--tag',
          channel,
          '--registry',
          registry,
        ],
        { cwd: root, stdout: 'inherit', stderr: 'inherit' },
      )
      if ((await child.exited) !== 0)
        throw new Error(`Publishing failed for ${name}@${version}`)
    })
  }
}
