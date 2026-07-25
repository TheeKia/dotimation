/**
 * End-to-end smoke test: boots the Vite playground, drives headless Chromium,
 * and verifies the DOM/GPU shells that unit tests cannot reach — backend
 * cascade, canvas sizing/a11y, actual pixel output, and the reduced-motion
 * path. Run with `bun run test:e2e` (named .e2e.ts so `bun test` skips it).
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

async function selectBackend2d(page: Page): Promise<void> {
  await page.click('button:has-text("2D")')
  // Backend swap remounts the canvas and re-runs the morph; let it draw.
  await page.waitForTimeout(1500)
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
