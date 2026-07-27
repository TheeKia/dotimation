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

const PORT = 5273
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
 * `test/ui/src/components/controls/slider.tsx`) without simulating a mouse
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
 * (see `applyQueryOverrides` in `test/ui/src/config/use-config.ts`). Also
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

const vite = Bun.spawn(
  ['bunx', '--bun', 'vite', '--port', String(PORT), '--strictPort'],
  { cwd: 'test/ui', stdout: 'ignore', stderr: 'pipe' },
)

try {
  await waitForServer()
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  })
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    })
    // The playground persists config in localStorage; nothing to reset in a
    // fresh context. Collect page errors across both scenarios.
    const errors: string[] = []
    const page = await context.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', (err) => errors.push(String(err)))

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
  } finally {
    await browser.close()
  }
} finally {
  vite.kill()
}

if (failures.length > 0) {
  console.error(
    `\n${failures.length} e2e check(s) failed: ${failures.join(', ')}`,
  )
  process.exit(1)
}
console.log('\ne2e smoke: all checks passed')
