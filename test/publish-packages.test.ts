import { expect, test } from 'bun:test'
import { publishIfMissing } from '../scripts/publish-packages'

test('a partial release skips an existing version', async () => {
  let published = false
  await publishIfMissing(
    '@kiaa/dotimation-core',
    '1.0.0',
    async () => {
      published = true
    },
    async (url) => {
      expect(url).toBe(
        'https://registry.npmjs.org/%40kiaa%2Fdotimation-core/1.0.0',
      )
      return Response.json({ name: '@kiaa/dotimation-core', version: '1.0.0' })
    },
  )
  expect(published).toBe(false)
})

test('an absent version is published', async () => {
  let published = false
  await publishIfMissing(
    '@kiaa/dotimation-react',
    '1.0.0',
    async () => {
      published = true
    },
    async () => new Response(null, { status: 404 }),
  )
  expect(published).toBe(true)
})

test('registry errors never trigger publishing', async () => {
  for (const status of [401, 403, 429, 500]) {
    let published = false
    await expect(
      publishIfMissing(
        '@kiaa/dotimation-react',
        '1.0.0',
        async () => {
          published = true
        },
        async () => new Response(null, { status }),
      ),
    ).rejects.toThrow('Registry lookup failed')
    expect(published).toBe(false)
  }
})

test('mismatched metadata cannot silently skip publishing', async () => {
  await expect(
    publishIfMissing(
      '@kiaa/dotimation-react',
      '1.0.0',
      async () => {
        throw new Error('Must not publish')
      },
      async () =>
        Response.json({ name: '@kiaa/dotimation-react', version: '0.9.0' }),
    ),
  ).rejects.toThrow('Unexpected registry metadata')
})

test('publish failures propagate so later packages are not attempted', async () => {
  await expect(
    publishIfMissing(
      '@kiaa/dotimation-react',
      '1.0.0',
      async () => {
        throw new Error('OIDC authentication failed')
      },
      async () => new Response(null, { status: 404 }),
    ),
  ).rejects.toThrow('OIDC authentication failed')
})
