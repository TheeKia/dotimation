/**
 * End-to-end smoke test: boots the Vite playground, drives headless Chromium,
 * and verifies the DOM/GPU shells that unit tests cannot reach — backend
 * cascade, canvas sizing/a11y, actual pixel output, the reduced-motion path,
 * and the derived loop policy (jitter > 0 keeps animating indefinitely;
 * jitter === 0 sleeps after settling; a live jitter change never remounts the
 * canvas). Run with `bun run test:e2e` (named .e2e.ts so `bun test` skips it).
 * Requires a Playwright browser: `bunx playwright install chromium`.
 */
import type { Page } from 'playwright'
import { chromium } from 'playwright'
import { withBrowserDiagnostics } from '../../scripts/browser-diagnostics'

const framework = process.env.DOTIMATION_E2E_FRAMEWORK ?? 'react'
const PORT = framework === 'svelte' ? 5274 : 5273
const URL = `http://localhost:${PORT}`
const failures: string[] = []

function check(name: string, ok: boolean, detail = ''): void {
  const status = ok ? 'ok' : 'FAIL'
  console.log(`  ${status}  ${name}${detail ? ` (${detail})` : ''}`)
  if (!ok) failures.push(name)
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(URL)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await Bun.sleep(500)
  }
  throw new Error(`vite dev server never came up on :${PORT}`)
}

/** Painted (alpha > 0) pixel count of the stage canvas, via a 2d probe. */
async function paintedPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector(
      'canvas[role="img"]',
    ) as HTMLCanvasElement | null
    if (!c) return -1
    const probe = document.createElement('canvas')
    probe.width = c.width
    probe.height = c.height
    const ctx = probe.getContext('2d')
    if (!ctx) return -1
    ctx.drawImage(c, 0, 0)
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data
    let painted = 0
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) painted++
    return painted
  })
}

/**
 * Cheap FNV-1a hash of the painted canvas's raw pixel bytes, for exact
 * frame-to-frame comparisons (shimmer moving vs. a genuinely still field).
 */
async function pixelHash(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.querySelector(
      'canvas[role="img"]',
    ) as HTMLCanvasElement | null
    if (!c) return ''
    const probe = document.createElement('canvas')
    probe.width = c.width
    probe.height = c.height
    const ctx = probe.getContext('2d')
    if (!ctx) return ''
    ctx.drawImage(c, 0, 0)
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data
    let h = 0x811c9dc5
    for (let i = 0; i < data.length; i++) {
      h ^= data[i]!
      h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(16)
  })
}

async function selectBackend2d(page: Page): Promise<void> {
  await page.click('button:has-text("2D")')
  // Backend swap remounts the canvas and re-runs the morph; let it draw.
  await page.waitForTimeout(1500)
}

/**
 * Sets a native input's value and dispatches a real `input` event, so React's
 * onChange fires exactly as it would from a user drag — used to drive the
 * jitter slider (identified by its e2e-only aria-label, see
 * `apps/playground-react/src/components/controls/slider.tsx`) without simulating a mouse
 * drag across an analog range control.
 */
async function setSliderValue(
  page: Page,
  ariaLabel: string,
  value: number,
): Promise<void> {
  await page.evaluate(
    ({ ariaLabel, value }) => {
      const el = document.querySelector(
        `input[aria-label="${ariaLabel}"]`,
      ) as HTMLInputElement | null
      if (!el) throw new Error(`slider not found: ${ariaLabel}`)
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set
      setter?.call(el, String(value))
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    { ariaLabel, value },
  )
}

async function run(page: Page, errors: string[]): Promise<void> {
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('canvas[role="img"]', { timeout: 15_000 })
  await page.waitForTimeout(2000)

  const stats = await page.evaluate(() => document.body.innerText)
  check(
    'backend cascade resolves a tier',
    /webgpu|webgl2|canvas2d/.test(stats),
    stats.match(/webgpu|webgl2|canvas2d/)?.[0],
  )

  const info = await page.evaluate(() => {
    const c = document.querySelector(
      'canvas[role="img"]',
    ) as HTMLCanvasElement | null
    if (!c) return null
    const rect = c.getBoundingClientRect()
    return {
      ariaLabel: c.getAttribute('aria-label'),
      bufferW: c.width,
      cssW: Math.round(rect.width),
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    }
  })
  check(
    'canvas has an accessible name',
    !!info?.ariaLabel,
    info?.ariaLabel ?? '',
  )
  check(
    'backing store = CSS size x dpr',
    !!info && info.bufferW === Math.round(info.cssW * info.dpr),
    `${info?.bufferW} vs ${info?.cssW}*${info?.dpr}`,
  )

  await selectBackend2d(page)
  const painted = await paintedPixels(page)
  check('canvas2d tier paints dots', painted > 100, `${painted} px`)

  await page.keyboard.press('Space')
  await page.waitForTimeout(2000)
  const paintedAfterSwap = await paintedPixels(page)
  check('A/B morph renders', paintedAfterSwap > 100, `${paintedAfterSwap} px`)

  check('no console errors', errors.length === 0, errors.join(' | '))
}

async function runReducedMotion(page: Page, errors: string[]): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('canvas[role="img"]', { timeout: 15_000 })
  await page.waitForTimeout(1500)
  await selectBackend2d(page)
  const painted = await paintedPixels(page)
  check(
    'reduced motion still paints (snap path)',
    painted > 100,
    `${painted} px`,
  )
  await page.keyboard.press('Space')
  await page.waitForTimeout(1500)
  const paintedAfterSwap = await paintedPixels(page)
  check(
    'reduced-motion swap renders',
    paintedAfterSwap > 100,
    `${paintedAfterSwap} px`,
  )
  check(
    'no console errors under reduced motion',
    errors.length === 0,
    errors.join(' | '),
  )
}

/**
 * Default motion (jitter > 0) must keep the loop running indefinitely — the
 * old ~1.5s settle-and-sleep window no longer applies once jitter is nonzero.
 * `?jitter=1` (the default anyway) pins the value explicitly so this scenario
 * is deterministic regardless of what a prior scenario left in localStorage
 * (see `applyQueryOverrides` in `apps/playground-react/src/config/use-config.ts`). Also
 * clears the `prefers-reduced-motion: reduce` emulation the previous scenario
 * left on the page — reduced motion forces jitter to 0 regardless of the
 * `motion` prop (see `toSimParams`), which would otherwise make this scenario
 * silently pass for the wrong reason.
 */
async function runShimmerPersists(page: Page, errors: string[]): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto(`${URL}/?jitter=1`, { waitUntil: 'networkidle' })
  await page.waitForSelector('canvas[role="img"]', { timeout: 15_000 })
  await selectBackend2d(page)
  // Well past the old settle window (default settle duration is ~1.5s).
  await page.waitForTimeout(3000)
  const a = await pixelHash(page)
  await page.waitForTimeout(500)
  const b = await pixelHash(page)
  check(
    'default motion keeps shimmering past the old settle window',
    a !== b,
    `${a} vs ${b}`,
  )
  check(
    'no console errors (shimmer persists)',
    errors.length === 0,
    errors.join(' | '),
  )
}

/**
 * jitter === 0 means nothing moves once settled, so the loop should sleep:
 * two snapshots taken well after settling must be pixel-identical, and the
 * content must still have actually painted (not an empty/blank canvas).
 */
async function runJitterZeroSleeps(
  page: Page,
  errors: string[],
): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto(`${URL}/?jitter=0`, { waitUntil: 'networkidle' })
  await page.waitForSelector('canvas[role="img"]', { timeout: 15_000 })
  await selectBackend2d(page)
  await page.waitForTimeout(3000)
  const a = await pixelHash(page)
  await page.waitForTimeout(500)
  const b = await pixelHash(page)
  check(
    'jitter 0 goes still once settled (loop sleeps)',
    a === b,
    `${a} vs ${b}`,
  )
  const painted = await paintedPixels(page)
  check('jitter 0 still painted the content', painted > 100, `${painted} px`)
  check('no console errors (jitter 0)', errors.length === 0, errors.join(' | '))
}

/**
 * Motion changes are applied live (`Engine.setParams`), never by recreating
 * the canvas/engine — only `backend`, the DPR epoch, `maxDpr`, or reduced
 * motion do that (see `src/components/dotimation.tsx`). Starting asleep
 * (jitter 0) and then raising jitter through the playground's own slider
 * proves the change is seamless: the canvas element itself must survive (a
 * pre-change stamp must still be there) and the content must still be
 * painted immediately after (no blank frame from a remount).
 */
async function runLiveMotionChange(
  page: Page,
  errors: string[],
): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto(`${URL}/?jitter=0`, { waitUntil: 'networkidle' })
  await page.waitForSelector('canvas[role="img"]', { timeout: 15_000 })
  await selectBackend2d(page)
  await page.waitForTimeout(1500)

  await page.evaluate(() => {
    const c = document.querySelector(
      'canvas[role="img"]',
    ) as HTMLCanvasElement | null
    if (c) c.dataset.e2eStamp = 'stable'
  })

  await setSliderValue(page, 'jitter', 3)
  await page.waitForTimeout(200)

  const stampSurvived = await page.evaluate(
    () =>
      (document.querySelector('canvas[role="img"]') as HTMLCanvasElement | null)
        ?.dataset.e2eStamp === 'stable',
  )
  check(
    'live motion change keeps the same canvas element (no remount)',
    stampSurvived,
  )
  const painted = await paintedPixels(page)
  check(
    'canvas still painted immediately after a live motion change',
    painted > 100,
    `${painted} px`,
  )
  check(
    'no console errors (live motion change)',
    errors.length === 0,
    errors.join(' | '),
  )
}

async function runLifecycle(page: Page, errors: string[]): Promise<void> {
  await page.goto(`${URL}/lifecycle.html`)
  await page.waitForFunction(
    () => (window.lifecycle?.stats?.particles ?? 0) > 0,
  )
  await page.waitForTimeout(1000)
  check(
    'fill starts at parent size and paints',
    (await paintedPixels(page)) > 100,
  )
  check(
    'fill retains percentage CSS sizing',
    await page
      .locator('canvas')
      .evaluate(
        (canvas) =>
          canvas.style.width === '100%' && canvas.style.height === '100%',
      ),
  )
  await page.evaluate(() => window.lifecycle.resize(480, 180))
  await page.waitForFunction(
    () =>
      document.querySelector('canvas')?.width ===
      Math.round(480 * Math.min(devicePixelRatio, 2)),
  )
  await page.waitForTimeout(1000)
  check('fill follows parent resize', (await paintedPixels(page)) > 100)
  await page.evaluate(() => window.lifecycle.resize(0, 0))
  await page.waitForFunction(
    () => document.querySelector('canvas')?.width === 0,
  )
  await page.evaluate(() => window.lifecycle.resize(320, 120))
  await page.waitForFunction(
    () =>
      document.querySelector('canvas')?.width ===
      Math.round(320 * Math.min(devicePixelRatio, 2)),
  )
  await page.waitForTimeout(1000)
  check(
    'canvas recovers after zero-size parent',
    (await paintedPixels(page)) > 100,
  )

  check(
    'WebGL context restoration paints without an engine wake',
    (await page.evaluate(() => window.lifecycle.verifyRestore())) > 0,
  )

  // Force an init failure AFTER WebGL has bound the canvas to its context.
  await page.evaluate(() => {
    WebGL2RenderingContext.prototype.createShader = () => null
    window.lifecycle.render({ backend: 'webgl2' })
  })
  await page.waitForFunction(
    () =>
      window.lifecycle.stats?.backend === 'canvas2d' &&
      !!document.querySelector('canvas')?.getContext('2d'),
  )
  await page.waitForTimeout(1000)
  check(
    'failed GPU init falls back on a fresh canvas',
    (await paintedPixels(page)) > 100,
  )
  check(
    'no console errors during lifecycle regressions',
    errors.length === 0,
    errors.join(' | '),
  )
}

async function runAsyncStartup(page: Page, errors: string[]): Promise<void> {
  // Hold backend init after it caches the initial dimensions, then resize the
  // DOM canvas before init resolves. This makes the startup race deterministic.
  await page.route('**/backends/webgpu/index.ts*', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `import { createCanvas2DBackend } from '../canvas2d/index.ts';
      export function createWebGPUBackend(params) {
        const backend = createCanvas2DBackend(params);
        let canvas;
        return { ...backend,
          async init(element, dpr) {
            canvas = element;
            backend.init(canvas, dpr);
            canvas.dataset.initializing = 'true';
            await new Promise(resolve => window.addEventListener('release-backend', resolve, { once: true }));
          },
          resize(w, h) { canvas.dataset.backendSize = w + ':' + h; backend.resize(w, h); }
        };
      }`,
    }),
  )
  try {
    await page.goto(`${URL}/lifecycle.html`)
    await page.waitForFunction(() => !!window.lifecycle?.stats)
    await page.evaluate(() => {
      window.lifecycle.stats = null
      window.lifecycle.render({ backend: 'webgpu' })
    })
    await page.waitForSelector('canvas[data-initializing="true"]')
    await page.evaluate(() => window.lifecycle.resize(480, 180))
    await page.waitForFunction(
      () =>
        document.querySelector('canvas')?.width ===
        Math.round(480 * Math.min(devicePixelRatio, 2)),
    )
    await page.evaluate(() =>
      window.dispatchEvent(new Event('release-backend')),
    )
    await page.waitForFunction(
      () => window.lifecycle.stats?.backend === 'webgpu',
    )
    check(
      'async backend receives size changes made during init',
      await page
        .locator('canvas')
        .evaluate(
          (canvas) =>
            canvas.dataset.backendSize ===
            `${(canvas as HTMLCanvasElement).width}:${(canvas as HTMLCanvasElement).height}`,
        ),
    )
    await page.waitForTimeout(1000)
    check('async startup still paints', (await paintedPixels(page)) > 100)
    check(
      'no console errors during async startup',
      errors.length === 0,
      errors.join(' | '),
    )
  } finally {
    await page.unroute('**/backends/webgpu/index.ts*')
  }
}

async function runRasterRetry(page: Page, errors: string[]): Promise<void> {
  await page.goto(`${URL}/lifecycle.html`)
  await page.waitForFunction(
    () => (window.lifecycle?.stats?.particles ?? 0) > 0,
  )
  const failed = page.waitForEvent('console', {
    predicate: (message) =>
      message.type() === 'warning' &&
      message.text().includes('rasterization failed'),
  })
  await page.evaluate(() => {
    Object.defineProperty(window, 'Worker', {
      configurable: true,
      value: undefined,
    })
    const decode = HTMLImageElement.prototype.decode
    HTMLImageElement.prototype.decode = () => {
      HTMLImageElement.prototype.decode = decode
      return Promise.reject(new Error('intentional one-time decode failure'))
    }
    window.lifecycle.stats = null
    window.lifecycle.render({
      item: {
        type: 'image',
        data:
          'data:image/svg+xml,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="100" height="40" fill="red"/></svg>',
          ),
      },
    })
  })
  await failed
  // The item object is retained by the fixture; only an unrelated prop changes.
  await page.evaluate(() => window.lifecycle.render({ className: 'retry' }))
  await page.waitForFunction(() => (window.lifecycle.stats?.particles ?? 0) > 0)
  await page.waitForTimeout(1000)
  check(
    'failed image decode retries on a later render with unchanged raster inputs',
    (await paintedPixels(page)) > 100,
  )
  check(
    'no console errors during raster retry',
    errors.length === 0,
    errors.join(' | '),
  )
}

async function runAdapterContract(page: Page, errors: string[]): Promise<void> {
  await page.goto(`${URL}/lifecycle.html`)
  await page.waitForFunction(
    () => (window.lifecycle?.stats?.particles ?? 0) > 0,
  )
  check(
    'framework canvas reference points at the rendered element',
    await page.evaluate(
      () => window.lifecycle.element === document.querySelector('canvas'),
    ),
  )
  const original = await page.locator('canvas').elementHandle()
  await page.evaluate(() =>
    window.lifecycle.render({
      motion: { jitter: 1 },
      dots: { size: 2 },
      item: { type: 'text', data: 'Updated' },
    }),
  )
  await page.waitForFunction(
    () =>
      document.querySelector('canvas')?.getAttribute('aria-label') ===
      'Updated',
  )
  await page.waitForTimeout(500)
  check(
    'content and motion updates preserve canvas identity',
    await original!.evaluate(
      (element) => element === document.querySelector('canvas'),
    ),
  )
  check('live prop changes still paint', (await paintedPixels(page)) > 100)
  const previousUpdates = await page.evaluate(() => window.lifecycle.updates)
  await page.evaluate(() => window.lifecycle.mutateContent('Mutated'))
  await page.waitForFunction(
    (previous) => window.lifecycle.updates > previous,
    previousUpdates,
  )
  await page.waitForFunction(
    () =>
      document.querySelector('canvas')?.getAttribute('aria-label') ===
      'Mutated',
  )
  await page.waitForTimeout(100)
  check(
    'in-place content mutation is observed on adapter update',
    (await paintedPixels(page)) > 100,
  )
  const cdp = await page.context().newCDPSession(page)
  // Chromium needs a viewport change to deliver media-query change events
  // under CDP device-scale emulation. A DPR-only override updates the value
  // without notifying the existing resolution query.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1281,
    height: 800,
    deviceScaleFactor: 2,
    mobile: false,
  })
  await page.waitForFunction(
    () =>
      devicePixelRatio === 2 && document.querySelector('canvas')?.width === 640,
  )
  check(
    'DPR changes replace the canvas and update the native reference',
    !(await original!.evaluate((element) => element.isConnected)) &&
      (await page.evaluate(
        () => window.lifecycle.element === document.querySelector('canvas'),
      )),
  )
  const denseCanvas = await page.locator('canvas').elementHandle()
  await page.evaluate(() => window.lifecycle.render({ maxDpr: 1 }))
  await page.waitForFunction(
    () =>
      window.lifecycle.element === document.querySelector('canvas') &&
      (window.lifecycle.stats?.particles ?? 0) > 0,
  )
  check(
    'density change supplies a fresh canvas and updates the framework reference',
    !(await denseCanvas!.evaluate((element) => element.isConnected)),
  )
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(500)
  const still = await pixelHash(page)
  await page.waitForTimeout(250)
  check(
    'system reduced motion makes positive-jitter content still',
    still === (await pixelHash(page)) && (await paintedPixels(page)) > 100,
  )
  await page.evaluate(() =>
    window.lifecycle.render({ item: { type: 'text', data: '' } }),
  )
  await page.waitForFunction(() => window.lifecycle.stats?.particles === 0)
  await page.waitForTimeout(100)
  check('empty content clears the canvas', (await paintedPixels(page)) === 0)
  await page.evaluate(() =>
    window.lifecycle.render({
      fill: false,
      width: 240,
      height: 80,
      item: { type: 'text', data: 'Restored' },
    }),
  )
  await page.waitForFunction(
    () =>
      document.querySelector('canvas')?.width === 240 &&
      (window.lifecycle.stats?.particles ?? 0) > 0,
  )
  await page.waitForTimeout(100)
  check(
    'fill can switch to fixed dimensions without blank output',
    (await paintedPixels(page)) > 100,
  )
  await page.evaluate(() => window.lifecycle.unmount())
  await page.waitForFunction(() => !document.querySelector('canvas'))
  check(
    'unmount clears the framework element reference',
    await page.evaluate(() => !window.lifecycle.element),
  )
  await cdp.send('Emulation.clearDeviceMetricsOverride')
  await cdp.detach()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  check(
    'adapter contract produces no console errors',
    errors.length === 0,
    errors.join(' | '),
  )
}

async function runGpuParity(page: Page, errors: string[]): Promise<void> {
  await page.goto(`${URL}/lifecycle.html`)
  await page.waitForFunction(() => !!window.lifecycle?.stats)
  for (const kind of ['webgl2', 'webgpu'] as const) {
    const result = await page.evaluate(
      (kind) => window.lifecycle.verifyGpu(kind),
      kind,
    )
    check(
      `${kind} renders a full state upload`,
      result.initial === 1,
      JSON.stringify(result),
    )
    check(
      `${kind} grows buffers and simulates new particles`,
      result.grown === 2048,
    )
    check(
      `${kind} preserves faders when fade speed changes`,
      result.duringFade > 1,
    )
    check(`${kind} eventually removes faders`, result.afterFade === 1)
  }
  check(
    'no console errors during GPU parity checks',
    errors.length === 0,
    errors.join(' | '),
  )
}

async function runSveltePlayground(
  page: Page,
  errors: string[],
): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(URL)
  await page.getByText('Rendering', { exact: true }).click()
  await page.getByLabel('Backend', { exact: true }).selectOption('canvas2d')
  await page.waitForFunction(
    () =>
      Number(document.querySelector('[data-testid="particles"]')?.textContent) >
      0,
  )
  await page.waitForTimeout(400)
  check(
    'Svelte defaults to system motion preference',
    (await page.getByLabel('Motion preference').inputValue()) === 'auto',
  )
  const still = await pixelHash(page)
  await page.waitForTimeout(300)
  check(
    'Svelte playground honors OS reduced motion',
    still === (await pixelHash(page)) && (await paintedPixels(page)) > 0,
  )

  const original = await page.locator('canvas').elementHandle()
  await page.getByLabel('Text', { exact: true }).fill('Verified Svelte')
  await page.waitForFunction(
    () =>
      document.querySelector('canvas')?.getAttribute('aria-label') ===
      'Verified Svelte',
  )
  await page.getByLabel('Spacing', { exact: true }).fill('4')
  await page.getByLabel('Matching').selectOption('nearest')
  check(
    'Svelte live controls retain the canvas',
    (await original?.evaluate(
      (canvas) => canvas === document.querySelector('canvas'),
    )) === true,
  )
  await page.getByLabel('Max particles', { exact: true }).fill('0')
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="particles"]')?.textContent === '0',
  )
  check(
    'Svelte zero particle limit clears the layout',
    (await paintedPixels(page)) === 0,
  )
  await page.getByLabel('Max particles', { exact: true }).fill('')
  await page.waitForFunction(
    () =>
      Number(document.querySelector('[data-testid="particles"]')?.textContent) >
      0,
  )
  await page.getByRole('button', { name: 'Slot B', exact: true }).click()
  await page.getByLabel('Choose an image').setInputFiles({
    name: 'test.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="red"/></svg>',
    ),
  })
  await page.waitForFunction(() =>
    (
      document.querySelector(
        'input[placeholder="https://… or a data URL"]',
      ) as HTMLInputElement
    )?.value.startsWith('data:image/svg+xml;base64,'),
  )
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas')!
    const data = canvas
      .getContext('2d')!
      .getImageData(0, 0, canvas.width, canvas.height).data
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! > 200 && data[i + 1]! < 30 && data[i + 3]! > 200) return true
    }
    return false
  })
  check(
    'Svelte image upload renders the uploaded red pixels',
    (await paintedPixels(page)) > 0,
  )
  await page.getByRole('button', { name: 'Slot A', exact: true }).click()
  check(
    'A/B compositions preserve independent content',
    (await page.getByLabel('Text', { exact: true }).inputValue()) ===
      'Verified Svelte',
  )
  await page.getByLabel('Text', { exact: true }).press('Space')
  check(
    'Space inside text does not switch slots',
    (await page
      .getByRole('button', { name: 'Slot A', exact: true })
      .getAttribute('aria-pressed')) === 'true',
  )
  await page.locator('h1').click()
  await page.keyboard.press('Space')
  check(
    'Space outside controls morphs to the other slot',
    (await page
      .getByRole('button', { name: 'Slot B', exact: true })
      .getAttribute('aria-pressed')) === 'true',
  )

  await page.getByLabel('Canvas sizing').selectOption('fixed')
  await page.getByLabel('Width', { exact: true }).fill('320')
  await page.getByLabel('Height', { exact: true }).fill('240')
  await page.waitForFunction(
    () =>
      document.querySelector('canvas')?.getBoundingClientRect().width === 320,
  )
  check(
    'Svelte fixed size controls set the CSS box',
    (await page.locator('canvas').boundingBox())?.height === 240,
  )
  await page.getByText('Svelte code', { exact: true }).click()
  check(
    'Svelte code export uses the Svelte package and current dimensions',
    (await page.locator('pre').textContent())?.includes('"width": 320') ===
      true,
  )
  await page.waitForTimeout(400)
  await page.reload()
  check(
    'Svelte settings survive reload',
    (await page.getByLabel('Canvas sizing').inputValue()) === 'fixed' &&
      (await page.getByLabel('Width', { exact: true }).inputValue()) === '320',
  )
  await page.getByRole('button', { name: 'Reset all' }).click()
  check(
    'Svelte reset restores system motion and text',
    (await page.getByLabel('Motion preference').inputValue()) === 'auto' &&
      (await page.getByLabel('Text', { exact: true }).inputValue()) ===
        'Hello\nSvelte',
  )
  // Probe pixel bytes on Canvas2D. A presented, sleeping GPU canvas can
  // remain visible in the compositor while drawImage reads a cleared buffer.
  await page.getByText('Rendering', { exact: true }).click()
  await page.getByLabel('Backend', { exact: true }).selectOption('canvas2d')
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="backend"]')?.textContent ===
        'canvas2d' &&
      Number(document.querySelector('[data-testid="particles"]')?.textContent) >
        0,
  )
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.setViewportSize({ width: 390, height: 844 })
  check(
    'Svelte playground fits a mobile viewport',
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  )
  await page.waitForTimeout(700)
  check(
    'Svelte mobile canvas paints after resize',
    (await paintedPixels(page)) > 0,
  )
  await page.screenshot({
    path: '/tmp/dotimation-svelte-mobile.png',
    fullPage: true,
  })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.waitForTimeout(700)
  check(
    'Svelte desktop canvas paints after resize',
    (await paintedPixels(page)) > 0,
  )
  await page.screenshot({
    path: '/tmp/dotimation-svelte-desktop.png',
    fullPage: true,
  })
  await page.evaluate(() =>
    localStorage.setItem('dotimation-svelte-playground:v1', '{broken'),
  )
  await page.reload()
  check(
    'Svelte recovers from malformed saved settings',
    (await page.getByLabel('Text', { exact: true }).inputValue()) ===
      'Hello\nSvelte',
  )
  check(
    'no console errors in Svelte playground',
    errors.length === 0,
    errors.join(' | '),
  )
  await page.emulateMedia({ reducedMotion: 'no-preference' })
}

const vite = Bun.spawn(
  ['bunx', '--bun', 'vite', '--port', String(PORT), '--strictPort'],
  { cwd: `apps/playground-${framework}`, stdout: 'ignore', stderr: 'inherit' },
)

try {
  await waitForServer()
  const browser = await chromium.launch({
    args: [
      '--no-sandbox',
      '--enable-unsafe-swiftshader',
      '--enable-unsafe-webgpu',
      `--use-angle=${process.env.DOTIMATION_E2E_ANGLE ?? 'swiftshader'}`,
      // Linux canvas presentation needs Vulkan compositing and a display
      // (xvfb-run in CI), otherwise acquiring the texture can lose the device.
      ...(process.platform === 'linux'
        ? [
            '--enable-gpu',
            '--ignore-gpu-blocklist',
            '--enable-features=Vulkan',
            '--use-vulkan=swiftshader',
          ]
        : []),
    ],
  })
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    })
    await withBrowserDiagnostics(context, `e2e-${framework}`, async () => {
      // The playground persists config in localStorage; nothing to reset in a
      // fresh context. Collect page errors across both scenarios.
      const errors: string[] = []
      const page = await context.newPage()
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text())
      })
      page.on('pageerror', (err) => errors.push(String(err)))

      if (process.env.DOTIMATION_E2E_ADAPTER_ONLY === '1') {
        await runAdapterContract(page, errors)
      } else if (process.env.DOTIMATION_E2E_GPU_ONLY === '1') {
        await runGpuParity(page, errors)
      } else {
        if (framework === 'react') {
          console.log('scenario: default')
          await run(page, errors)
          errors.length = 0
          console.log('scenario: prefers-reduced-motion')
          await runReducedMotion(page, errors)
          errors.length = 0
          console.log('scenario: shimmer persists (jitter > 0 never sleeps)')
          await runShimmerPersists(page, errors)
          errors.length = 0
          console.log('scenario: jitter 0 sleeps after settling')
          await runJitterZeroSleeps(page, errors)
          errors.length = 0
          console.log('scenario: live motion change is seamless')
          await runLiveMotionChange(page, errors)
          errors.length = 0
        }
        if (framework === 'svelte') {
          console.log('scenario: Svelte playground controls and persistence')
          await runSveltePlayground(page, errors)
          errors.length = 0
        }
        console.log(
          `scenario: ${framework} adapter lifecycle and failed GPU init`,
        )
        await runLifecycle(page, errors)
        errors.length = 0
        console.log(
          'scenario: resize during asynchronous backend initialization',
        )
        await runAsyncStartup(page, errors)
        errors.length = 0
        console.log('scenario: retry after a transient image failure')
        await runRasterRetry(page, errors)
        errors.length = 0
        console.log(
          `scenario: ${framework} props, references, reduced motion and cleanup`,
        )
        await runAdapterContract(page, errors)
        errors.length = 0
        console.log('scenario: WebGL and WebGPU compute/render parity')
        await runGpuParity(page, errors)
      }
      if (failures.length > 0)
        throw new Error(`E2E checks failed: ${failures.join(', ')}`)
    })
  } finally {
    await browser.close()
  }
} finally {
  vite.kill()
}

console.log('\ne2e smoke: all checks passed')
