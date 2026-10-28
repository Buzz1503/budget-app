// Screenshots every main screen at 390 x 844 with the preview fixtures, for
// checking each one against the text rules and the chart checklist.
//
//   node scripts/design-review.mjs                 # all screens into design-review/
//   node scripts/design-review.mjs sauna sleep     # just these
//   node scripts/design-review.mjs --out design-review/final
//
// Starts its own dev server (demo Health data, port 5177) and stops it at the end.
import { spawn } from 'child_process'
import { mkdirSync } from 'fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const outAt = args.indexOf('--out')
const OUT = outAt >= 0 ? args[outAt + 1] : 'design-review'
const only = args.filter((a, i) => !a.startsWith('--') && (outAt < 0 || i !== outAt + 1))
const PORT = 5177
const BASE = `http://localhost:${PORT}/budget-app/`
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

// each screen: the preview name and what to tap once it is up
const SCREENS = [
  ['home'], ['composition'], ['effects'], ['recovery'],
  ['sleep'], ['sleep-full', '[data-testid="night-expand"]'], ['recovery-full', '[data-testid="chart-expand"]'], ['sleep-lab', '[data-testid="lab-open-analysis"]', '[data-testid="lab-helps"]'],
  ['sleep-sounds', '[data-testid="sounds-row"]'],
  ['sauna'], ['more'], ['stock'], ['bloods'], ['import'], ['import-list', 'eval:__previewImport', '[data-testid="import-list"]'],
  ['import-check', 'eval:__previewImport', '[data-testid="import-list"]', '[data-testid="import-row"]:has([data-status="check"])'],
].filter(([n]) => !only.length || only.includes(n))

mkdirSync(OUT, { recursive: true })
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  env: { ...process.env, VITE_DEMO_HEALTH: '1' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
})
const stop = () => { try { process.kill(-server.pid, 'SIGTERM') } catch { /* already gone */ } }
process.on('exit', stop)
await new Promise((ok, fail) => {
  const t = setTimeout(() => fail(new Error('dev server did not start')), 30000)
  server.stdout.on('data', (d) => { if (/Local:/.test(String(d))) { clearTimeout(t); ok() } })
})

const browser = await chromium.launch({ executablePath: EXE })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const problems = []
page.on('pageerror', (e) => problems.push(`${e.message}`))
try {
  for (const [name, tap, ready, then] of SCREENS) {
    await page.goto(`${BASE}?preview=${name}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__previewReady === true, null, { timeout: 90000 })
    await page.waitForTimeout(2600)
    for (const b of await page.locator('button:has-text("Got it")').all()) { try { await b.click({ timeout: 1000 }) } catch { /* gone */ } }
    if (tap) {
      try {
        if (tap.startsWith('eval:')) await page.evaluate((fn) => window[fn](), tap.slice(5))
        else await page.locator(tap).first().click({ timeout: 8000 })
        await page.waitForTimeout(1200)
      } catch { problems.push(`${name}: could not tap ${tap}`) }
      if (ready) { try { await page.locator(ready).first().waitFor({ timeout: 60000 }) } catch { problems.push(`${name}: ${ready} never showed`) } }
      if (then) { try { await page.locator(then).first().click({ timeout: 8000 }); await page.waitForTimeout(1200) } catch { problems.push(`${name}: could not tap ${then}`) } }
    }
    // text rules: no em dash anywhere on screen
    const dash = await page.evaluate(() => document.body.innerText.split('\n').filter((l) => l.includes('\u2014')).slice(0, 3))
    if (dash.length) problems.push(`${name}: em dash in ${JSON.stringify(dash)}`)
    // a full screen view is what the phone shows, portrait then landscape
    if (name.endsWith('-full') || name === 'import-check') {
      await page.screenshot({ path: `${OUT}/${name}.png` })
      await page.setViewportSize({ width: 844, height: 390 })
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${OUT}/${name}-landscape.png` })
      await page.setViewportSize({ width: 390, height: 844 })
      console.log(`shot ${OUT}/${name}.png and -landscape`)
      continue
    }
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
    // and screen-height slices, for reading one screen at a time
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    const n = Math.min(12, Math.ceil(height / 844))
    for (let i = 0; i < n; i++) {
      await page.screenshot({ path: `${OUT}/${name}-${i + 1}.png`, fullPage: true, clip: { x: 0, y: i * 844, width: 390, height: Math.min(844, height - i * 844) } })
    }
    console.log(`shot ${OUT}/${name}.png (+${n} slices)`)
  }
} finally {
  await browser.close()
  stop()
}
if (problems.length) { console.log(`problems:\n  ${problems.join('\n  ')}`); process.exitCode = 1 }
