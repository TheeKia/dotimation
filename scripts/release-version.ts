import { resolve } from 'node:path'

export const packageDirectories = ['core', 'react', 'svelte'] as const

export function releaseChannel(version: string): 'latest' | 'next' {
  // Build metadata is deliberately unsupported: npm cannot publish it as a
  // distinct version. Numeric components must use canonical SemVer spelling.
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.test(
      version,
    )
  )
    throw new Error(
      `Invalid release version: ${version}. Use 1.2.3 or 1.2.3-beta.1 (no v prefix or build metadata).`,
    )
  const prerelease = version.split('-').slice(1).join('-')
  if (
    prerelease
      .split('.')
      .some(
        (part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'),
      )
  )
    throw new Error(`Invalid numeric prerelease identifier: ${version}`)
  return prerelease ? 'next' : 'latest'
}

export async function workspaceVersion(root: string): Promise<string> {
  const versions = await Promise.all(
    packageDirectories.map(
      async (directory) =>
        (
          await Bun.file(
            resolve(root, 'packages', directory, 'package.json'),
          ).json()
        ).version as string,
    ),
  )
  if (versions.some((version) => version !== versions[0]))
    throw new Error('Core, React and Svelte package versions must match')
  const version = versions[0]!
  releaseChannel(version)
  return version
}

export function validateNotes(notes: string): string {
  const content = notes.replace(/<!--[\s\S]*?-->/g, '').trim()
  if (!content.replace(/^#+.*$/gm, '').trim())
    throw new Error(
      'Release notes must describe user-facing changes, not just headings or comments',
    )
  return content
}

export async function releaseMetadata(
  root: string,
  tag: string | undefined,
): Promise<{
  version: string
  tag: string
  channel: 'latest' | 'next'
  notes: string
}> {
  const version = await workspaceVersion(root)
  if (tag !== `v${version}`)
    throw new Error(
      `Release tag ${tag ?? '(missing)'} must match package version v${version}`,
    )
  const notes = validateNotes(
    await Bun.file(resolve(root, 'docs/releases', `${version}.md`)).text(),
  )
  return { version, tag, channel: releaseChannel(version), notes }
}
