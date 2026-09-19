import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { BrowserContext } from 'playwright'

/** Retain traces and screenshots only when a browser scenario fails. */
export async function withBrowserDiagnostics(
  context: BrowserContext,
  name: string,
  run: () => Promise<void>,
): Promise<void> {
  const directory = process.env.DOTIMATION_DIAGNOSTICS_DIR
  if (!directory) return run()

  await mkdir(directory, { recursive: true })
  await context.tracing.start({ screenshots: true, snapshots: true })
  let failed = false
  try {
    await run()
  } catch (error) {
    failed = true
    // Diagnostics must not mask the original test failure.
    await Promise.allSettled(
      context.pages().map((page, index) =>
        page.screenshot({
          path: resolve(directory, `${name}-${index}.png`),
          timeout: 5_000,
        }),
      ),
    )
    throw error
  } finally {
    await context.tracing
      .stop(failed ? { path: resolve(directory, `${name}.zip`) } : {})
      .catch((error) => console.error('Could not save browser trace:', error))
  }
}
