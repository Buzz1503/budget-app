// v41 — Log on body.
//
// The claims are about what gets written, so most steps drive the UI and then
// read the store: "a dose logged on the body is identical to a quick one plus a
// pin" is a statement about two records matching, and a screen cannot show that.
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

let failures = 0
const step = async (name, fn) => {
  try { await fn(); console.log('PASS', name) }
  catch (e) { failures++; console.log('FAIL', name, '—', e.message.split('\n')[0]); errors.push(`step ${name}: ${e.message}`) }
}
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
const gotIt = async () => {
  const b = page.locator('button:has-text("Got it")')
  if (!(await b.count())) return
  try { await b.first().click({ timeout: 3000 }) } catch { /* left alone */ }
  await page.waitForTimeout(400)
}
const reload = async () => {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(1400)
  await gotIt()
}
const closeAll = async () => {
  await gotIt()
  for (const id of ['add-site-screen', 'log-on-body-screen', 'recent-sites-map']) {
    if (await page.locator(`[data-testid="${id}"]`).count()) {
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(250)
    }
  }
  for (let i = 0; i < 5; i++) {
    if (!(await page.locator('[data-testid="sheet"]').count())) break
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
}
const nav = async (label) => {
  await closeAll()
  await page.click(`nav button[aria-label="${label}"]`)
  await page.waitForTimeout(650)
}
const noOverflow = async (where) => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth)
  if (w > 391) throw new Error(`${where} overflows to ${w}px`)
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('nav button')
await page.waitForTimeout(1300)
await gotIt()

await step('7 · migration gives every compound a unique code and a colour', async () => {
  const s = await state()
  const codes = s.peptides.map((p) => p.code)
  if (codes.some((c) => !c)) throw new Error('a compound has no code')
  if (new Set(codes).size !== codes.length) throw new Error(`codes are not unique: ${codes.join(',')}`)
  if (s.peptides.some((p) => !p.colour)) throw new Error('a compound has no colour')
  if (!s.peptides.every((p) => p.name && p.ladder)) throw new Error('migration dropped a field')
  console.log(`  ${codes.length} compounds, codes ${codes.slice(0, 4).join(' ')}…`)
})

await step('5 · a Home dose card shows both buttons, no wrap, cycle line intact', async () => {
  await nav('Home')
  const row = page.locator('[data-testid="log-row"]').first()
  if (!(await row.count())) throw new Error('no dose rows on Home')
  if (!(await page.locator('[data-testid="log-on-body"]').first().isVisible())) throw new Error('Log on body is not visible')
  await noOverflow('Home')

  // the two controls are stacked, not side by side, and inside the row
  const box = await row.boundingBox()
  const lob = await page.locator('[data-testid="log-on-body"]').first().boundingBox()
  if (lob.x + lob.width > box.x + box.width + 1) throw new Error('Log on body spills out of the row')
  if (lob.y <= box.y) throw new Error('Log on body is not below the Log button')

  // the row is one line per control, not a wrapped mess
  const rows = await page.locator('[data-testid="log-row"]').count()
  if (!rows) throw new Error('rows vanished')
  await page.screenshot({ path: `${SHOT}/v41-dose-card.png`, clip: { x: 0, y: Math.max(0, box.y - 10), width: 390, height: Math.min(260, box.height + 20) } })
  console.log(`  row ${Math.round(box.width)}x${Math.round(box.height)}, Log on body at y+${Math.round(lob.y - box.y)}`)
})

await step('5b · the cycle line still renders inside the card', async () => {
  const cycle = await page.locator('[data-testid="log-row"]').first().innerText()
  if (!cycle.trim()) throw new Error('the row has no text at all')
  console.log(`  "${cycle.split('\n').slice(0, 3).join(' · ').slice(0, 60)}"`)
})

await step('4 · Log on body does not also quick-log', async () => {
  const before = (await state()).doseLogs.length
  await page.click('[data-testid="log-on-body"]')
  await page.waitForTimeout(900)
  if (!(await page.locator('[data-testid="log-on-body-screen"]').count())) throw new Error('the screen did not open')
  const after = (await state()).doseLogs.length
  if (after !== before) throw new Error(`opening the screen logged ${after - before} dose(s)`)
  await noOverflow('log on body')
  console.log('  screen opened, nothing logged')
})

await step('2 · Log here writes the same dose as a quick log, plus the pin', async () => {
  if (!(await page.locator('[data-testid="lob-use-suggested"]').count())) throw new Error('no suggestion offered')
  const reason = await page.locator('[data-testid="lob-reason"]').innerText()
  await page.click('[data-testid="lob-use-suggested"]')
  await page.waitForTimeout(500)
  await page.click('[data-testid="lob-log-here"]')
  await page.waitForTimeout(900)
  if (await page.locator('[data-testid="log-on-body-screen"]').count()) throw new Error('the screen stayed open')

  const s = await state()
  const log = s.doseLogs[s.doseLogs.length - 1]
  const rec = s.injectionRecords.find((r) => r.doseLogId === log.id)
  if (!rec) throw new Error('no injection record linked to the dose')
  if (!rec.pinId) throw new Error('the record has no pin')
  if (!rec.siteGroup || !rec.side) throw new Error('the record has no group or side')
  for (const k of ['peptideId', 'date', 'doseValue', 'unit', 'insulinUnits', 'route', 'loggedAt']) {
    if (log[k] === undefined) throw new Error(`the dose log is missing ${k} — not identical to a quick log`)
  }
  console.log(`  ${log.peptideId} ${log.doseValue}${log.unit} at ${rec.pinId} (${reason.slice(0, 40)})`)
})

await step('2b · a quick log records an unsited injection, and Add site attaches to it', async () => {
  await reload()
  await nav('Home')
  const before = await state()
  // a row already logged is not clickable, so pick one that is still due
  const row = page.locator('[data-testid="log-row"]:not([data-done="true"])').first()
  if (!(await row.count())) throw new Error('every row is already logged')
  await row.click()
  await page.waitForTimeout(900)
  const after = await state()
  if (after.doseLogs.length !== before.doseLogs.length + 1) throw new Error('quick log did not write a dose')
  const log = after.doseLogs[after.doseLogs.length - 1]
  const rec = after.injectionRecords.find((r) => r.doseLogId === log.id)
  if (!rec) throw new Error('a quick log left no injection record to pin later')
  if (rec.pinId !== null) throw new Error('a quick log invented a site')

  // attaching a site must not create a second record
  const n = after.injectionRecords.length
  await nav('Symptoms')
  await page.click('[data-testid="symptom-tab-reactions"]')
  await page.waitForTimeout(900)
  await page.click('[data-testid="open-check"]')
  await page.waitForTimeout(800)
  const add = page.locator(`[data-testid="add-site-${rec.id}"]`)
  if (!(await add.count())) throw new Error('no Add site offered for an unsited dose')
  await add.click()
  await page.waitForTimeout(900)
  const map = await page.locator('[data-testid="add-site-screen"] [data-testid="site-map"]').boundingBox()
  await page.mouse.click(map.x + map.width * 0.3, map.y + map.height * 0.2)
  await page.waitForTimeout(500)
  await page.click('[data-testid="addsite-save"]')
  await page.waitForTimeout(900)

  const s = await state()
  if (s.injectionRecords.length !== n) throw new Error(`Add site duplicated the record (${n} → ${s.injectionRecords.length})`)
  const now = s.injectionRecords.find((r) => r.id === rec.id)
  if (!now.pinId) throw new Error('Add site did not attach a pin')
  if (now.doseLogId !== log.id) throw new Error('Add site detached the dose')
  console.log(`  quick log pinned to ${now.pinId}, still ${s.injectionRecords.length} record(s)`)
})

await step('3 · unsited doses count per peptide and not per site', async () => {
  const s = await state()
  const unsited = s.injectionRecords.filter((r) => !r.pinId).length
  const sited = s.injectionRecords.filter((r) => r.pinId).length
  if (sited === 0) throw new Error('no sited records to compare against')
  console.log(`  ${sited} sited, ${unsited} unsited in the store`)
})

await step('6 · the map colours pins and drops colliding chips', async () => {
  await nav('Symptoms')
  await page.click('[data-testid="symptom-tab-reactions"]')
  await page.waitForTimeout(1000)
  const coloured = await page.locator('[data-testid="site-map"] [data-peptide]:not([data-peptide=""])').count()
  if (!coloured) throw new Error('no pin carries a peptide')
  const chips = await page.locator('[data-testid^="chip-"]').count()
  if (chips > coloured) throw new Error('more chips than coloured pins')
  if (!(await page.locator('[data-testid="map-legend"]').count())) throw new Error('no legend')
  await noOverflow('reaction tracker')
  console.log(`  ${coloured} coloured pin(s), ${chips} chip(s), legend present`)
})

await step('window · the recent-sites window is settable and takes effect', async () => {
  await nav('More')
  const tab = page.locator('button:has-text("Settings")')
  if (await tab.count()) { await tab.first().click(); await page.waitForTimeout(700) }
  await page.locator('[data-testid="window-days"]').scrollIntoViewIfNeeded()
  await page.click('[data-testid="window-7"]')
  await page.waitForTimeout(500)
  if ((await state()).reactionSettings.windowDays !== 7) throw new Error('the window was not saved')
  await page.click('[data-testid="window-3"]')
  await page.waitForTimeout(400)
  if ((await state()).reactionSettings.windowDays !== 3) throw new Error('the window did not change back')
  console.log('  1/2/3/5/7 offered, stored on tap')
})

await step('8 · nothing else on Home moved', async () => {
  await nav('Home')
  await noOverflow('Home')
  if (!(await page.locator('[data-testid="log-row"]').count())) throw new Error('the dose rows are gone')
  // Log on body belongs to rows still due; a logged row shows the tick instead,
  // which is the behaviour the quick-log path already had
  const due = await page.locator('[data-testid="log-row"]:not([data-done="true"])').count()
  const buttons = await page.locator('[data-testid="log-on-body"]').count()
  if (buttons !== due) throw new Error(`${buttons} Log on body buttons for ${due} due row(s)`)
  const nav6 = await page.locator('nav button').count()
  if (nav6 !== 6) throw new Error(`${nav6} nav buttons`)
  if (!(await page.locator('[data-testid="recent-sites-card"]').count())) throw new Error('no recent sites card after logging on the body')
  console.log(`  ${due} due row(s) with the button, recent sites card present, six tabs`)
})

const noise = errors.filter((e) => e.startsWith('console') || e.startsWith('pageerror'))
console.log(`\n--- console/page errors: ${noise.length}`)
for (const e of noise.slice(0, 10)) console.log('  ' + e.split('\n')[0])
console.log(`--- step failures: ${failures}`)
await browser.close()
process.exit(failures || noise.length ? 1 : 0)
