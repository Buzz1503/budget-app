import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = process.env.BASE_URL || 'http://localhost:5177'
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
const waitText = async (re, timeout = 6000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) { if (re.test(await page.textContent('body'))) return true; await page.waitForTimeout(150) }
  throw new Error('timeout waiting for ' + re)
}
const openAdd = async () => {
  await page.click('nav button:has-text("More")')
  await page.click('text=Library')
  await waitText(/Retatrutide/)
  await page.click('button:has-text("Add")')
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.click('text=Got it')

await step('Add opens a searchable picker of all 86 compounds', async () => {
  await openAdd()
  await page.waitForFunction(() => document.querySelectorAll('div.max-h-\\[46vh\\] > button').length === 86, null, { timeout: 8000 })
  const ph = await page.getAttribute('input[placeholder*="Search"]', 'placeholder')
  if (!/86 compounds/.test(ph)) throw new Error(`picker placeholder should name 86 compounds, got "${ph}"`)
})
await page.screenshot({ path: `${SHOT}/v5-01-picker.png` })

await step('search-as-you-type filters the list', async () => {
  await page.fill('input[placeholder*="Search"]', 'tb-500')
  await page.waitForTimeout(300)
  const rows = await page.locator('div.max-h-\\[46vh\\] > button').count()
  if (rows === 0 || rows > 5) throw new Error(`search should narrow the list, got ${rows} rows`)
  await waitText(/TB-500/)
  // class search works too
  await page.fill('input[placeholder*="Search"]', 'glp1')
  await page.waitForTimeout(300)
  if ((await page.locator('div.max-h-\\[46vh\\] > button').count()) === 0) throw new Error('class search returned nothing')
})

await step('already-added compounds show as Added and are disabled', async () => {
  await page.fill('input[placeholder*="Search"]', 'selank')
  await page.waitForTimeout(300)
  await waitText(/Added/)
  const btn = page.locator('div.max-h-\\[46vh\\] > button', { hasText: 'Selank' }).first()
  if (!(await btn.isDisabled())) throw new Error('already-added compound should be disabled')
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state.peptides.length)
  await btn.click({ force: true }).catch(() => {})
  await page.waitForTimeout(300)
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state.peptides.length)
  if (after !== before) throw new Error('duplicate was added')
})

await step('selecting a compound adds it with name + id and blank protocol', async () => {
  await page.fill('input[placeholder*="Search"]', 'tb-500')
  await page.waitForTimeout(300)
  await page.locator('div.max-h-\\[46vh\\] > button', { hasText: /^TB-500 \(Thymosin/ }).first().click()
  await page.waitForTimeout(700)
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  const p = s.peptides.find((x) => x.id === 'tb500')
  if (!p) throw new Error('tb500 not added with its compound id')
  if (!/TB-500/.test(p.name)) throw new Error('name not carried')
  if (p.compoundClass == null || p.charge == null) throw new Error('class/charge not carried')
  // no fabricated dosing
  if (p.ladder.floor !== 0 || p.ladder.ceiling !== 0) throw new Error('ladder was fabricated')
  if (p.recon.vialMg !== 0 || p.recon.bacMl !== 0) throw new Error('recon was fabricated')
  if (!s.titration.tb500 || !s.openVials.tb500) throw new Error('titration/openVials not keyed by the compound id')
  // and it opened straight to its protocol fields
  await waitText(/Set your protocol/)
})
await page.screenshot({ path: `${SHOT}/v5-02-added.png` })

await step('new peptide resolves in the Mix tab (no "no data")', async () => {
  await page.click('nav button[aria-label="More"]')
  await page.waitForTimeout(320)
  await page.click('text=Can these two share a syringe')
  await waitText(/Compatibility Codex/)
  await page.click('button:has-text("TB-500")')
  await page.click('button:has-text("BPC-157")')
  await waitText(/(Safe to mix|Mix with caution|Don't mix|Never co-administer)/)
  const txt = await page.textContent('body')
  if (/No data for this pair/.test(txt)) throw new Error('Mix says no data for the newly added compound')
  if (!/Proven blend/.test(txt)) throw new Error('BPC-157 + TB-500 should carry the proven-blend seal')
})
await page.screenshot({ path: `${SHOT}/v5-03-mix.png` })

await step('unconfigured peptide stays out of the Home due list', async () => {
  await page.click('nav button:has-text("Home")')
  await page.waitForTimeout(400)
  if (await page.locator('button[aria-label="Select TB-500 (Thymosin Beta-4 Acetate) to co-draw"]').count()) {
    throw new Error('unconfigured peptide should not be due')
  }
})

await step('after setting the protocol it becomes due and co-draw works', async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    const p = raw.state.peptides.find((x) => x.id === 'tb500')
    p.ladder = { floor: 250, step: 250, intervalWeeks: 2, ceiling: 500, unit: 'mcg' }
    p.recon = { vialMg: 10, bacMl: 2, expiryDays: 28 }
    p.slot = 'AM'
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.click('button:has-text("AM")')
  await page.waitForTimeout(400)
  await waitText(/TB-500/)
  // co-draw it with BPC-157 (proven blend → should sail through to the site picker)
  await page.click('button[aria-label="Select TB-500 (Thymosin Beta-4 Acetate) to co-draw"]')
  await page.click('button[aria-label="Select BPC-157 to co-draw"]')
  await page.click('button:has-text("Log together")')
  await waitText(/pick one spot/i)
  await page.click('button:has-text("Log 2 together")')
  await page.waitForTimeout(800)
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  const cd = s.doseLogs.filter((l) => l.coDrawId)
  if (cd.length !== 2) throw new Error(`expected 2 co-draw logs, got ${cd.length}`)
  if (!cd.some((l) => l.peptideId === 'tb500')) throw new Error('new peptide did not log')
  if (new Set(cd.map((l) => l.siteId)).size !== 1) throw new Error('co-draw split across sites')
})
await page.screenshot({ path: `${SHOT}/v5-04-codraw.png` })

await step('custom fallback still works and blocks duplicate names', async () => {
  await openAdd()
  await page.click('button:has-text("Custom")')
  await page.fill('input[placeholder*="My blend"]', 'My Special Blend')
  await page.click('button:has-text("Add to stack")')
  await page.waitForTimeout(600)
  let s = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  if (!s.peptides.some((p) => p.name === 'My Special Blend')) throw new Error('custom peptide not added')
  // duplicate name is refused
  await openAdd()
  await page.click('button:has-text("Custom")')
  await page.fill('input[placeholder*="My blend"]', 'My Special Blend')
  await waitText(/already in your Library/)
  const disabled = await page.locator('button:has-text("Add to stack")').isDisabled()
  if (!disabled) throw new Error('duplicate custom name should be blocked')
  await page.click('[aria-label="Close"]')
})

await step('persistence: added peptides survive reload', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  if (!s.peptides.some((p) => p.id === 'tb500')) throw new Error('tb500 lost')
  if (!s.peptides.some((p) => p.name === 'My Special Blend')) throw new Error('custom lost')
  console.log('  peptides:', s.peptides.length, '| doseLogs:', s.doseLogs.length)
})

console.log('\n--- console/page errors:', errors.length)
errors.forEach((e) => console.log(' ', e.slice(0, 200)))
await browser.close()
process.exit(errors.length ? 1 : 0)
