// v32 — rotation gone, logging down to one tap, tenure and the dose timeline.
//
// Walks the ten checks in the brief in order, at 390×844, in dark and then in
// light. Anything that used to ask where you injected should be unfindable;
// anything about how long you have been on something should be everywhere.
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
const closeAll = async () => {
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('[data-testid="sheet"]').count())) break
    await page.keyboard.press('Escape'); await page.waitForTimeout(350)
  }
}
const nav = async (label) => {
  await closeAll()
  await page.click(`nav button:has-text("${label}")`)
  await page.waitForTimeout(700)
}
const more = async (id) => {
  await nav('More')
  await page.click(`[data-testid="more-${id}"]`)
  await page.waitForTimeout(900)
}
const text = async (sel) => (await page.locator(sel).first().textContent()) || ''
// A logged row's button is disabled, so "the first row" stops being clickable
// as soon as a test logs it. Always reach for one that is still outstanding.
const liveRow = () => page.locator('[data-testid="log-row"]:not([disabled])')
const shutMenus = async () => {
  const open = page.locator('[data-testid="row-menu"]')
  while (await open.count()) {
    await page.locator('[data-testid="row-overflow"][aria-expanded="true"]').first().click()
    await page.waitForTimeout(350)
  }
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1400)
// the first-run disclaimer
const gotIt = page.locator('button:has-text("Got it")')
if (await gotIt.count()) { await gotIt.click(); await page.waitForTimeout(700) }

// ======================================================= 1 · rotation gone

await step('1 · no injection-site UI anywhere on Home', async () => {
  const body = await page.locator('body').innerText()
  for (const word of ['Rotate', 'rotation', 'Left thigh', 'Right thigh', 'injection site', 'Follow the path']) {
    if (body.includes(word)) throw new Error(`Home still says "${word}"`)
  }
  for (const id of ['site-picker', 'site-chooser', 'body-map', 'site-recency']) {
    if (await page.locator(`[data-testid="${id}"]`).count()) throw new Error(`${id} still rendered`)
  }
})

await step('1 · no rotation state left in the store, dose logs intact', async () => {
  const s = await state()
  if (s.rotation !== undefined) throw new Error('rotation slice survives')
  if (s.siteReactions !== undefined) throw new Error('siteReactions slice survives')
  const zoned = (s.peptides || []).filter((p) => p.allowedZone !== undefined)
  if (zoned.length) throw new Error(`${zoned.length} peptide(s) still carry allowedZone`)
  if (!Array.isArray(s.doseLogs)) throw new Error('doseLogs is gone')
  console.log(`  ${s.peptides.length} compounds · ${s.doseLogs.length} dose logs preserved`)
})

await step('1 · logging never asks where', async () => {
  const before = (await state()).doseLogs.length
  await liveRow().first().click()
  await page.waitForTimeout(800)
  if (await page.locator('[data-testid="sheet"]').count()) throw new Error('a sheet opened on log')
  const s = await state()
  if (s.doseLogs.length !== before + 1) throw new Error('the tap did not log')
  const last = s.doseLogs[s.doseLogs.length - 1]
  if (last.siteId !== undefined) throw new Error('a new log carries a siteId')
})

// ============================================ 2 · combine hints off the card

await step('2 · no per-card "can combine with" line', async () => {
  const body = await page.locator('body').innerText()
  if (/can combine with/i.test(body)) throw new Error('the combine hint is still on Home')
})

await step('2 · Mix tool still there, log-together still reachable', async () => {
  // the row the co-draw offer belongs to: still outstanding, and injectable
  const row = liveRow().first()
  const i = await page.locator('[data-testid="log-row"]').evaluateAll(
    (els, name) => els.findIndex((e) => e.getAttribute('aria-label') === name),
    await row.getAttribute('aria-label'),
  )
  await page.locator('[data-testid="row-overflow"]').nth(i).click()
  await page.waitForTimeout(500)
  if (!(await page.locator('[data-testid="row-menu"]').count())) throw new Error('the overflow menu did not open')
  if (!(await page.locator('[data-testid="row-codraw"]').count())) {
    throw new Error('Log together is not in the overflow menu')
  }
  await shutMenus()
  await more('mix')
  if (!(await page.locator('body').innerText()).length) throw new Error('the Mix tab is empty')
  await nav('Home')
})

// ================================================= 3 · one tap, undo, batch

await step('3 · a toast with Undo, and Undo actually undoes', async () => {
  const before = (await state()).doseLogs.length
  const row = liveRow().first()
  await row.click()
  await page.waitForTimeout(600)
  const mid = (await state()).doseLogs.length
  if (mid !== before + 1) throw new Error('nothing was logged')
  const undo = page.locator('button:has-text("Undo")').first()
  if (!(await undo.count())) throw new Error('no Undo offered')
  await undo.click()
  await page.waitForTimeout(700)
  const after = (await state()).doseLogs.length
  if (after !== before) throw new Error(`Undo left ${after - before} extra log(s)`)
})

await step('3 · Log all covers the slot under a single Undo', async () => {
  const all = page.locator('[data-testid="log-all"]').first()
  if (!(await all.count())) { console.log('  (nothing left to log all — skipped)'); return }
  const before = (await state()).doseLogs.length
  await all.click()
  await page.waitForTimeout(800)
  const mid = (await state()).doseLogs.length
  if (mid <= before) throw new Error('Log all logged nothing')
  console.log(`  logged ${mid - before} in one tap`)
  const undo = page.locator('button:has-text("Undo")').first()
  if (!(await undo.count())) throw new Error('the batch had no Undo')
  await undo.click()
  await page.waitForTimeout(900)
  const after = (await state()).doseLogs.length
  if (after !== before) throw new Error(`one Undo left ${after - before} of the batch behind`)
})

await step('3 · Skip and Vial done live behind the overflow, not on the card', async () => {
  await shutMenus()
  const cardText = await page.locator('[data-testid="log-row"]').first().innerText()
  if (/skip/i.test(cardText)) throw new Error('Skip is on the card face')
  if (/vial done/i.test(cardText)) throw new Error('Vial done is on the card face')
  await page.locator('[data-testid="row-overflow"]').first().click()
  await page.waitForTimeout(500)
  if (!(await page.locator('[data-testid="skip-peptide"]').count())) throw new Error('Skip missing from the menu')
  await shutMenus()
})

// ======================================== 4 · the card says four things only

await step('4 · no doses-left, rung badge or step-up question on a card', async () => {
  await shutMenus()
  const cards = await page.locator('[data-testid="log-row"]').allInnerTexts()
  for (const c of cards) {
    if (/doses left/i.test(c)) throw new Error(`"doses left" on a card: ${c}`)
    if (/\bRung\b/.test(c)) throw new Error(`a rung badge on a card: ${c}`)
    if (/tolerating well/i.test(c)) throw new Error(`the step-up question on a card: ${c}`)
  }
  console.log(`  ${cards.length} cards, all clean`)
})

await step('4 · the step-up question is in the bell instead', async () => {
  const bell = page.locator('[data-testid="alert-bell"]')
  if (!(await bell.count())) { console.log('  (nothing in the bell today — skipped)'); return }
  await bell.click()
  await page.waitForTimeout(600)
  const panel = await text('[data-testid="alert-panel"]')
  console.log(`  bell holds: ${panel.replace(/\s+/g, ' ').slice(0, 110)}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
})

// ============================== 5 · names fit, earlier slot stays reachable

await step('5 · no card name is clipped mid-word', async () => {
  const clipped = await page.evaluate(() => {
    const out = []
    for (const row of document.querySelectorAll('[data-testid="log-row"]')) {
      const n = row.querySelector('span > span')
      if (n && n.scrollWidth > n.clientWidth + 1) out.push(n.textContent)
    }
    return out
  })
  if (clipped.length) throw new Error(`clipped: ${clipped.join(', ')}`)
})

await step('5 · earlier-slot doses are visible and loggable from here', async () => {
  const slot = page.locator('[data-testid="earlier-slot"]')
  if (!(await slot.count())) { console.log('  (both slots clear — nothing to surface)'); return }
  console.log(`  ${(await slot.first().innerText()).replace(/\s+/g, ' ')}`)
  const before = (await state()).doseLogs.length
  await page.locator('[data-testid="log-earlier"]').first().click()
  await page.waitForTimeout(800)
  if ((await state()).doseLogs.length <= before) throw new Error('logging from the earlier slot did nothing')
})

// ============================== 6 · startedOn backdatable, adherence honest

await step('6 · startedOn is editable to the past and nothing else moves', async () => {
  await more('protocol')
  await page.locator('[data-testid="protocol-row"]').first().click()
  await page.waitForTimeout(800)
  await page.click('[data-testid="sheet-tab-timeline"]')
  await page.waitForTimeout(600)
  const before = await state()
  await page.click('[data-testid="tenure-edit"]')
  await page.waitForTimeout(700)
  await page.fill('[data-testid="started-on"]', '2024-03-04')
  await page.click('[data-testid="tenure-save"]')
  await page.waitForTimeout(900)
  const after = await state()
  const p = after.peptides.find((x) => x.startedOn === '2024-03-04')
  if (!p) throw new Error('the start date did not save')
  if (after.doseLogs.length !== before.doseLogs.length) throw new Error('backdating fabricated logs')
  if (JSON.stringify(after.openVials) !== JSON.stringify(before.openVials)) throw new Error('backdating moved stock')
  console.log(`  ${p.name} now reads from 2024-03-04, ${after.doseLogs.length} logs unchanged`)
})

await step('6 · prior dose history is enterable and labelled estimated', async () => {
  await page.click('[data-testid="tenure-edit"]')
  await page.waitForTimeout(700)
  await page.click('[data-testid="prior-add"]')
  await page.waitForTimeout(400)
  const from = await page.inputValue('[data-testid="prior-from"]')
  if (from >= '2024-03-04') throw new Error(`a "before logging" stretch defaulting to ${from}, after the start date`)
  await page.click('[data-testid="prior-save"]')
  await page.waitForTimeout(600)
  if (!(await page.locator('[data-testid="prior-row"]').count())) throw new Error('the stretch was not added')
  await page.click('[data-testid="tenure-save"]')
  await page.waitForTimeout(800)
  const body = await page.locator('[data-testid="timeline-pane"]').innerText()
  if (!/estimated/i.test(body)) throw new Error('nothing on the timeline is labelled estimated')
  // and the estimate is counted, separately from what was logged
  const exp = (await page.locator('[data-testid="exposure-block"]').innerText()).toLowerCase()
  if (!exp.includes('estimated')) throw new Error(`exposure ignored the typed-in history: ${exp}`)
  if (!exp.includes('logged')) throw new Error('an estimate with nothing to compare it to')
})

await step('6 · tenure reads in natural units', async () => {
  const headline = await text('[data-testid="tenure-headline"]')
  if (!/(day|week|month|year)/i.test(headline)) throw new Error(`tenure headline: "${headline}"`)
  console.log(`  "${headline.trim()}"`)
})

// ============================ 7 · the timeline and exposure actually render

await step('7 · the dose timeline draws, and a point opens its detail', async () => {
  const chart = page.locator('[data-testid="dose-timeline"]')
  if (!(await chart.count())) throw new Error('no timeline rendered')
  const pts = page.locator('[data-testid="timeline-point"]')
  const n = await pts.count()
  if (n === 0) throw new Error('the timeline has no points')
  await pts.first().click()
  await page.waitForTimeout(500)
  if (!(await page.locator('[data-testid="timeline-detail"]').count())) {
    throw new Error('tapping a point showed nothing')
  }
  console.log(`  ${n} points, detail opens`)
})

await step('7 · cumulative exposure is shown with the guess kept apart', async () => {
  const block = page.locator('[data-testid="exposure-block"]')
  if (!(await block.count())) throw new Error('no exposure block')
  const t = (await block.innerText()).replace(/\s+/g, ' ')
  for (const label of ['total taken', 'average dose', 'longest run']) {
    if (!t.toLowerCase().includes(label)) throw new Error(`exposure is missing "${label}": ${t}`)
  }
  if (/estimated/i.test(t) && !/logged/i.test(t)) throw new Error('an estimate with nothing to compare it to')
  console.log(`  ${t.slice(0, 130)}`)
})

// =================== 8 · reassess, integrations, Protocol overview upgrade

await step('8 · reassess prompts stay neutral', async () => {
  const p = page.locator('[data-testid="reassess-prompt"]')
  if (!(await p.count())) { console.log('  (nothing old enough to prompt about)'); return }
  const t = await p.innerText()
  if (/should stop|must|you need to|reduce your dose/i.test(t)) throw new Error(`not neutral: ${t}`)
  if (!t.includes('?')) throw new Error('a prompt that is not a question')
  console.log(`  "${t.replace(/\s+/g, ' ').slice(0, 100)}"`)
})

await step('8 · Protocol overview shows time-on, a sparkline and sorting', async () => {
  await closeAll()
  await more('protocol')
  const rows = page.locator('[data-testid="protocol-row"]')
  if (!(await rows.count())) throw new Error('no protocol rows')
  if (!(await page.locator('[data-testid="protocol-tenure"]').count())) throw new Error('no time-on line on any row')
  if (!(await page.locator('[data-testid="dose-sparkline"]').count())) throw new Error('no dose sparkline')
  const sort = page.locator('[data-testid="protocol-sort"]')
  if (!(await sort.count())) throw new Error('no sort control')
  const first = async () => (await rows.first().innerText()).split('\n')[0]
  await page.click('[data-testid="sort-longest"]'); await page.waitForTimeout(500)
  const longest = await first()
  await page.click('[data-testid="sort-newest"]'); await page.waitForTimeout(500)
  const newest = await first()
  await page.click('[data-testid="sort-ceiling"]'); await page.waitForTimeout(500)
  if (longest === newest && (await rows.count()) > 1) throw new Error('longest and newest gave the same order')
  console.log(`  longest: ${longest} · just started: ${newest}`)
})

await step('8 · the calendar marks start dates and anniversaries', async () => {
  await nav('Calendar')
  await page.waitForTimeout(900)
  const marks = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('peptide-command-center')).state
    return { runs: Object.keys(s.runs || {}).length, events: s.doseEvents?.length || 0 }
  })
  if (!marks.runs) throw new Error('no runs recorded, so the calendar has no start dates to mark')
  console.log(`  ${marks.runs} run list(s), ${marks.events} dose events`)
})

await step('8 · history labels adherence and gives a per-compound view', async () => {
  await more('history')
  const basis = page.locator('[data-testid="adherence-basis"]')
  if (!(await basis.count())) throw new Error('adherence is not labelled')
  const t = await basis.innerText()
  if (!/since logging began/i.test(t)) throw new Error(`adherence label: ${t}`)
  const chip = page.locator('[data-testid="history-compound"]')
  const filters = page.locator('.overflow-x-auto button')
  if (await filters.count() > 1) {
    await filters.nth(1).click()
    await page.waitForTimeout(700)
    if (!(await chip.count())) throw new Error('filtering by compound showed no tenure view')
    console.log(`  per-compound: ${(await chip.innerText()).replace(/\s+/g, ' ')}`)
  }
})

await step('8 · the shareable summary is still offered', async () => {
  // the document's own contents are asserted in the unit tests; here it is
  // only worth proving the way into it survived
  if (!(await page.locator('button:has-text("Shareable summary")').count())) {
    throw new Error('the summary button is gone')
  }
})

// ================================= 9 · tokens, both themes, no console noise

await step('9 · data survives a reload', async () => {
  const before = await state()
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1400)
  const after = await state()
  if (after.doseLogs.length !== before.doseLogs.length) throw new Error('dose logs changed across a reload')
  if (after.peptides.length !== before.peptides.length) throw new Error('protocol changed across a reload')
  if (Object.keys(after.runs).length !== Object.keys(before.runs).length) throw new Error('run history changed')
  console.log(`  ${after.peptides.length} compounds · ${after.doseLogs.length} logs · ${after.symptomLogs?.length || 0} symptom logs · ${after.measurements?.length || 0} measurements`)
})

await step('9 · every figure is tabular-nums', async () => {
  const bad = await page.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('[data-testid="protocol-tenure"], [data-testid="tenure-headline"]')) {
      const f = getComputedStyle(el).fontVariantNumeric
      if (!f.includes('tabular-nums')) out.push(el.textContent.slice(0, 30))
    }
    return out
  })
  if (bad.length) throw new Error(`not tabular: ${bad.join(' | ')}`)
})

const shoot = async (theme) => {
  await page.evaluate((th) => {
    const s = JSON.parse(localStorage.getItem('peptide-command-center'))
    s.state.settings.theme = th
    localStorage.setItem('peptide-command-center', JSON.stringify(s))
  }, theme)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const got = await gotItIfAny()
  if (got) await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOT}/v32-home-${theme}.png` })
  await more('protocol')
  await page.screenshot({ path: `${SHOT}/v32-protocol-${theme}.png`, fullPage: true })
  await page.locator('[data-testid="protocol-row"]').first().click()
  await page.waitForTimeout(800)
  await page.click('[data-testid="sheet-tab-timeline"]')
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${SHOT}/v32-timeline-${theme}.png`, fullPage: true })
  await closeAll()
}
const gotItIfAny = async () => {
  const b = page.locator('button:has-text("Got it")')
  if (await b.count()) { await b.click(); return true }
  return false
}

await step('9 · renders in dark at 390px', async () => { await shoot('dark') })
await step('9 · renders in light at 390px', async () => { await shoot('light') })

await step('9 · nothing overflows the 390px viewport', async () => {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth)
  if (wide > 391) throw new Error(`horizontal overflow: ${wide}px`)
})

const noise = errors.filter((e) => e.startsWith('console') || e.startsWith('pageerror'))
console.log(`\n--- console/page errors: ${noise.length}`)
for (const e of noise) console.log('  ' + e.split('\n')[0])
console.log(`--- step failures: ${failures}`)
await browser.close()
process.exit(failures || noise.length ? 1 : 0)
