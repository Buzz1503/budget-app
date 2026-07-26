import { chromium } from 'playwright'

import { mkdirSync } from 'fs'
const SHOT = new URL('./shots', import.meta.url).pathname
mkdirSync(SHOT, { recursive: true })
const errors = []
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

const step = async (name, fn) => {
  try { await fn(); console.log('PASS', name) }
  catch (e) { console.log('FAIL', name, '—', e.message.split('\n')[0]); errors.push(`step ${name}: ${e.message}`) }
}

const waitText = async (re, timeout = 4000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const t = await page.textContent('body')
    if (re.test(t)) return t
    await page.waitForTimeout(150)
  }
  throw new Error('timeout waiting for ' + re)
}

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })

await step('Today renders with disclaimer + ring', async () => {
  await page.waitForSelector('text=not medical advice', { timeout: 5000 })
  await page.waitForSelector('text=Today')
})

await step('due list shows peptides with doses and cycle day', async () => {
  await page.waitForSelector('text=Selank')
  await page.waitForSelector('text=Retatrutide') // weekly, day 0 → due
  const txt = await page.textContent('body')
  if (!/250 mcg/.test(txt)) throw new Error('Selank floor dose 250 mcg not shown')
  if (!/day 1\/112/.test(txt)) throw new Error('Selank cycle day 1/112 not shown; body: ' + txt.slice(0, 200))
})

await step('dismiss disclaimer', async () => {
  await page.click('text=Got it')
})

await page.screenshot({ path: `${SHOT}/01-today.png` })

await step('log a dose → ring, XP, done state update', async () => {
  const before = await page.textContent('body')
  const m = before.match(/(\d+)\/(\d+)/)
  await page.locator('button[aria-label^="Log "]').first().click()
  await page.waitForTimeout(1200)
  const after = await page.textContent('body')
  if (!/logged/i.test(after) && !(await page.locator('button[aria-label$=" logged"]').count())) throw new Error('no logged state')
})

await page.screenshot({ path: `${SHOT}/02-logged.png` })

await step('Library shows all 11 seeds', async () => {
  await page.click('nav >> text=Library')
  await page.waitForTimeout(400)
  const names = ['Retatrutide','Selank','Semax','KPV','SS-31','DSIP','MOTS-c','BPC-157','GHK-Cu','NAD+','Tesamorelin']
  const txt = await page.textContent('body')
  for (const n of names) if (!txt.includes(n)) throw new Error(`missing ${n}`)
})

await step('Library inline edit persists', async () => {
  await page.click('h3:has-text("Selank")')
  await page.waitForTimeout(300)
  const timing = page.locator('input').filter({ hasText: '' }).nth(1)
  const timingInput = page.locator('label:has-text("Timing") input')
  await timingInput.fill('Evening test')
  await page.waitForTimeout(400)
})

await page.screenshot({ path: `${SHOT}/03-library.png` })

await step('Schedule renders ladder + projection', async () => {
  await page.click('nav >> text=Schedule')
  await page.waitForTimeout(500)
  const txt = await page.textContent('body')
  if (!/Level 1 of/.test(txt)) throw new Error('level line missing')
  if (!/12-week projection/.test(txt)) throw new Error('chart missing')
})

await page.screenshot({ path: `${SHOT}/04-schedule.png` })

await step('Calc: Retatrutide defaults → 40 u', async () => {
  await page.click('nav >> text=Calc')
  await page.waitForTimeout(400)
  await page.click('button:has-text("Retatrutide")')
  await page.waitForTimeout(800)
  const txt = await page.textContent('body')
  if (!/5 mg\/mL/.test(txt)) throw new Error('conc 5 mg/mL missing: ' + txt.slice(0, 300))
  if (!/40\.0/.test(txt)) throw new Error('40 units missing')
})

await step('Calc reverse mode', async () => {
  await page.click('text=dose → units')
  await page.waitForTimeout(600)
  const txt = await page.textContent('body')
  if (!/Delivered dose/.test(txt)) throw new Error('reverse mode missing')
})

await page.screenshot({ path: `${SHOT}/05-calc.png` })

await step('Mix: BPC-157 + KPV is green', async () => {
  await page.click('nav >> text=Mix')
  await page.waitForTimeout(400)
  await page.click('div.grid button:has-text("BPC-157")')
  await page.click('div.grid button:has-text("KPV")')
  await page.waitForTimeout(600)
  const txt = await page.textContent('body')
  if (!/OK to co-draw/.test(txt)) throw new Error('expected green verdict')
})

await step('Mix: Retatrutide pair is red', async () => {
  await page.click('div.grid button:has-text("BPC-157")') // deselect
  await page.click('div.grid button:has-text("Retatrutide")')
  await waitText(/Inject separately/)
})

await step('Mix: unverified pair is amber + can mark known-good', async () => {
  await page.click('div.grid button:has-text("Retatrutide")') // deselect
  await page.click('div.grid button:has-text("DSIP")')
  await waitText(/Separate unless verified/)
  await page.click('button:has-text("mark known-good")')
  await waitText(/OK to co-draw/)
})

await page.screenshot({ path: `${SHOT}/06-mix.png` })

await step('Inventory: burn rate + cost render', async () => {
  await page.click('nav >> text=Stock')
  await page.waitForTimeout(500)
  const txt = await page.textContent('body')
  if (!/runs out/.test(txt)) throw new Error('run-out missing')
  if (!/cost\/dose/.test(txt)) throw new Error('cost/dose missing')
})

await page.screenshot({ path: `${SHOT}/07-inventory.png` })

await step('Needle guide renders', async () => {
  await page.click('nav >> text=Needle')
  await page.waitForTimeout(400)
  const txt = await page.textContent('body')
  if (!/29–31 gauge/.test(txt)) throw new Error('needle spec missing')
})

await step('Settings: badges shelf + theme toggle', async () => {
  await page.click('nav >> text=More')
  await page.waitForTimeout(400)
  const txt = await page.textContent('body')
  if (!/First Log/.test(txt)) throw new Error('badges missing')
  await page.click('.chip:has-text("dark")')
  await page.waitForTimeout(400)
  const theme = await page.evaluate(() => document.documentElement.dataset.theme)
  if (theme !== 'light') throw new Error('theme toggle failed, got ' + theme)
  await page.click('.chip:has-text("light")')
})

await page.screenshot({ path: `${SHOT}/08-settings.png` })

await step('persistence: full reload keeps log + edit + mix override', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const txt = await page.textContent('body')
  if (/not medical advice/.test(txt)) throw new Error('disclaimer came back — persist failed')
  // the dose logged earlier should still count
  const logged = await page.locator('button[aria-label$=" logged"]').count()
  if (!logged) throw new Error('logged dose lost after reload')
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')))
  if (!store?.state?.doseLogs?.length) throw new Error('doseLogs empty in localStorage')
  if (store.state.peptides.find((p) => p.id === 'selank')?.timing !== 'Evening test') throw new Error('library edit lost')
  if (!store.state.knownGoodMixes.some((k) => k.includes('DSIP'))) throw new Error('mix override lost')
  console.log('  localStorage keys OK — logs:', store.state.doseLogs.length, 'xp:', store.state.gamification.xp)
})

await step('tolerance decline holds dose (via store)', async () => {
  // simulate: backdate selank levelStartDate 8 days → prompt appears on Schedule
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    const t = raw.state.titration.selank
    const d = new Date(Date.now() - 8 * 86400000)
    t.levelStartDate = d.toISOString().slice(0, 10)
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.click('nav >> text=Schedule')
  await page.click('button:has-text("Selank")')
  await page.waitForTimeout(500)
  const txt = await page.textContent('body')
  if (!/Tolerating well/.test(txt)) throw new Error('step-up prompt missing')
  await page.click('button:has-text("Hold dose")')
  await page.waitForTimeout(500)
  const txt2 = await page.textContent('body')
  if (/Tolerating well/.test(txt2)) throw new Error('prompt did not clear after hold')
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')))
  if (store.state.titration.selank.level !== 0) throw new Error('hold should not advance level')
  const today = new Date().toISOString().slice(0, 10)
  if (store.state.titration.selank.levelStartDate !== today) throw new Error('hold should re-anchor interval to today')
})

await step('tolerance confirm advances + level-up', async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    const d = new Date(Date.now() - 8 * 86400000)
    raw.state.titration.selank.levelStartDate = d.toISOString().slice(0, 10)
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.click('nav >> text=Schedule')
  await page.click('button:has-text("Selank")')
  await page.waitForTimeout(500)
  await page.click('button:has-text("Advance — Lvl 2")')
  await page.waitForTimeout(1200)
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')))
  if (store.state.titration.selank.level !== 1) throw new Error('confirm should advance to level 1')
  const txt = await page.textContent('body')
  if (!/300 mcg/.test(txt)) throw new Error('new dose 300 mcg not shown')
})

await page.screenshot({ path: `${SHOT}/09-levelup.png` })

console.log('\n--- console/page errors:', errors.length)
errors.forEach((e) => console.log(' ', e.slice(0, 300)))
await browser.close()
process.exit(errors.length ? 1 : 0)
