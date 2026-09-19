import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { withBrowserDiagnostics } from './browser-diagnostics'

const root = resolve(import.meta.dirname, '..')
const temporary = await mkdtemp(join(tmpdir(), 'dotimation-consumers-'))

async function run(command: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(command, {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if ((await child.exited) !== 0)
    throw new Error(`Consumer check failed: ${command.join(' ')}`)
}

const installedVersion = async (name: string): Promise<string> =>
  (await Bun.file(join(root, 'node_modules', name, 'package.json')).json())
    .version

try {
  const archives = new Map<string, string>()
  for (const name of ['core', 'react', 'svelte']) {
    const packageDirectory = process.env.DOTIMATION_PACKAGE_DIR
    const archive = join(
      packageDirectory ? resolve(root, packageDirectory) : temporary,
      `${name}.tgz`,
    )
    if (packageDirectory) {
      if (!(await Bun.file(archive).exists()))
        throw new Error(`Missing package archive: ${archive}`)
    } else
      await run(
        [
          'bun',
          'pm',
          'pack',
          '--filename',
          archive,
          '--ignore-scripts',
          '--quiet',
        ],
        join(root, 'packages', name),
      )
    archives.set(name, archive)
  }
  for (const framework of ['react', 'svelte']) {
    const cwd = join(temporary, framework)
    await cp(join(root, 'test/fixtures/consumers', framework), cwd, {
      recursive: true,
    })
    const dependencies: Record<string, string> = {
      '@kiaa/dotimation-core': `file:${archives.get('core')}`,
      [framework === 'react'
        ? '@kiaa/dotimation-react'
        : '@kiaa/dotimation-svelte']: `file:${archives.get(framework)}`,
    }
    const tooling =
      framework === 'react'
        ? ['react', 'react-dom', '@types/react', '@types/react-dom']
        : ['svelte', 'svelte-check', '@sveltejs/vite-plugin-svelte']
    for (const name of ['typescript', 'vite', '@types/node', ...tooling])
      dependencies[name] = await installedVersion(name)
    await Bun.write(
      join(cwd, 'package.json'),
      JSON.stringify(
        {
          name: `consumer-${framework}`,
          private: true,
          type: 'module',
          dependencies,
          // Resolve the unpublished core dependency to its real tarball.
          overrides: {
            '@kiaa/dotimation-core': dependencies['@kiaa/dotimation-core'],
          },
        },
        null,
        2,
      ),
    )
    await run(['bun', 'install', '--ignore-scripts'], cwd)
    const adapterName =
      framework === 'react'
        ? '@kiaa/dotimation-react'
        : '@kiaa/dotimation-svelte'
    const adapterManifest = await Bun.file(
      join(cwd, 'node_modules', adapterName, 'package.json'),
    ).json()
    const coreManifest = await Bun.file(
      join(cwd, 'node_modules/@kiaa/dotimation-core/package.json'),
    ).json()
    if (
      adapterManifest.dependencies['@kiaa/dotimation-core'] !==
      coreManifest.version
    )
      throw new Error(
        'Packed core dependency does not match the release version',
      )
    if (
      framework === 'svelte' &&
      (await Bun.file(join(cwd, 'node_modules/react/package.json')).exists())
    )
      throw new Error('Svelte consumer unexpectedly installed React')
    await run(
      framework === 'react'
        ? ['bun', 'x', 'tsc', '--noEmit']
        : [
            'bun',
            'x',
            'svelte-check',
            '--tsconfig',
            'tsconfig.json',
            '--fail-on-warnings',
          ],
      cwd,
    )
    await run(['bun', 'x', '--bun', 'vite', 'build'], cwd)
    await run(
      [
        'bun',
        'x',
        '--bun',
        'vite',
        'build',
        '--ssr',
        framework === 'react' ? 'ssr.tsx' : 'ssr.ts',
        '--outDir',
        'server',
      ],
      cwd,
    )
    // Execute in a fresh process without browser globals, against only packed
    // dependencies. Vite's SSR output may leave normal package imports external.
    const ssr = join(cwd, 'verify-ssr.ts')
    await Bun.write(
      ssr,
      `import { html } from './server/ssr.js'\nif (!html.includes('<canvas') || !html.includes('Packaged') || !html.includes('320px') || !html.includes('120px')) throw new Error('Invalid SSR canvas: ' + html)\nawait Bun.write('./ssr.html', html)\nconsole.log('SSR output verified')\n`,
    )
    await run(['bun', ssr], cwd)
    const clientHtml = await Bun.file(join(cwd, 'dist/index.html')).text()
    if (!clientHtml.includes('<div id="app"></div>'))
      throw new Error('Consumer root missing from built HTML')
    const serverHtml = await Bun.file(join(cwd, 'ssr.html')).text()
    await Bun.write(
      join(cwd, 'dist/hydrated.html'),
      clientHtml.replace(
        '<div id="app"></div>',
        `<div id="app">${serverHtml}</div><script>window.ssrCanvas = document.querySelector('canvas')</script>`,
      ),
    )

    const port = framework === 'react' ? 5283 : 5284
    const server = Bun.spawn(
      [
        'bun',
        'x',
        '--bun',
        'vite',
        'preview',
        '--port',
        String(port),
        '--strictPort',
      ],
      { cwd, stdout: 'ignore', stderr: 'inherit' },
    )
    try {
      const url = `http://localhost:${port}`
      let ready = false
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          if ((await fetch(url)).ok) {
            ready = true
            break
          }
        } catch {
          /* startup */
        }
        await Bun.sleep(100)
      }
      if (!ready) throw new Error(`${framework} consumer preview did not start`)
      const browser = await chromium.launch({ args: ['--no-sandbox'] })
      try {
        const context = await browser.newContext()
        await withBrowserDiagnostics(
          context,
          `consumer-${framework}`,
          async () => {
            const page = await context.newPage()
            const errors: string[] = []
            page.on('pageerror', (error) => errors.push(error.message))
            page.on('console', (message) => {
              if (message.type() === 'error' || message.type() === 'warning')
                errors.push(message.text())
            })
            for (const route of ['/', '/hydrated.html']) {
              await page.goto(url + route)
              const painted = (): Promise<void> =>
                page
                  .waitForFunction(() => {
                    const canvas = document.querySelector('canvas')
                    if (canvas?.width !== 320 || canvas.height !== 120)
                      return false
                    const probe = document.createElement('canvas')
                    probe.width = 320
                    probe.height = 120
                    const context = probe.getContext('2d', {
                      willReadFrequently: true,
                    })!
                    context.drawImage(canvas, 0, 0)
                    return context
                      .getImageData(0, 0, 320, 120)
                      .data.some((value, index) => index % 4 === 3 && value > 0)
                  })
                  .then(() => {})
              await painted()
              if (
                route === '/hydrated.html' &&
                !(await page.evaluate(
                  'window.ssrCanvas === document.querySelector("canvas")',
                ))
              )
                throw new Error('Hydration replaced the server canvas')
              await page.evaluate("window.consumer.render('Updated package')")
              await page.waitForFunction(
                () =>
                  document
                    .querySelector('canvas')
                    ?.getAttribute('aria-label') === 'Updated package',
              )
              await painted()
              await page.evaluate('window.consumer.unmount()')
              await page.waitForFunction(
                () => !document.querySelector('canvas'),
              )
              if (errors.length) throw new Error(errors.join('\n'))
            }
            console.log(
              `${framework}: packed types, production bundle, SSR, hydration and browser rendering passed`,
            )
          },
        )
      } finally {
        await browser.close()
      }
    } finally {
      server.kill()
      await server.exited
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}
