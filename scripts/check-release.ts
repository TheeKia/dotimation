import { resolve } from 'node:path'
import { releaseMetadata } from './release-version'

const { tag, channel } = await releaseMetadata(
  resolve(import.meta.dirname, '..'),
  process.argv[2] ?? process.env.GITHUB_REF_NAME,
)
console.log(`Release verified: ${tag} → npm ${channel}`)
