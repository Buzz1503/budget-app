import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = process.env.BASE_URL || 'http://localhost:5174'
const SHOT = new URL('./shots', import.meta.url).pathname
mkdirSync(SHOT, { recursive: true })
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const errors = []
const browser = await chromium.launch({ executablePath: EXE })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

const step = async (name, fn) => {
  try { await fn(); console.log('PASS', name) }
  catch (e) { console.log('FAIL', name, '—', e.message.split('\n')[0]); errors.push(`step ${name}: ${e.message}`) }
}
const waitText = async (re, timeout = 5000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const t = await page.textContent('body')
    if (re.test(t)) return t
    await page.waitForTimeout(150)
  }
  throw new Error('timeout waiting for ' + re)
}
const nav = (label) => page.click(`nav button:has-text("${label}")`)

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })

await step('Home: disclaimer + ring + 6-tab bar', async () => {
  await waitText(/not medical advice/)
  const tabs = await page.locator('nav button').count()
  if (tabs !== 6) throw new Error(`expected 6 primary tabs, got ${tabs}`)
  await page.click('text=Got it')
})

await step('Home: log a dose via site picker fires XP + done state', async () => {
  await page.locator('button[aria-label^="Log "]').first().click()
  await waitText(/Tap a spot on the map/)
  await page.click('button:has-text("Log here")')
  await page.waitForTimeout(400)
  await page.click('button:has-text("Done")') // v9: dismiss the written confirmation
  await page.waitForTimeout(400)
  await page.waitForTimeout(1000)
  const logged = await page.locator('button[aria-label$=" logged"]').count()
  if (!logged) throw new Error('no logged state after logging')
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  if (!store.doseLogs.length) throw new Error('doseLog not persisted')
  if (!store.doseLogs[0].siteId) throw new Error('siteId not recorded')
  if (store.gamification.xp < 10) throw new Error('no XP awarded')
})
await page.screenshot({ path: `${SHOT}/v2-01-today.png` })

await step('Right Now: phases render for active peptides', async () => {
  await nav('More'); await page.click('text=Right Now')
  await waitText(/What your stack is doing/)
  await waitText(/(Loading|Building|Peak|Maintenance)/) // poll until phase cards render
  const txt = await page.textContent('body')
  if (!/Selank/.test(txt)) throw new Error('active peptide missing')
  if (!/week/.test(txt)) throw new Error('no next-phase estimate')
})
await page.screenshot({ path: `${SHOT}/v2-02-rightnow.png` })

await step('Mix: lazy matrix loads, MIX verdict + reaction', async () => {
  await nav('Mix')
  await waitText(/Compatibility Codex/)
  // BPC-157 + KPV → MIX (R00)
  await page.click('button:has-text("BPC-157")')
  await page.click('button:has-text("KPV")')
  await waitText(/Safe to mix/)
  const txt = await page.textContent('body')
  if (!/R00/.test(txt)) throw new Error('reason code R00 missing')
  if (!/Chemistry model/.test(txt)) throw new Error('confidence badge missing')
})
await page.screenshot({ path: `${SHOT}/v2-03-mix-mix.png` })

await step('Mix: DONT_MIX verdict (Retatrutide + Tesamorelin, R01 gel)', async () => {
  // clear current pair, pick reta + tesa
  await page.click('button:has-text("BPC-157")') // deselect A
  await page.click('button:has-text("KPV")') // deselect B
  await page.click('button:has-text("Retatrutide")')
  await page.click('button:has-text("Tesamorelin")')
  await waitText(/Don't mix/)
  const txt = await page.textContent('body')
  if (!/R01/.test(txt)) throw new Error('expected R01')
})
await page.screenshot({ path: `${SHOT}/v2-04-mix-dont.png` })

await step('Mix: CAUTION shows mandatory visual-inspection gate', async () => {
  await page.click('button:has-text("Retatrutide")')
  await page.click('button:has-text("Tesamorelin")')
  // GHK-Cu + SS-31 → CAUTION (R03)
  await page.click('button:has-text("GHK-Cu")')
  await page.click('button:has-text("SS-31")')
  await waitText(/Mix with caution/)
  await waitText(/Visual inspection required/)
  // gate must block: "Confirm it's clear" present, not yet confirmed
  if (!(await page.locator("button:has-text(\"Confirm it's clear\")").count())) throw new Error('inspection gate button missing')
  await page.click("button:has-text(\"Confirm it's clear\")")
  await waitText(/Confirmed clear/)
})
await page.screenshot({ path: `${SHOT}/v2-05-mix-caution.png` })

await step('Mix: proven-blend seal on Selank + Semax', async () => {
  await page.click('button:has-text("GHK-Cu")')
  await page.click('button:has-text("SS-31")')
  await page.click('button:has-text("Selank")')
  await page.click('button:has-text("Semax")')
  await waitText(/Proven blend/)
})

await step('Mix: Codex advances with discovery XP', async () => {
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  if (!store.mixExplored.length) throw new Error('mixExplored empty — codex not tracking')
})

await step('Mix: browse all 86 compounds', async () => {
  await page.click('button:has-text("My stack")') // toggle → browse all
  await page.fill('input[placeholder*="Search"]', 'cagri')
  await waitText(/Cagrilintide/)
  await page.click('button:has-text("All 86")') // toggle back → my stack
})

await step('Symptoms: check-in logs, streak advances, timeline', async () => {
  await nav('Symptoms')
  await waitText(/Daily check-in|Today's check-in/)
  await page.click('button:has-text("Great energy")')
  await page.click('button:has-text("Better sleep")')
  await page.click('button:has-text("Log check-in")')
  await page.waitForTimeout(900)
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  if (!store.symptomLogs.length) throw new Error('symptom log not saved')
  if ((store.gamification.checkinStreak || 0) < 1) throw new Error('check-in streak not advanced')
  if (!store.symptomLogs[0].activePeptides.length) throw new Error('active peptides not captured')
})
await page.screenshot({ path: `${SHOT}/v2-06-symptoms.png` })

await step('More hub: navigates to sub-screens', async () => {
  await nav('More')
  await waitText(/Library|Stock|Settings/)
  await page.click('text=Stock')
  await waitText(/runs out|on hand/)
  await nav('More')
  await page.click('text=Library')
  await waitText(/Retatrutide/)
})
await step('Calculator is a primary tab', async () => {
  await nav('Calculator')
  await waitText(/Concentration/)
})
await page.screenshot({ path: `${SHOT}/v2-07-more.png` })

await step('Plan (Schedule) still works (titration confirm)', async () => {
  await nav('More'); await page.click('text=Plan')
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    const d = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10)
    raw.state.titration.selank.levelStartDate = d
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await nav('More'); await page.click('text=Plan')
  await page.click('button:has-text("Selank")')
  await waitText(/Tolerating well/)
  await page.click('button:has-text("Advance")')
  await page.waitForTimeout(1000)
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  if (store.titration.selank.level !== 1) throw new Error('titration confirm did not advance')
})

await step('persistence: full reload keeps everything', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  if (!store.doseLogs.length) throw new Error('dose logs lost')
  if (!store.symptomLogs.length) throw new Error('symptom logs lost')
  if (!store.mixExplored.length) throw new Error('mix codex lost')
  console.log('  persisted — logs:', store.doseLogs.length, 'symptoms:', store.symptomLogs.length,
    'explored:', store.mixExplored.length, 'xp:', store.gamification.xp)
})

console.log('\n--- console/page errors:', errors.length)
errors.forEach((e) => console.log(' ', e.slice(0, 200)))
await browser.close()
process.exit(errors.length ? 1 : 0)
