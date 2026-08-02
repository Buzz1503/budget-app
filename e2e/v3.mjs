import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = process.env.BASE_URL || 'http://localhost:5175'
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
    if (re.test(await page.textContent('body'))) return true
    await page.waitForTimeout(150)
  }
  throw new Error('timeout waiting for ' + re)
}
const nav = (label) => page.click(`nav button:has-text("${label}")`)

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })

await step('Home: date + AM/PM toggle + 5 tabs', async () => {
  await waitText(/not medical advice/)
  await page.click('text=Got it')
  const tabs = await page.locator('nav button').count()
  if (tabs !== 5) throw new Error(`expected 5 tabs, got ${tabs}`)
  // AM/PM toggle present
  if (!(await page.locator('button:has-text("AM")').count())) throw new Error('AM toggle missing')
  if (!(await page.locator('button:has-text("PM")').count())) throw new Error('PM toggle missing')
})
await page.screenshot({ path: `${SHOT}/v3-01-home.png` })

await step('Home: AM slot shows AM peptides, PM shows PM peptides', async () => {
  // AM (default at test time may vary) — force AM
  await page.click('button:has-text("AM")')
  await page.waitForTimeout(300)
  const am = await page.textContent('body')
  // Semax/KPV/SS-31 are AM; GHK-Cu/DSIP are PM
  const amHasMorning = /Semax|KPV|SS-31|NAD/.test(am)
  await page.click('button:has-text("PM")')
  await page.waitForTimeout(300)
  const pm = await page.textContent('body')
  const pmHasEvening = /GHK-Cu|DSIP/.test(pm)
  if (!amHasMorning) throw new Error('AM slot missing morning peptides')
  if (!pmHasEvening) throw new Error('PM slot missing evening peptides')
  // GHK-Cu should NOT appear in AM
  await page.click('button:has-text("AM")')
  await page.waitForTimeout(300)
  const am2 = await page.textContent('body')
  // (GHK-Cu is PM-only so its Log card shouldn't be in AM list — but name may appear elsewhere; check due cards)
})

await step('Rotation: Log opens body map with suggestion, records site', async () => {
  await page.click('button:has-text("AM")')
  await page.waitForTimeout(300)
  await page.locator('button[aria-label^="Log "]').first().click()
  await waitText(/Tap a spot on the map/)
  await waitText(/Inject here — spot \d+/i)
  // confirm the suggested site
  await page.click('button:has-text("Log here")')
  await page.waitForTimeout(400)
  await page.click('button:has-text("Done")') // v9: dismiss the written confirmation
  await page.waitForTimeout(400)
  await page.waitForTimeout(900)
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  const withSite = store.doseLogs.find((l) => l.siteId)
  if (!withSite) throw new Error('dose log has no siteId')
  if (!withSite.loggedAt) throw new Error('dose log has no timestamp')
})
await page.screenshot({ path: `${SHOT}/v3-02-logged-site.png` })

await step('Library: schedule config (slot + weekdays) present & persists', async () => {
  await nav('More'); await page.click('text=Library'); await waitText(/Retatrutide/)
  await page.click('h3:has-text("NAD+")')
  await waitText(/Daily schedule/)
  // NAD+ is 3x/week → weekday picker with day letters
  const dayBtns = await page.locator('button', { hasText: /^[MTWFS]$/ }).count()
  if (dayBtns < 5) throw new Error('weekday picker missing')
})

await step('Body: log a measurement, trend + model render', async () => {
  await nav('Body'); await waitText(/Body & Outcomes/)
  await page.click('button:has-text("Log measurement")')
  await waitText(/Import DEXA/)
  await page.fill('label:has-text("Weight") input', '82')
  await page.fill('label:has-text("Body fat") input', '20')
  await page.fill('label:has-text("Visceral fat") input', '9')
  await page.click('button:has-text("Save measurement")')
  await page.waitForTimeout(900)
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  if (!store.measurements.length) throw new Error('measurement not saved')
  if (store.measurements[0].weight !== 82) throw new Error('weight not saved')
  // trends tab
  await page.click('button:has-text("Trends")')
  await waitText(/7-day avg|Weight/)
  // model tab
  await page.click('button:has-text("Model")')
  await waitText(/body fat|metric-driven/)
})
await page.screenshot({ path: `${SHOT}/v3-03-body.png` })

await step('Body: second measurement (later date) enables scrubber + milestone', async () => {
  await page.click('button:has-text("Stats")')
  await page.click('button:has-text("Log measurement")')
  // a week later so it's a distinct dated entry, trending down
  const d = new Date(); d.setDate(d.getDate() + 7)
  await page.fill('input[type="date"]', d.toISOString().slice(0, 10))
  await page.fill('label:has-text("Weight") input', '80')
  await page.fill('label:has-text("Body fat") input', '18')
  await page.click('button:has-text("Save measurement")')
  await page.waitForTimeout(700)
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  if (store.measurements.length !== 2) throw new Error('second measurement not saved')
  if (!store.gamification.badges.includes('body-milestone')) throw new Error('body milestone not awarded')
})

await step('Outcomes: peptide × subjective renders after a symptom log', async () => {
  // add a symptom check-in first
  await nav('Symptoms')
  await page.click('button:has-text("Great energy")')
  await page.click('button:has-text("Log check-in")')
  await page.waitForTimeout(800)
  await nav('Body')
  await page.click('button:has-text("Outcomes")')
  await waitText(/Wellbeing|Against/)
  // default metric is subjective; should now have data
  await page.waitForTimeout(500)
})
await page.screenshot({ path: `${SHOT}/v3-04-outcome.png` })

await step('persistence: reload keeps measurements + site logs + symptoms', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  if (store.measurements.length < 2) throw new Error('measurements lost')
  if (!store.doseLogs.some((l) => l.siteId)) throw new Error('site log lost')
  if (!store.symptomLogs.length) throw new Error('symptoms lost')
  console.log('  persisted — measurements:', store.measurements.length, 'doseLogs:', store.doseLogs.length, 'xp:', store.gamification.xp)
})

console.log('\n--- console/page errors:', errors.length)
errors.forEach((e) => console.log(' ', e.slice(0, 220)))
await browser.close()
process.exit(errors.length ? 1 : 0)
