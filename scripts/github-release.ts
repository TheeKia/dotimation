import { resolve } from 'node:path'
import { releaseMetadata } from './release-version'

export async function publishReleaseNotes(
  repository: string,
  token: string,
  release: Awaited<ReturnType<typeof releaseMetadata>>,
  request: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<void> {
  const base = `https://api.github.com/repos/${repository}/releases`
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const existing = await request(`${base}/tags/${release.tag}`, { headers })
  if (!existing.ok && existing.status !== 404)
    throw new Error(`GitHub release lookup failed: ${existing.status}`)
  const id = existing.ok ? (await existing.json()).id : null
  const result = await request(id ? `${base}/${id}` : base, {
    method: id ? 'PATCH' : 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: release.tag,
      name: release.tag,
      body: release.notes,
      draft: false,
      prerelease: release.channel === 'next',
      // Let GitHub compare release versions, so retrying old notes cannot
      // replace a newer stable release as the repository's latest release.
      make_latest: release.channel === 'latest' ? 'legacy' : 'false',
    }),
  })
  if (!result.ok)
    throw new Error(`GitHub release update failed: ${result.status}`)
  console.log(`GitHub release notes published: ${release.tag}`)
}

if (import.meta.main) {
  const repository = process.env.GITHUB_REPOSITORY
  const token = process.env.GITHUB_TOKEN
  if (!repository || !token)
    throw new Error('GitHub repository and token are required')
  await publishReleaseNotes(
    repository,
    token,
    await releaseMetadata(
      resolve(import.meta.dirname, '..'),
      process.env.GITHUB_REF_NAME,
    ),
  )
}
