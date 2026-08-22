import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = process.env.BASE_URL || 'http://localhost:5176'
const SHOT = new URL('./shots', import.meta.url).pathname
mkdirSync(SHOT, { recursive: true })
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const errors = []
const browser = await chromium.launch({ executablePath: EXE })
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

const step = async (name, fn) => {
  try { await fn(); console.log('PASS', name) }
  catch (e) { console.log('FAIL', name, '—', e.message.split('\n')[0]); errors.push(`step ${name}: ${e.message}`) }
}
const waitText = async (re, timeout = 5000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) { if (re.test(await page.textContent('body'))) return true; await page.waitForTimeout(150) }
  throw new Error('timeout waiting for ' + re)
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.click('text=Got it')
await page.click('button:has-text("AM")')
await page.waitForTimeout(300)

// v13 narrowed the bar to five tabs and moved Calculator and Mix under More.
await step('Change 2: bottom nav has exactly 5 tabs', async () => {
  const labels = await page.locator('nav button span').allTextContents()
  const want = ['Home', 'Calendar', 'Symptoms', 'Body', 'More']
  const got = labels.filter((l) => want.includes(l))
  if (got.length !== 5) throw new Error(`expected 5 named tabs, got ${labels.join(',')}`)
  for (const w of want) if (!labels.includes(w)) throw new Error(`missing tab ${w}`)
})
await page.screenshot({ path: `${SHOT}/v4-01-nav.png` })

await step('Change 2: moved screens reachable under More', async () => {
  await page.click('nav button:has-text("More")')
  await waitText(/Right Now/)
  for (const l of ['Right Now', 'Calculator', 'Mix', 'Library', 'Stock', 'Needle guide', 'Settings']) {
    if (!(await page.locator(`text=${l}`).count())) throw new Error(`More missing ${l}`)
  }
  // drill into one to confirm it renders + back works
  await page.click('text=Right Now')
  await waitText(/What your stack is doing/)
  await page.click('nav button:has-text("More")')
  await page.click('text=Library')
  await waitText(/Retatrutide/)
})
await page.screenshot({ path: `${SHOT}/v4-02-more.png` })

await step('Change 2: Calculator lives under More', async () => {
  await page.click('nav button[aria-label="More"]')
  await page.waitForTimeout(320)
  await page.click('text=Reconstitution & syringe units')
  await waitText(/Concentration/)
})

await step('Change 1: single-peptide log still works (site picker)', async () => {
  await page.click('nav button:has-text("Home")')
  await page.click('button:has-text("AM")')
  await page.waitForTimeout(300)
  await page.locator('button[aria-label^="Log "]').first().click()
  await waitText(/Tap any spot to pick it|INJECT HERE|Next on your path/)
  await page.click('button:has-text("Log here")')
  await page.waitForTimeout(400)
  await page.click('button:text-is("Done")') // v9: dismiss the written confirmation
  await page.waitForTimeout(400)
  await page.waitForTimeout(800)
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  if (!s.doseLogs.some((l) => l.siteId && !l.coDrawId)) throw new Error('single log not recorded')
})

const sel = (name) => page.click(`button[aria-label="Select ${name} to co-draw"]`)

await step('Change 1: MIX co-draw (Selank+Semax) logs to one site', async () => {
  await page.click('nav button:has-text("Home")')
  await page.click('button:has-text("AM")')
  await page.waitForTimeout(300)
  await sel('Selank'); await sel('Semax')
  await waitText(/2 selected/)
  await page.click('button:has-text("Log together")')
  await waitText(/pick one spot/i) // all-MIX → straight to site
  await page.click('button:has-text("Log 2 together")')
  await page.waitForTimeout(900)
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  const cd = s.doseLogs.filter((l) => l.coDrawId)
  if (cd.length !== 2) throw new Error(`expected 2 co-draw logs, got ${cd.length}`)
  if (new Set(cd.map((l) => l.coDrawId)).size !== 1) throw new Error('different coDrawId')
  if (new Set(cd.map((l) => l.siteId)).size !== 1) throw new Error('different sites')
  if (new Set(cd.map((l) => l.loggedAt)).size !== 1) throw new Error('different timestamps')
  if (s.gamification.xp < 20) throw new Error('co-draw XP not counted for both')
})
await page.screenshot({ path: `${SHOT}/v4-03-codraw.png` })

await step('Change 1: CAUTION co-draw (Selank+SS-31) is refused outright', async () => {
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.click('text=Got it'); await page.click('button:has-text("AM")'); await page.waitForTimeout(300)
  await sel('Selank'); await sel('SS-31')
  await page.click('button:has-text("Log together")')
  await waitText(/Not one shot — inject these separately/)
  if (await page.locator("button:has-text(\"Confirm it's clear\")").count()) {
    throw new Error('a caution pair can still be talked into one syringe')
  }
  const body = await page.textContent('body')
  if (/pick one spot/i.test(body)) throw new Error('a site picker was offered for a caution pair')
})
await page.screenshot({ path: `${SHOT}/v4-04-caution.png` })

await step('Change 1: DONT_MIX pair (Reta+Tesa) is blocked', async () => {
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.click('text=Got it'); await page.click('button:has-text("AM")'); await page.waitForTimeout(300)
  // Retatrutide is weekly on its start weekday (= today on fresh install), Tesamorelin daily; both AM
  if (!(await page.locator('button[aria-label="Select Retatrutide to co-draw"]').count())) throw new Error('Retatrutide not due in AM today')
  await sel('Retatrutide'); await sel('Tesamorelin')
  await page.click('button:has-text("Log together")')
  await waitText(/Not one shot — inject these separately/)
})
await page.screenshot({ path: `${SHOT}/v4-05-blocked.png` })

await step('persistence: co-draw survives reload', async () => {
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.click('text=Got it'); await page.click('button:has-text("AM")'); await page.waitForTimeout(300)
  await sel('Selank'); await sel('Semax')
  await page.click('button:has-text("Log together")')
  await waitText(/pick one spot/i)
  await page.click('button:has-text("Log 2 together")')
  await page.waitForTimeout(700)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  if (!s.doseLogs.some((l) => l.coDrawId)) throw new Error('co-draw logs lost after reload')
  console.log('  persisted — doseLogs:', s.doseLogs.length, 'xp:', s.gamification.xp)
})

console.log('\n--- console/page errors:', errors.length)
errors.forEach((e) => console.log(' ', e.slice(0, 200)))
await browser.close()
process.exit(errors.length ? 1 : 0)
