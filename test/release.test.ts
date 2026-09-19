import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publishReleaseNotes } from '../scripts/github-release'
import { parseReleaseArgs, release } from '../scripts/release'
import { generateReleaseNotes, notesBase } from '../scripts/release-notes'
import { releaseChannel, releaseMetadata } from '../scripts/release-version'

const temporary: string[] = []
afterEach(async () => {
  for (const path of temporary.splice(0))
    await rm(path, { recursive: true, force: true })
})

async function run(root: string, args: string[]): Promise<string> {
  const child = Bun.spawn(args, { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`${args.join(' ')}: ${stderr}`)
  return stdout.trim()
}

async function fixture(): Promise<{
  root: string
  remote: string
  notes: string
}> {
  const directory = await mkdtemp(join(tmpdir(), 'dotimation-release-test-'))
  temporary.push(directory)
  const root = join(directory, 'work')
  const remote = join(directory, 'remote.git')
  const notes = join(directory, 'notes.md')
  await mkdir(root)
  await run(directory, ['git', 'init', '--bare', remote])
  await run(root, ['git', 'init', '-b', 'main'])
  await run(root, ['git', 'config', 'user.name', 'Release Test'])
  await run(root, ['git', 'config', 'user.email', 'release@example.test'])
  await run(root, ['git', 'config', 'commit.gpgSign', 'false'])
  await run(root, ['git', 'config', 'tag.gpgSign', 'false'])
  await Bun.write(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      private: true,
      version: '0.1.0',
      workspaces: ['packages/*'],
    }),
  )
  for (const name of ['core', 'react', 'svelte']) {
    await Bun.write(
      join(root, 'packages', name, 'package.json'),
      `${JSON.stringify({ name: `fixture-${name}`, version: '0.1.0' }, null, 2)}\n`,
    )
  }
  await Bun.write(join(root, '.gitignore'), 'node_modules\n')
  await Bun.write(
    notes,
    '## React and Svelte\n\nFix canvas resizing in both adapters.\n',
  )
  await run(root, ['bun', 'install', '--lockfile-only', '--ignore-scripts'])
  await run(root, ['git', 'add', '.'])
  await run(root, ['git', 'commit', '-m', 'initial'])
  await run(root, ['git', 'remote', 'add', 'origin', remote])
  await run(root, ['git', 'push', '-u', 'origin', 'main'])
  return { root, remote, notes }
}

for (const version of ['1.2.3', '0.0.1'])
  test(`stable channel: ${version}`, () =>
    expect(releaseChannel(version)).toBe('latest'))
for (const version of ['1.2.3-beta.1', '1.2.3-rc.2', '1.2.3-alpha-build.0'])
  test(`prerelease channel: ${version}`, () =>
    expect(releaseChannel(version)).toBe('next'))
for (const version of [
  'v1.2.3',
  '01.2.3',
  '1.2',
  '1.2.3+build',
  '1.2.3-beta.01',
  '1.2.3-',
  '1.2.3\n',
  '--help',
])
  test(`reject invalid version: ${version}`, () =>
    expect(() => releaseChannel(version)).toThrow())

test('CLI parses preview and notes without allowing extra arguments', () => {
  expect(
    parseReleaseArgs(['0.2.0', '--dry-run', '--notes', '/tmp/notes.md']),
  ).toEqual({ version: '0.2.0', dryRun: true, notes: '/tmp/notes.md' })
  expect(() => parseReleaseArgs(['0.2.0', '--notes'])).toThrow()
  expect(() => parseReleaseArgs(['0.2.0', '--skip-tests'])).toThrow()
})

test('dry run leaves files, refs and remote unchanged and never validates', async () => {
  const { root, remote, notes } = await fixture()
  const head = await run(root, ['git', 'rev-parse', 'HEAD'])
  await release(root, { version: '0.2.0', dryRun: true, notes }, async () => {
    throw new Error('Must not validate')
  })
  expect(await run(root, ['git', 'rev-parse', 'HEAD'])).toBe(head)
  expect(await run(remote, ['git', 'rev-parse', 'main'])).toBe(head)
  expect(await run(root, ['git', 'status', '--porcelain'])).toBe('')
  expect(await run(root, ['git', 'tag', '--list'])).toBe('')
})

test('release bumps only published versions and atomically pushes annotated tag', async () => {
  const { root, remote, notes } = await fixture()
  let validated = false
  await release(
    root,
    { version: '0.2.0-beta.1', dryRun: false, notes },
    async () => {
      validated = true
      for (const name of ['core', 'react', 'svelte'])
        expect(
          (await Bun.file(join(root, 'packages', name, 'package.json')).json())
            .version,
        ).toBe('0.2.0-beta.1')
    },
  )
  expect(validated).toBe(true)
  expect((await Bun.file(join(root, 'package.json')).json()).version).toBe(
    '0.1.0',
  )
  expect(await run(remote, ['git', 'cat-file', '-t', 'v0.2.0-beta.1'])).toBe(
    'tag',
  )
  expect(await run(remote, ['git', 'rev-parse', 'v0.2.0-beta.1^{}'])).toBe(
    await run(root, ['git', 'rev-parse', 'HEAD']),
  )
  expect(await run(root, ['git', 'status', '--porcelain'])).toBe('')
  expect((await releaseMetadata(root, 'v0.2.0-beta.1')).channel).toBe('next')
})

test('validation failure restores all release files and creates no commit or tag', async () => {
  const { root, notes } = await fixture()
  const head = await run(root, ['git', 'rev-parse', 'HEAD'])
  await expect(
    release(root, { version: '0.2.0', dryRun: false, notes }, async () => {
      throw new Error('Test failure')
    }),
  ).rejects.toThrow('Test failure')
  expect(await run(root, ['git', 'status', '--porcelain'])).toBe('')
  expect(await run(root, ['git', 'rev-parse', 'HEAD'])).toBe(head)
  expect(await run(root, ['git', 'tag', '--list'])).toBe('')
})

test('reject dirty tree, stale main, existing tag, downgrade and mismatched packages', async () => {
  const { root, notes } = await fixture()
  const options = { version: '0.2.0', dryRun: true, notes }
  await Bun.write(join(root, 'extra.txt'), 'dirty')
  await expect(release(root, options)).rejects.toThrow('Commit or stash')
  await rm(join(root, 'extra.txt'))
  await run(root, ['git', 'tag', 'v0.2.0'])
  await expect(release(root, options)).rejects.toThrow('already exists')
  await run(root, ['git', 'tag', '-d', 'v0.2.0'])
  await expect(release(root, { ...options, version: '0.0.9' })).rejects.toThrow(
    'must be newer',
  )
  await run(root, ['git', 'commit', '--allow-empty', '-m', 'ahead'])
  await expect(release(root, options)).rejects.toThrow('must match origin/main')
  await run(root, ['git', 'push', 'origin', 'main'])
  await Bun.write(
    join(root, 'packages/svelte/package.json'),
    JSON.stringify({ name: 'fixture-svelte', version: '0.3.0' }),
  )
  await run(root, ['git', 'add', '.'])
  await run(root, ['git', 'commit', '-m', 'mismatch'])
  await run(root, ['git', 'push', 'origin', 'main'])
  await expect(release(root, options)).rejects.toThrow('versions must match')
})

test('server rejection pushes neither main nor tag and preserves local retry state', async () => {
  const { root, remote, notes } = await fixture()
  const original = await run(remote, ['git', 'rev-parse', 'main'])
  // A server-side ref lock rejects only the tag. --atomic must also reject main.
  await Bun.write(join(remote, 'refs/tags/v0.2.0.lock'), '')
  await expect(
    release(root, { version: '0.2.0', dryRun: false, notes }, async () => {}),
  ).rejects.toThrow('failed')
  expect(await run(remote, ['git', 'rev-parse', 'main'])).toBe(original)
  expect(await run(remote, ['git', 'tag', '--list'])).toBe('')
  expect(await run(root, ['git', 'tag', '--list'])).toBe('v0.2.0')
  expect(await run(root, ['git', 'rev-parse', 'HEAD'])).not.toBe(original)
  await rm(join(remote, 'refs/tags/v0.2.0.lock'))
  await run(root, [
    'git',
    'push',
    '--atomic',
    'origin',
    'HEAD:refs/heads/main',
    'refs/tags/v0.2.0',
  ])
  expect(await run(remote, ['git', 'rev-parse', 'main'])).toBe(
    await run(root, ['git', 'rev-parse', 'HEAD']),
  )
})

for (const channel of ['latest', 'next'] as const)
  test(`GitHub release retry preserves ${channel} classification and reviewed notes`, async () => {
    const calls: { url: string; method?: string; body?: unknown }[] = []
    const request = async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      return Response.json(calls.length === 1 ? { id: 42 } : {})
    }
    await publishReleaseNotes(
      'owner/repo',
      'test-token',
      { version: '1.0.0', tag: 'v1.0.0', channel, notes: 'Reviewed notes' },
      request,
    )
    expect(calls[1]?.method).toBe('PATCH')
    expect(calls[1]?.url).toEndWith('/42')
    expect(calls[1]?.body).toMatchObject({
      body: 'Reviewed notes',
      prerelease: channel === 'next',
      make_latest: channel === 'latest' ? 'legacy' : 'false',
    })
  })

test('a staged unrelated edit cannot enter the release commit', async () => {
  const { root, notes } = await fixture()
  const head = await run(root, ['git', 'rev-parse', 'HEAD'])
  await expect(
    release(root, { version: '0.2.0', dryRun: false, notes }, async () => {
      await Bun.write(join(root, 'unexpected.txt'), 'keep this edit')
      await run(root, ['git', 'add', 'unexpected.txt'])
    }),
  ).rejects.toThrow('Unexpected files changed')
  expect(await run(root, ['git', 'rev-parse', 'HEAD'])).toBe(head)
  expect(await Bun.file(join(root, 'unexpected.txt')).text()).toBe(
    'keep this edit',
  )
  expect(await run(root, ['git', 'diff', '--cached', '--name-only'])).toBe(
    'unexpected.txt',
  )
})

test('CI refuses a tag mismatch and empty release notes', async () => {
  const { root } = await fixture()
  await expect(releaseMetadata(root, 'v0.2.0')).rejects.toThrow('must match')
  await Bun.write(
    join(root, 'docs/releases/0.1.0.md'),
    '## React\n<!-- TODO -->\n',
  )
  await expect(releaseMetadata(root, 'v0.1.0')).rejects.toThrow(
    'user-facing changes',
  )
})

test('GitHub creates a missing release and fails on lookup errors', async () => {
  const release = {
    version: '1.0.0',
    tag: 'v1.0.0',
    channel: 'latest' as const,
    notes: 'Reviewed notes',
  }
  const methods: (string | undefined)[] = []
  const request = async (_url: string, init?: RequestInit) => {
    methods.push(init?.method)
    return methods.length === 1
      ? new Response(null, { status: 404 })
      : Response.json({ id: 42 })
  }
  await publishReleaseNotes('owner/repo', 'token', release, request)
  expect(methods).toEqual([undefined, 'POST'])
  let calls = 0
  await expect(
    publishReleaseNotes('owner/repo', 'token', release, async () => {
      calls++
      return new Response(null, { status: 403 })
    }),
  ).rejects.toThrow('lookup failed')
  expect(calls).toBe(1)
})

test('automatic notes exclude old/release commits and preserve scopes and PR references', async () => {
  const { root } = await fixture()
  const git = (...args: string[]) => run(root, ['git', ...args])
  await git('tag', 'v0.1.0')
  await git(
    'commit',
    '--allow-empty',
    '-m',
    'feat(react): add transitions (#12)',
  )
  await git('commit', '--allow-empty', '-m', 'fix(svelte): update bindings')
  await git('commit', '--allow-empty', '-m', 'chore(release): v0.2.0-beta.1')
  await git(
    'commit',
    '--allow-empty',
    '-m',
    'feat(core)!: change defaults',
    '-m',
    'BREAKING CHANGE: Set motion explicitly to preserve old behavior.',
  )
  const notes = await generateReleaseNotes(git, '0.2.0')
  expect(notes).toContain('Changes since v0.1.0')
  expect(notes).toContain('## Features')
  expect(notes).toContain('react: add transitions (#12)')
  expect(notes).toContain('## Fixes')
  expect(notes).toContain('svelte: update bindings')
  expect(notes).toContain('## Breaking changes')
  expect(notes).toContain('Set motion explicitly')
  expect(notes).not.toContain('chore(release)')
  expect(notes).not.toContain('- initial')
})

test('stable notes cover prereleases while prerelease notes are incremental', () => {
  const tags = [
    'v0.1.0',
    'v0.2.0-beta.1',
    'v0.2.0-beta.2',
    'v0.3.0',
    'other',
    'vgarbage',
  ]
  expect(notesBase(tags, '0.2.0')).toBe('v0.1.0')
  expect(notesBase(tags, '0.2.0-beta.3')).toBe('v0.2.0-beta.2')
  expect(notesBase([], '0.1.0')).toBeUndefined()
})

test('release generates a notes snapshot with no handwritten file; dry run creates nothing', async () => {
  const { root } = await fixture()
  const path = join(root, 'docs/releases/0.2.0.md')
  await release(root, { version: '0.2.0', dryRun: true })
  expect(await Bun.file(path).exists()).toBe(false)
  expect(await run(root, ['git', 'status', '--porcelain'])).toBe('')
  await release(root, { version: '0.2.0', dryRun: false }, async () => {})
  expect(await Bun.file(path).text()).toContain('Initial release history.')
  expect((await releaseMetadata(root, 'v0.2.0')).notes).toContain('- initial')
})

test('missing remote tags fail with actionable instructions rather than incomplete notes', async () => {
  const { root } = await fixture()
  const git = (...args: string[]) => run(root, ['git', ...args])
  await git('tag', 'v0.1.0')
  await git('push', 'origin', 'v0.1.0')
  await git('tag', '-d', 'v0.1.0')
  await expect(generateReleaseNotes(git, '0.2.0')).rejects.toThrow(
    'git fetch origin --tags',
  )
})
