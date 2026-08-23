// Screenshot sweep for the Bevel restyle — captures every screen at 390px.
// Temporary dev tool; not part of the app or its test suites.
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = process.env.BASE_URL || 'http://localhost:5174/budget-app/'
const OUT = process.env.OUT || '/tmp/shots'
const ONLY = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

const MORE = {
  wizard: 'Add, remove or edit anything I take',
  protocol: 'Everything I’m on, at a glance',
  supplies: 'Vials I own, run-out dates',
  supplements: 'What I take by mouth',
  history: 'Every dose, rates',
  calc: 'Reconstitution & syringe units',
  mix: 'Can these two share a syringe',
  now: 'What my protocol is doing today',
  settings: 'Theme, lead time, backup and reset',
}

// Viewport shots, not fullPage: a fullPage capture renders the fixed nav and
// the sticky back bar at their stuck offsets, which lands them in the middle
// of the image and hides whatever is really there.
const shot = async (name) => {
  await page.waitForTimeout(450)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  const h = await page.evaluate(() => document.documentElement.scrollHeight)
  if (h > 1500) {
    await page.evaluate(() => window.scrollTo(0, Math.round(document.documentElement.scrollHeight / 2)))
    await page.waitForTimeout(350)
    await page.screenshot({ path: `${OUT}/${name}-mid.png` })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(250)
  }
  console.log('shot', name)
}
// Some destinations are modals (the wizard) — they sit over the nav and have
// to be dismissed before the next screen can be reached.
const closeOverlay = async () => {
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator('div.fixed.inset-0.z-50').count())) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
  }
}
const tab = async (label) => {
  await closeOverlay()
  await page.click(`nav button[aria-label="${label}"]`)
  await page.waitForTimeout(400)
}
const more = async (id) => {
  await tab('More')
  await page.click(`text=${MORE[id]}`)
  await page.waitForTimeout(500)
}
const want = (n) => ONLY.length === 0 || ONLY.includes(n)

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
const gotIt = page.getByText('Got it', { exact: true })
if (await gotIt.count()) { await gotIt.first().click(); await page.waitForTimeout(400) }

if (want('home')) await shot('home')

for (const [label, name] of [['Calendar', 'calendar'], ['Symptoms', 'symptoms'], ['Body', 'body'], ['More', 'more']]) {
  if (!want(name)) continue
  await tab(label)
  await shot(name)
}

// month view of the calendar
if (want('calendar-month')) {
  await tab('Calendar')
  const m = page.locator('button:has-text("Month")')
  if (await m.count()) { await m.first().click(); await shot('calendar-month') }
}

for (const id of Object.keys(MORE)) {
  if (!want(id)) continue
  await more(id)
  await shot(id)
}

// the restock half of Stock
if (want('restock')) {
  await more('supplies')
  const r = page.locator('button[aria-label="Restock list"]')
  if (await r.count()) { await r.first().click(); await shot('restock') }
}

// the site picker / injection map, opened from a due dose on Home
if (want('sitemap')) {
  await tab('Home')
  const log = page.locator('main button[aria-label^="Log "]').first()
  if (await log.count()) { await log.click(); await shot('sitemap') }
}

console.log('CONSOLE_ERRORS:', JSON.stringify(errors.slice(0, 10)))
await browser.close()
