import { mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { generateReleaseNotes } from './release-notes'
import {
  packageDirectories,
  releaseChannel,
  validateNotes,
  workspaceVersion,
} from './release-version'

interface ReleaseOptions {
  version: string
  dryRun: boolean
  notes?: string
}

async function command(
  root: string,
  args: string[],
  capture = false,
): Promise<string> {
  const child = Bun.spawn(args, {
    cwd: root,
    stdout: capture ? 'pipe' : 'inherit',
    stderr: 'pipe',
  })
  const [output, error, code] = await Promise.all([
    capture
      ? new Response(child.stdout as ReadableStream).text()
      : Promise.resolve(''),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`${args.join(' ')} failed:\n${error}`)
  if (error && !capture) process.stderr.write(error)
  return output.trim()
}

async function validate(root: string): Promise<void> {
  const commands = [
    ['bun', 'install', '--frozen-lockfile'],
    ['bun', 'run', 'lint'],
    ['bun', 'run', 'build'],
    ['bun', 'run', 'check:dist'],
    ['bun', 'run', 'type-check'],
    ['bun', 'test'],
    ['bun', 'run', '--cwd', 'apps/playground-react', 'build'],
    ['bun', 'run', '--cwd', 'apps/playground-svelte', 'build'],
    ...(process.platform === 'linux'
      ? [['xvfb-run', '--auto-servernum', 'bun', 'run', 'test:e2e']]
      : [['bun', 'run', 'test:e2e']]),
    ['bun', 'run', 'test:packages'],
  ]
  for (const args of commands) await command(root, args)
}

export function parseReleaseArgs(args: string[]): ReleaseOptions {
  let version = ''
  let notes: string | undefined
  let dryRun = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--dry-run') dryRun = true
    else if (arg === '--notes') {
      notes = args[++index]
      if (!notes || notes.startsWith('--'))
        throw new Error('--notes requires a Markdown file')
    } else if (arg.startsWith('-') || version)
      throw new Error(`Unexpected argument: ${arg}`)
    else version = arg
  }
  releaseChannel(version)
  return { version, notes, dryRun }
}

/** The validation callback lets integration tests exercise real Git safely. */
export async function release(
  root: string,
  options: ReleaseOptions,
  runValidation: (root: string) => Promise<void> = validate,
): Promise<void> {
  const { version, dryRun } = options
  const channel = releaseChannel(version)
  const git = (...args: string[]): Promise<string> =>
    command(root, ['git', ...args], true)
  if (await git('rev-parse', '--show-prefix'))
    throw new Error('Run releases from the repository root')
  if ((await git('branch', '--show-current')) !== 'main')
    throw new Error('Release from main only')
  if (await git('status', '--porcelain', '--untracked-files=all'))
    throw new Error('Commit or stash changes before releasing')
  const fetchURL = await git('remote', 'get-url', 'origin')
  const pushURLs = await git('remote', 'get-url', '--push', '--all', 'origin')
  if (pushURLs !== fetchURL)
    throw new Error('origin must have one matching fetch and push URL')
  const initialHead = await git('rev-parse', 'HEAD')
  const remoteMain = async (): Promise<string> => {
    const refs = await git('ls-remote', '--refs', 'origin', 'refs/heads/main')
    const sha = refs.split(/\s/)[0]
    if (!sha) throw new Error('origin/main does not exist')
    return sha
  }
  if ((await remoteMain()) !== initialHead)
    throw new Error(
      'main must match origin/main; pull or push your commits first',
    )
  const tag = `v${version}`
  if (
    (await git('tag', '--list', tag)) ||
    (await git('ls-remote', '--refs', 'origin', `refs/tags/${tag}`))
  )
    throw new Error(`Tag ${tag} already exists`)
  const current = await workspaceVersion(root)
  if (Bun.semver.order(version, current) !== 1)
    throw new Error(`${version} must be newer than ${current}`)
  const notesPath = `docs/releases/${version}.md`
  const sourceNotes = resolve(root, options.notes ?? notesPath)
  const notesFile = Bun.file(sourceNotes)
  const notes = validateNotes(
    options.notes || (await notesFile.exists())
      ? await notesFile.text()
      : await generateReleaseNotes(git, version),
  )
  if (
    sourceNotes !== resolve(root, notesPath) &&
    (await Bun.file(resolve(root, notesPath)).exists())
  )
    throw new Error(
      `${notesPath} already exists; use it or remove it explicitly`,
    )
  console.log(
    `Release ${current} → ${version}: core, React and Svelte → npm ${channel}`,
  )
  console.log(`Notes: ${notesPath}\n\n${notes}\n`)
  const push = [
    'git',
    'push',
    '--atomic',
    'origin',
    'HEAD:refs/heads/main',
    `refs/tags/${tag}`,
  ]
  if (dryRun) {
    console.log(
      'Dry run: would update all three manifests and bun.lock, validate, commit, create an annotated tag, and run:',
    )
    console.log(push.join(' '))
    return
  }
  const paths = [
    ...packageDirectories.map((name) => `packages/${name}/package.json`),
    'bun.lock',
    notesPath,
  ]
  const originals = new Map<string, string | null>()
  for (const path of paths) {
    const file = Bun.file(resolve(root, path))
    originals.set(path, (await file.exists()) ? await file.text() : null)
  }
  let committed = false
  try {
    for (const directory of packageDirectories) {
      const path = `packages/${directory}/package.json`
      const manifest = JSON.parse(originals.get(path)!)
      manifest.version = version
      await Bun.write(
        resolve(root, path),
        `${JSON.stringify(manifest, null, 2)}\n`,
      )
    }
    await mkdir(dirname(resolve(root, notesPath)), { recursive: true })
    await Bun.write(resolve(root, notesPath), `${notes}\n`)
    await command(root, [
      'bun',
      'install',
      '--lockfile-only',
      '--ignore-scripts',
    ])
    await runValidation(root)
    if ((await git('rev-parse', 'HEAD')) !== initialHead)
      throw new Error('HEAD changed during release validation')
    if ((await git('branch', '--show-current')) !== 'main')
      throw new Error('Branch changed during release validation')
    if ((await workspaceVersion(root)) !== version)
      throw new Error('Package versions changed during release validation')
    if ((await remoteMain()) !== initialHead)
      throw new Error(
        'origin/main advanced during validation; pull and try again',
      )
    // A validator or editor must not sneak unrelated changes into the release.
    const changed = (await git('diff', '--name-only'))
      .split('\n')
      .filter(Boolean)
    const untracked = (await git('ls-files', '--others', '--exclude-standard'))
      .split('\n')
      .filter(Boolean)
    const staged = (await git('diff', '--cached', '--name-only'))
      .split('\n')
      .filter(Boolean)
    if (
      [...changed, ...untracked, ...staged].some(
        (path) => !paths.includes(path),
      )
    )
      throw new Error(
        'Unexpected files changed during validation; inspect the working tree',
      )
    await git('add', '--', ...paths)
    await command(root, ['git', 'commit', '-m', `chore(release): ${tag}`])
    committed = true
    await command(root, ['git', 'tag', '-a', tag, '-m', `Release ${tag}`])
    await command(root, push)
    console.log(
      `Pushed ${tag}. GitHub Actions will validate and publish all three packages.`,
    )
  } catch (error) {
    if (!committed && (await git('rev-parse', 'HEAD')) === initialHead) {
      await git('reset', '--quiet', 'HEAD', '--', ...paths)
      for (const [path, content] of originals) {
        if (content === null) await rm(resolve(root, path), { force: true })
        else await Bun.write(resolve(root, path), content)
      }
      console.error(
        'Release preparation failed; restored manifests, lockfile and release notes.',
      )
    } else {
      console.error(
        `Local release commit retained. Inspect git status and tag ${tag}; once resolved, retry:\n${push.join(' ')}`,
      )
    }
    throw error
  }
}

if (import.meta.main) {
  if (process.argv.includes('--help')) {
    console.log(
      'Usage: bun run release <version> [--dry-run] [--notes <file.md>]\nNotes are generated from commits by default and saved to docs/releases/<version>.md. Use --notes to override.\nRequires a clean main matching origin/main. Builds/tests locally, then pushes commit + tag atomically.',
    )
  } else {
    try {
      await release(
        resolve(import.meta.dirname, '..'),
        parseReleaseArgs(process.argv.slice(2)),
      )
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    }
  }
}
