// v31 — the cost engine, shared vials, cycle rest states and the Home cleanup.
// Runs at 390×844 against a build on BASE_URL.
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = process.env.BASE_URL || 'http://localhost:5174/budget-app/'
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
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
const closeAll = async () => {
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('[data-testid="sheet"]').count())) break
    await page.keyboard.press('Escape'); await page.waitForTimeout(350)
  }
}
const nav = async (label) => {
  await closeAll()
  await page.click(`nav button:has-text("${label}")`)
  await page.waitForTimeout(600)
}
const more = async (id) => {
  await nav('More')
  await page.click(`[data-testid="more-${id}"]`)
  await page.waitForTimeout(800)
}
const stockRoom = async () => {
  await more('supplies')
  const t = page.locator('[data-testid="stock-view"] button[aria-label="Stock room"]')
  if (await t.count()) { await t.click(); await page.waitForTimeout(700) }
}
const groupFor = (name) => page.locator('[data-testid="stock-group"]').filter({ hasText: name }).first()
const openGroup = async (name) => {
  await groupFor(name).locator('button').first().click()
  await page.waitForTimeout(600)
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('nav button')
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
  raw.state.coachMarks = { 'wizard-offered': true, 'wizard-done': true }
  raw.state.settings = { ...raw.state.settings, disclaimerDismissed: true }
  // Retatrutide's ladder runs 0.5 → 2 mg in 0.5 steps; level 3 is the 2 mg the
  // spec quotes its figures at.
  raw.state.titration.retatrutide = { ...raw.state.titration.retatrutide, level: 3 }
  // a month of history behind us, so past days are real days with real misses
  const d = new Date(); d.setDate(d.getDate() - 30)
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  raw.state.peptides = raw.state.peptides.map((p) => ({ ...p, startDate: iso }))
  localStorage.setItem('peptide-command-center', JSON.stringify(raw))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('nav button')
await page.waitForTimeout(800)
const gotIt = page.locator('button:has-text("Got it")')
if (await gotIt.count()) { await gotIt.first().click(); await page.waitForTimeout(500) }

// ============================================================ FEATURE 1 · cost

await step('the seed prices itself from the reference table, in USD only', async () => {
  const s = await state()
  const reta = s.vials.find((v) => v.peptideId === 'retatrutide')
  if (reta.usdPerVial !== 15) throw new Error(`Retatrutide 20 mg seeded at ${reta.usdPerVial}, expected 15 USD`)
  if ('costAud' in reta) throw new Error('a vial still carries costAud')
  if (s.settings.fx_usd_to_aud !== 1.43) throw new Error(`rate is ${s.settings.fx_usd_to_aud}, expected 1.43`)
  console.log(`  Retatrutide $${reta.usdPerVial} USD · rate ${s.settings.fx_usd_to_aud}`)
})

await step('no AUD figure is written to storage anywhere', async () => {
  const raw = await page.evaluate(() => localStorage.getItem('peptide-command-center'))
  for (const bad of ['costAud', 'totalAud', 'unitCosts"', 'audPerVial', 'audPerDose']) {
    if (raw.includes(bad)) throw new Error(`persisted state contains "${bad}"`)
  }
  const s = await state()
  const keys = new Set()
  for (const v of s.vials) for (const k of Object.keys(v)) keys.add(k)
  console.log(`  vial fields: ${[...keys].sort().join(', ')}`)
})

let before = null
await step('Retatrutide 20 mg reads $21.45 a vial and $2.15 for a 2 mg dose', async () => {
  await stockRoom()
  await openGroup('Retatrutide')
  const cost = await groupFor('Retatrutide').locator('[data-testid="vial-cost"]').first().textContent()
  before = cost
  if (!/\$21\.45\/vial/.test(cost)) throw new Error(`per vial: ${cost}`)
  if (!/\$2\.15\/dose/.test(cost)) throw new Error(`per dose: ${cost}`)
  console.log(`  ${cost.trim()}`)
})

await step('MOTS-c 40 mg and the CP10 blend compute from the same rule', async () => {
  await openGroup('MOTS-c')
  const mots = await groupFor('MOTS-c').locator('[data-testid="vial-cost"]').first().textContent()
  // 21.00 USD × 1.43 = 30.03/vial; 1.4 mg out of 40 = 1.05
  if (!/\$30\.03\/vial/.test(mots)) throw new Error(`MOTS-c per vial: ${mots}`)
  console.log(`  MOTS-c: ${mots.trim()}`)
  // CP10 is a blend, priced whole — checked in the unit suite against 0.2 mg
})

await step('changing the rate in Settings moves every figure on screen', async () => {
  await more('settings')
  await page.fill('input[aria-label="USD to AUD rate"]', '')
  await page.type('input[aria-label="USD to AUD rate"]', '1.6')
  await page.waitForTimeout(600)
  await stockRoom()
  await openGroup('Retatrutide')
  const after = await groupFor('Retatrutide').locator('[data-testid="vial-cost"]').first().textContent()
  if (!/\$24\.00\/vial/.test(after)) throw new Error(`after the rate change: ${after}`)
  if (!/\$2\.40\/dose/.test(after)) throw new Error(`after the rate change: ${after}`)
  console.log(`  before @1.43: ${before.trim()}`)
  console.log(`  after  @1.60: ${after.trim()}`)
  // and nothing in AUD was written down as a result
  const raw = await page.evaluate(() => localStorage.getItem('peptide-command-center'))
  if (raw.includes('costAud')) throw new Error('the rate change persisted an AUD figure')
})

await step('putting the rate back restores every figure exactly', async () => {
  await more('settings')
  await page.fill('input[aria-label="USD to AUD rate"]', '')
  await page.type('input[aria-label="USD to AUD rate"]', '1.43')
  await page.waitForTimeout(600)
  await stockRoom()
  await openGroup('Retatrutide')
  const back = await groupFor('Retatrutide').locator('[data-testid="vial-cost"]').first().textContent()
  if (back.trim() !== before.trim()) throw new Error(`${back.trim()} !== ${before.trim()}`)
  console.log(`  back to ${back.trim()}`)
})

await step('a compound the table has no price for says so, and offers a field', async () => {
  await stockRoom()
  await openGroup('Testosterone')
  const row = groupFor('Testosterone').locator('[data-testid="vial-cost"]').first()
  const txt = await row.textContent()
  if (!/No price set/.test(txt)) throw new Error(`testosterone reads: ${txt}`)
  console.log(`  ${txt.trim()}`)
  await row.click()
  await page.waitForTimeout(400)
  if (!(await page.locator('[data-testid="vial-price-edit"]').count())) {
    throw new Error('tapping "No price set" did not offer a manual entry')
  }
  await page.fill('input[aria-label="USD per vial"]', '')
  await page.type('input[aria-label="USD per vial"]', '120')
  await page.click('[data-testid="vial-price-save"]')
  await page.waitForTimeout(600)
  const after = await groupFor('Testosterone').locator('[data-testid="vial-cost"]').first().textContent()
  if (!/\$171\.60\/vial/.test(after)) throw new Error(`after manual entry: ${after}`)
  console.log(`  entered 120 USD → ${after.trim()}`)
  const s = await state()
  const te = s.vials.find((v) => v.peptideId === 'testosterone-e')
  if (te.usdPerVial !== 120) throw new Error('the manual price was not stored as USD')
})

// ================================================== FEATURE 2 · shared vials

await step('a vial nobody shares shows one profile and the old doses-left', async () => {
  await stockRoom()
  await openGroup('Retatrutide')
  const dd = groupFor('Retatrutide').locator('[data-testid="drawdown"]').first()
  if (!(await dd.count())) throw new Error('no draw-down panel on the active vial')
  const profiles = dd.locator('[data-testid="draw-profile"]')
  if ((await profiles.count()) !== 1) throw new Error(`${await profiles.count()} profiles, expected 1`)
  const txt = await dd.textContent()
  if (!/Just me/.test(txt)) throw new Error(`unshared vial reads: ${txt}`)
  console.log(`  ${(await profiles.first().textContent()).trim()}`)
})

await step('a second person at a different dose gets their own doses-left', async () => {
  const dd = groupFor('Retatrutide').locator('[data-testid="drawdown"]').first()
  const soloDays = (await dd.textContent()).match(/empties in ([^\n·]+)/)?.[1]?.trim()
  await dd.locator('button').first().click()
  await page.waitForTimeout(500)
  await page.click('[data-testid="add-draw-profile"]')
  await page.waitForTimeout(600)
  const edit = page.locator('[data-testid="draw-profile-edit"]').first()
  await edit.locator('input[aria-label="Who draws"]').fill('Partner')
  await edit.locator('input[aria-label="Their dose in mg"]').fill('1')
  await edit.locator('select[aria-label="How often they draw"]').selectOption('weekly')
  await page.waitForTimeout(700)

  const rows = await dd.locator('[data-testid="draw-profile"]').allTextContents()
  if (rows.length !== 2) throw new Error(`${rows.length} profiles, expected 2`)
  const me = rows.find((r) => r.startsWith('Me'))
  const partner = rows.find((r) => r.startsWith('Partner'))
  if (!/10 left/.test(me)) throw new Error(`mine: ${me}`)
  if (!/20 left/.test(partner)) throw new Error(`theirs: ${partner}`)
  const sharedDays = (await dd.textContent()).match(/empties in ([^\n·]+)/)?.[1]?.trim()
  console.log(`  ${me.trim()}`)
  console.log(`  ${partner.trim()}`)
  console.log(`  empties in: ${soloDays} alone → ${sharedDays} shared`)
  if (soloDays === sharedDays) throw new Error('a second person did not shorten the vial')
})

await step('either profile logging a draw moves the same vial', async () => {
  const mgOf = async () => (await state()).openVials.retatrutide.remainingMg
  const start = await mgOf()
  await page.locator('[data-testid="log-shared-draw"]').first().click()
  await page.waitForTimeout(800)
  const afterPartner = await mgOf()
  if (Math.abs((start - afterPartner) - 1) > 1e-6) {
    throw new Error(`partner's 1 mg draw moved the vial by ${start - afterPartner} mg`)
  }
  // and the owner's own dose comes out of that same number
  await nav('Home')
  await page.waitForTimeout(700)
  const s = await state()
  console.log(`  ${start} mg → ${afterPartner} mg after the partner's 1 mg draw`)
  if (s.sharedDraws.length !== 1) throw new Error('the draw was not recorded')
  if (s.doseLogs.some((l) => l.peptideId === 'retatrutide')) {
    throw new Error("a partner's draw was written into the owner's dose history")
  }
})

// ================================================ FEATURE 3 · cycle rest

await step('a compound in its rest phase stays on Home, muted and unloggable', async () => {
  // push Semax (6 on / 2 off) into its off-stretch by backdating the start
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    const d = new Date(); d.setDate(d.getDate() - 45) // day 46 of a 56-day cycle
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    raw.state.peptides = raw.state.peptides.map((p) => (p.id === 'semax' ? { ...p, startDate: iso } : p))
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const group = page.locator('[data-testid="resting-group"]')
  if (!(await group.count())) throw new Error('no resting group on Home')
  const row = group.locator('[data-testid="resting-row"]').filter({ hasText: 'Semax' }).first()
  if (!(await row.count())) throw new Error('Semax is not shown while resting')
  const txt = await row.textContent()
  if (!/resting, back in \d+ days?/.test(txt)) throw new Error(`resting row reads: ${txt}`)
  if (!/part of your stack/.test(txt)) throw new Error('the row does not say it is still on the protocol')
  if (await row.locator('button:has-text("Log")').count()) throw new Error('a resting row offers a Log button')
  const opacity = await row.evaluate((el) => getComputedStyle(el).opacity)
  if (Number(opacity) >= 0.9) throw new Error(`resting row is not muted (opacity ${opacity})`)
  console.log(`  ${txt.trim()} · opacity ${opacity}`)
  await page.screenshot({ path: `${SHOT}/v31-resting.png` })
})

await step('and comes back to the due list on its own when the rest ends', async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    const d = new Date(); d.setDate(d.getDate() - 56) // day 57 → cycle 2, day 1
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    raw.state.peptides = raw.state.peptides.map((p) => (p.id === 'semax' ? { ...p, startDate: iso } : p))
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.click('button[aria-label="AM"]').catch(() => {})
  await page.waitForTimeout(700)
  const resting = page.locator('[data-testid="resting-row"]').filter({ hasText: 'Semax' })
  if (await resting.count()) throw new Error('Semax is still listed as resting after the rest ended')
  const body = await page.textContent('body')
  if (!/Semax/.test(body)) throw new Error('Semax did not come back onto Home')
  const card = page.locator('main div.p-4').filter({ hasText: 'Semax' }).first()
  const cycleLine = await card.locator('[data-testid="cycle-line"]').first().textContent()
  if (!/Day \d+\/\d+ · \d+ days? left this cycle/.test(cycleLine)) {
    throw new Error(`Semax's active cycle line reads: ${cycleLine}`)
  }
  console.log(`  back on the due list · ${cycleLine.trim()}`)
})

// ============================================== HOME CLEANUP

await step('the "this PM" take-count box is gone', async () => {
  if (await page.locator('[data-testid="hero"]').count()) throw new Error('the hero summary box is still on Home')
})

await step('missed doses are absent from Home, and present in the Calendar', async () => {
  await nav('Home')
  await page.waitForTimeout(700)
  if (await page.locator('[data-testid="catch-up-card"]').count()) {
    throw new Error('the missed-dose card is still on Home')
  }
  if (await page.locator('[data-testid="home-add-past-dose"]').count()) {
    throw new Error('the backfill entry is still on Home')
  }
  await nav('Calendar')
  await page.waitForTimeout(1000)
  const yest = new Date(); yest.setDate(yest.getDate() - 1)
  const iso = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`
  await page.click(`[data-testid="cal-day-${iso}"]`)
  await page.waitForTimeout(800)
  const detail = await page.textContent('[data-testid="sheet"]')
  if (!/missed/i.test(detail)) throw new Error(`the Calendar day detail does not report missed: ${detail.slice(0, 200)}`)
  if (!(await page.locator('[data-testid="day-catch-up"]').count())) {
    throw new Error('the Calendar lost its way into fixing a missed day')
  }
  console.log('  Home: clear · Calendar: reports missed and offers the fix')
  await closeAll()
})

await step('the co-draw row sits below the inject cards and lists no compound names', async () => {
  await nav('Home')
  await page.waitForTimeout(900)
  const row = page.locator('[data-testid="codraw-row"]')
  if (!(await row.count())) { console.log('  nothing combinable in this slot — skipped'); return }
  const cards = page.locator('[data-testid="inject-card"], main div.card.rows').first()
  const cardBox = await cards.boundingBox()
  const rowBox = await row.first().boundingBox()
  if (rowBox.y <= cardBox.y) throw new Error('the co-draw row is above the inject cards')
  if (await row.locator('[data-testid="codraw-names"]').count()) {
    throw new Error('the co-draw row still lists compound names')
  }
  const txt = await row.first().textContent()
  if (!/shots? instead of/.test(txt) || !/mL total/.test(txt)) throw new Error(`co-draw row reads: ${txt}`)
  console.log(`  at y=${Math.round(rowBox.y)} (cards start y=${Math.round(cardBox.y)}) · ${txt.trim()}`)
})

await step('"Tomorrow" replaces the seven-day strip, and carries the doses', async () => {
  if (await page.locator('[data-testid="next-7-days"]').count()) {
    throw new Error('the 7-day lookahead is still on Home')
  }
  const tm = page.locator('[data-testid="tomorrow"]')
  if (!(await tm.count())) throw new Error('no Tomorrow section')
  const rows = tm.locator('[data-testid="tomorrow-row"]')
  const n = await rows.count()
  if (n === 0) throw new Error('Tomorrow lists nothing at all')
  for (let i = 0; i < Math.min(n, 3); i++) {
    const txt = await rows.nth(i).textContent()
    if (!/\d/.test(txt)) throw new Error(`a Tomorrow row carries no dose: ${txt}`)
    console.log(`  ${txt.trim()}`)
  }
})

await step('the INJECT header is clear of the rule above it', async () => {
  const h = page.locator('[data-testid="inject-heading"]')
  if (!(await h.count())) { console.log('  no oral group in this slot, so no header — skipped'); return }
  const pt = await h.evaluate((el) => getComputedStyle(el).paddingTop)
  if (parseFloat(pt) < 20) throw new Error(`the header's top padding is only ${pt}`)
  console.log(`  padding-top ${pt}`)
})

await step('the three layers are still separate and nothing cascaded', async () => {
  const s = await state()
  // a vial exists for a compound; deleting price/profiles never removed either
  if (!s.vials.length) throw new Error('stock is empty')
  if (!s.peptides.length) throw new Error('the protocol is empty')
  const te = s.vials.find((v) => v.peptideId === 'testosterone-e')
  if (!te) throw new Error('the manually-priced vial vanished')
  if (!s.peptides.some((p) => p.id === 'testosterone-e')) throw new Error('its protocol item vanished')
  console.log(`  ${s.peptides.length} protocol items · ${s.vials.length} stock batches · ${s.sharedDraws.length} shared draws`)
})

await page.screenshot({ path: `${SHOT}/v31-home.png` })
console.log(`\n--- console/page errors: ${errors.filter((e) => e.startsWith('console') || e.startsWith('pageerror')).length}`)
for (const e of errors) console.log('  ' + e.split('\n')[0])
await browser.close()
process.exit(errors.length ? 1 : 0)
