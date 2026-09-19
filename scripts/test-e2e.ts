for (const framework of ['react', 'svelte']) {
  console.log(`\nBrowser suite: ${framework}`)
  const child = Bun.spawn(['bun', 'test/e2e/smoke.e2e.ts'], {
    env: { ...process.env, DOTIMATION_E2E_FRAMEWORK: framework },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await child.exited
  if (code !== 0) process.exit(code)
}
