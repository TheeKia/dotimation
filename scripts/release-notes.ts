import { releaseChannel } from './release-version'

type Git = (...args: string[]) => Promise<string>

function isReleaseTag(tag: string): boolean {
  if (!tag.startsWith('v')) return false
  try {
    releaseChannel(tag.slice(1))
    return true
  } catch {
    return false
  }
}

/** Stable notes include the entire prerelease cycle; previews are incremental. */
export function notesBase(tags: string[], version: string): string | undefined {
  const stable = releaseChannel(version) === 'latest'
  return tags
    .filter(
      (tag) =>
        isReleaseTag(tag) &&
        Bun.semver.order(tag.slice(1), version) === -1 &&
        (!stable || releaseChannel(tag.slice(1)) === 'latest'),
    )
    .sort((a, b) => Bun.semver.order(b.slice(1), a.slice(1)))[0]
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]<>])/g, '\\$1')
}

export async function generateReleaseNotes(
  git: Git,
  version: string,
): Promise<string> {
  if ((await git('rev-parse', '--is-shallow-repository')) === 'true')
    throw new Error(
      'Automatic notes require full history. Run git fetch --unshallow --tags first, or pass --notes.',
    )
  const localTags = (await git('tag', '--list', 'v*'))
    .split('\n')
    .filter(Boolean)
  const remoteTags = (await git('ls-remote', '--tags', '--refs', 'origin'))
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('refs/tags/')[1]!)
  if (remoteTags.some((tag) => isReleaseTag(tag) && !localTags.includes(tag)))
    throw new Error(
      'Local release tags are incomplete. Run git fetch origin --tags first, or pass --notes.',
    )
  const reachable = (await git('tag', '--merged', 'HEAD', '--list', 'v*'))
    .split('\n')
    .filter(Boolean)
  const base = notesBase(reachable, version)
  // NUL separators keep commit subjects/bodies unambiguous. Exclude merge
  // wrappers but retain their individual commits and squash PR titles (#123).
  const history = await git(
    'log',
    '--no-merges',
    '--reverse',
    '--format=%H%x00%s%x00%b%x00',
    base ? `${base}..HEAD` : 'HEAD',
    '--',
  )
  const fields = history.split('\0')
  const groups = new Map<string, string[]>()
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const sha = fields[index]!.trim()
    const subject = fields[index + 1]!.trim()
    const body = fields[index + 2]!
    if (/^(?:chore\(release\):|release:)/i.test(subject)) continue
    const conventional = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject)
    const breaking = /^BREAKING[ -]CHANGE:\s*(.+)$/m.exec(body)
    const kind = conventional?.[1]
    const heading =
      conventional?.[3] || breaking
        ? 'Breaking changes'
        : kind === 'feat'
          ? 'Features'
          : kind === 'fix'
            ? 'Fixes'
            : kind === 'perf'
              ? 'Performance'
              : kind === 'docs'
                ? 'Documentation'
                : kind &&
                    [
                      'chore',
                      'ci',
                      'build',
                      'test',
                      'refactor',
                      'style',
                    ].includes(kind)
                  ? 'Maintenance'
                  : 'Other changes'
    const scope = conventional?.[2] ? `${conventional[2]}: ` : ''
    const summary = `${scope}${conventional?.[4] ?? subject}`
    const entries = groups.get(heading) ?? []
    entries.push(
      `- ${escapeMarkdown(summary)} (${sha.slice(0, 7)})${breaking ? `\n  - ${escapeMarkdown(breaking[1]!)}` : ''}`,
    )
    groups.set(heading, entries)
  }
  const sections = [
    'Breaking changes',
    'Features',
    'Fixes',
    'Performance',
    'Documentation',
    'Maintenance',
    'Other changes',
  ]
    .filter((heading) => groups.has(heading))
    .map((heading) => `## ${heading}\n\n${groups.get(heading)!.join('\n')}`)
  if (!sections.length)
    sections.push(
      '## Changes\n\nNo additional changes since the previous release.',
    )
  const range = base ? `Changes since ${base}.` : 'Initial release history.'
  return `${range}\n\n${sections.join('\n\n')}`
}
