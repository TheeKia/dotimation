const { version } = await Bun.file('packages/core/package.json').json()
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME
if (tag !== `v${version}`) {
  throw new Error(
    `Release tag ${tag ?? '(missing)'} must match package version v${version}`,
  )
}
console.log(`Release tag verified: ${tag}`)
