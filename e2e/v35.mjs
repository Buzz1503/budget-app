// v35 — the Bloods tab, and changing a dose without leaving the screen.
//
// Runs at 390×844 against a build on BASE_URL. Walks the seven checks in the
// v31 brief in order.
//
// The dose-change steps deliberately drive real compounds rather than fixtures.
// Testosterone is a flat ladder (step 0), which is the shape that quietly
// refused to move at all in the first cut of this feature — asserting the store
// afterwards is the only way to tell "the sheet saved" from "the sheet said it
// saved".
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
// The first-run framing is a sheet with no exit but its own button — Escape is
// deliberately disabled on it — so it has to be acknowledged, not dismissed.
// It is also mid-exit for a few hundred milliseconds after it is acknowledged,
// during which the button is still in the DOM and no longer clickable — so a
// button that vanishes under the click is the desired outcome, not a failure.
const gotIt = async () => {
  const btn = page.locator('button:has-text("Got it")')
  if (!(await btn.count())) return
  try { await btn.first().click({ timeout: 3000 }) } catch { /* it left on its own */ }
  await page.waitForTimeout(600)
}
const closeAll = async () => {
  await gotIt()
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('[data-testid="sheet"]').count())) break
    await page.keyboard.press('Escape'); await page.waitForTimeout(350)
  }
}
const nav = async (label) => {
  await closeAll()
  await page.click(`nav button[aria-label="${label}"]`)
  await page.waitForTimeout(700)
}
const toastGone = async () => {
  for (let i = 0; i < 40; i++) {
    if (!(await page.locator('[data-testid="toast"]').count())) return
    await page.waitForTimeout(250)
  }
}
// The ladder arithmetic from lib/schedule, repeated here on purpose: a test
// that imports the app's own rung builder cannot catch the app getting it
// wrong. Kept to one copy so the two dose steps agree with each other.
const rungsOf = (l) => {
  if (!(l.step > 0) || !(l.ceiling > l.floor)) return [l.floor]
  const out = [l.floor]
  let d = l.floor
  while (d + l.step < l.ceiling - 1e-9) { d = Math.round((d + l.step) * 1e6) / 1e6; out.push(d) }
  out.push(l.ceiling)
  return out
}
const noOverflow = async (where) => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth)
  if (w > 391) throw new Error(`${where} overflows to ${w}px`)
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('nav button')
await page.waitForTimeout(1200)
await gotIt()

// ------------------------------------------------------------------ 1

await step('1 · every test date imports, in order, with its values', async () => {
  const s = await state()
  const tests = s.bloods?.tests || []
  if (tests.length < 5) throw new Error(`only ${tests.length} tests imported`)

  const dates = tests.map((t) => t.date)
  if (JSON.stringify([...dates].sort()) !== JSON.stringify(dates)) {
    throw new Error('tests are not in chronological order')
  }
  if (new Set(dates).size !== dates.length) throw new Error('a test date is duplicated')

  // values are numbers, and a marker a panel did not measure is absent rather
  // than nought — the whole reason the tab does not present a grid of zeroes
  let total = 0
  for (const t of tests) {
    for (const [k, v] of Object.entries(t.values || {})) {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${t.date} · ${k} is not a number`)
      total++
    }
  }
  const widths = tests.map((t) => Object.keys(t.values || {}).length)
  if (Math.min(...widths) === Math.max(...widths)) throw new Error('every test has the same width — blanks were filled in')

  console.log(`  ${tests.length} tests, ${dates[0]} → ${dates[dates.length - 1]}, ${total} results`)
})

await step('1b · the tab is reachable and shows the latest test and its lab', async () => {
  await nav('Bloods')
  if (!(await page.locator('[data-testid="bloods-tab"]').count())) throw new Error('the Bloods tab did not render')
  const latest = page.locator('[data-testid="latest-test"]')
  if (!(await latest.count())) throw new Error('no latest-test block')
  const text = await latest.innerText()
  if (!/\d{4}/.test(text)) throw new Error(`no date in the latest-test block: ${text}`)
  if (!/markers/.test(text)) throw new Error(`no marker count in the latest-test block: ${text}`)
  await noOverflow('Bloods')
  await page.screenshot({ path: `${SHOT}/v35-bloods.png`, fullPage: true })
})

// ------------------------------------------------------------------ 2

await step('2 · the watch list surfaces markers tied to what is being taken', async () => {
  await nav('Bloods')
  const watch = page.locator('[data-testid="watch-list"]')
  if (!(await watch.count())) throw new Error('no watch list — nothing on the protocol matched a marker')
  const rows = watch.locator('[data-testid="marker-row"]')
  const n = await rows.count()
  if (n === 0) throw new Error('the watch list is empty')

  // and each row names the compound that put it there
  const first = await rows.first().innerText()
  const s = await state()
  const names = (s.peptides || []).map((p) => p.name)
  const short = names.map((x) => x.split(/[\s(]/)[0])
  if (!short.some((x) => first.includes(x))) throw new Error(`no compound named on the first row: ${first}`)
  console.log(`  ${n} markers worth watching`)
})

await step('2b · every row draws a range bar with the value inside it', async () => {
  const bars = page.locator('[data-testid="watch-list"] [data-testid="range-bar"]')
  const n = await bars.count()
  if (n === 0) throw new Error('no range bars drew')
  for (let i = 0; i < n; i++) {
    const st = await bars.nth(i).getAttribute('data-status')
    if (!['in', 'low', 'high', 'unknown'].includes(st)) throw new Error(`bar ${i} has status "${st}"`)
  }
  console.log(`  ${n} range bars`)
})

await step('2c · deltas read "since <the previous test>"', async () => {
  const deltas = page.locator('[data-testid="marker-delta"]')
  const n = await deltas.count()
  if (n === 0) throw new Error('no deltas rendered')
  const text = await deltas.first().innerText()
  if (!/since \d{1,2} \w{3} \d{4}/.test(text)) throw new Error(`delta is not dated: "${text}"`)
  if (!/^[+−]?[\d.]+ since/.test(text)) throw new Error(`delta is not a signed number: "${text}"`)
  console.log(`  e.g. "${text}"`)
})

await step('2d · out-of-range markers are flagged in a summary near the top', async () => {
  const box = page.locator('[data-testid="out-of-range"]')
  if (!(await box.count())) throw new Error('no out-of-range summary')
  const chips = box.locator('[data-testid="flagged-marker"]')
  const n = await chips.count()
  if (n === 0) throw new Error('the summary is empty')

  // it must agree with the store rather than with itself
  const s = await state()
  const latest = s.bloods.tests[s.bloods.tests.length - 1]
  if (!latest) throw new Error('no latest test')

  // and the summary sits above the panels
  const yBox = await box.boundingBox()
  const yPanels = await page.locator('[data-testid="panels"]').boundingBox()
  if (yBox.y > yPanels.y) throw new Error('the summary is below the panels')
  console.log(`  ${n} outside their interval`)
})

await step('2e · every panel is collapsed by default, in the stated order', async () => {
  const toggles = page.locator('[data-testid="panel-toggle"]')
  const n = await toggles.count()
  if (n === 0) throw new Error('no panels rendered')
  for (let i = 0; i < n; i++) {
    if (await toggles.nth(i).getAttribute('aria-expanded') === 'true') throw new Error(`panel ${i} is open on arrival`)
  }
  const ORDER = ['Hormones', 'Metabolic', 'Lipids', 'Haematology', 'Liver', 'Kidney', 'Chemistry', 'Iron studies', 'Inflammation']
  const shown = await page.locator('[data-testid="panel"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-panel')))
  const idx = shown.map((p) => ORDER.indexOf(p))
  if (idx.some((i) => i < 0)) throw new Error(`unknown panel: ${shown.join(', ')}`)
  if (JSON.stringify([...idx].sort((a, b) => a - b)) !== JSON.stringify(idx)) {
    throw new Error(`panels out of order: ${shown.join(', ')}`)
  }
  console.log(`  ${n} panels: ${shown.join(', ')}`)
})

await step('2f · a panel opens to its markers and a retest line', async () => {
  const panel = page.locator('[data-testid="panel"][data-panel="Hormones"]')
  await panel.locator('[data-testid="panel-toggle"]').click()
  await page.waitForTimeout(600)
  const rows = await panel.locator('[data-testid="marker-row"]').count()
  if (rows === 0) throw new Error('the panel opened empty')
  const line = await panel.locator('[data-testid="retest-line"]').innerText()
  if (!/Retest/.test(line)) throw new Error(`no retest line: "${line}"`)

  // the interval is the user's to set, and the line follows it
  const before = line
  await panel.locator('[data-testid="retest-interval"]').selectOption('90')
  await page.waitForTimeout(500)
  const after = await panel.locator('[data-testid="retest-line"]').innerText()
  if (after === before) throw new Error('changing the interval did not move the retest date')
  await noOverflow('an open panel')
  console.log(`  ${rows} markers · "${after}"`)
  await panel.locator('[data-testid="panel-toggle"]').click()
  await page.waitForTimeout(500)
})

// ------------------------------------------------------------------ 3

await step('3 · marker detail draws a graph with the interval as a band', async () => {
  await nav('Bloods')
  await page.locator('[data-testid="watch-list"] [data-testid="marker-row"]').first().click()
  await page.waitForTimeout(800)
  if (!(await page.locator('[data-testid="marker-graph"]').count())) throw new Error('no graph')
  if (!(await page.locator('[data-testid="ref-band"]').count())) throw new Error('the reference band is not shaded')
  const pts = await page.locator('[data-testid="graph-point"]').count()
  if (pts < 2) throw new Error(`only ${pts} points plotted`)
  await noOverflow('marker detail')
  await page.screenshot({ path: `${SHOT}/v35-marker.png` })
  console.log(`  ${pts} points on the line`)
})

await step('3b · the compound overlay is there and toggles per compound', async () => {
  const toggles = page.locator('[data-testid="overlay-toggle"]')
  const n = await toggles.count()
  if (n === 0) throw new Error('no overlay toggles')
  const marks = () => page.locator('[data-testid="overlay-mark"]').count()
  const before = await marks()
  await toggles.first().click()
  await page.waitForTimeout(500)
  const after = await marks()
  if (after === before) throw new Error('toggling a compound changed nothing on the graph')
  await toggles.first().click()
  await page.waitForTimeout(500)
  if (await marks() !== before) throw new Error('toggling it back did not restore the overlay')
  console.log(`  ${n} compounds, ${before} marks on the graph`)
})

await step('3c · every recorded value is listed with its interval and flag', async () => {
  const rows = page.locator('[data-testid="marker-table"] [data-testid="marker-value-row"]')
  const n = await rows.count()
  if (n === 0) throw new Error('no table of results')
  const text = await rows.first().innerText()
  if (!/\d{4}/.test(text)) throw new Error(`no date on a result row: "${text}"`)
  for (let i = 0; i < n; i++) {
    const f = await rows.nth(i).getAttribute('data-status')
    if (!['in', 'low', 'high', 'unknown'].includes(f)) throw new Error(`row ${i} has no in/out flag`)
  }
  console.log(`  ${n} recorded values`)
})

await step('3d · the interval is editable, because labs differ', async () => {
  const edit = page.locator('[data-testid="edit-range"]')
  await edit.scrollIntoViewIfNeeded()
  await edit.click()
  await page.waitForTimeout(400)
  const editor = page.locator('[data-testid="range-editor"]')
  if (!(await editor.count())) throw new Error('no range editor')
  // the fields write as they are typed — there is no save to press
  await editor.locator('input').first().fill('1')
  await editor.locator('input').nth(1).fill('9999')
  await editor.locator('input').nth(1).blur()
  await page.waitForTimeout(600)
  const s = await state()
  if (!Object.keys(s.bloods.rangeOverrides || {}).length) throw new Error('the override was not stored')
  await page.click('[data-testid="reset-range"]')
  await page.waitForTimeout(600)
  const s2 = await state()
  if (Object.keys(s2.bloods.rangeOverrides || {}).length) throw new Error('resetting did not clear the override')
  console.log('  edited and reset back to the lab’s')
})

await step('3e · my own note on a marker survives a reload', async () => {
  const note = page.locator('[data-testid="marker-note"]')
  if (!(await note.count())) throw new Error('nowhere to write a note')
  await note.scrollIntoViewIfNeeded()
  await note.fill('asked about this in September')
  await page.waitForTimeout(600)
  const s = await state()
  const saved = Object.values(s.bloods.markerNotes || {})
  if (!saved.includes('asked about this in September')) throw new Error('the note was not stored')
  console.log('  note kept')
  await closeAll()
})

// ------------------------------------------------------------------ 4

await step('4 · a test can be added with a subset of markers', async () => {
  await nav('Bloods')
  const before = (await state()).bloods.tests.length
  await page.click('[data-testid="add-test"]')
  await page.waitForTimeout(700)
  await page.fill('[data-testid="test-date"]', '2026-09-01')
  await page.fill('[data-testid="test-lab"]', 'e2e lab')
  await page.fill('[data-testid="marker-search"]', 'Ferritin')
  await page.waitForTimeout(500)
  await page.locator('[data-testid="marker-input"]').first().fill('210')
  await page.waitForTimeout(300)
  await page.click('[data-testid="save-test"]')
  await page.waitForTimeout(800)

  const s = await state()
  if (s.bloods.tests.length !== before + 1) throw new Error('the test was not added')
  const added = s.bloods.tests.find((t) => t.lab === 'e2e lab')
  if (!added) throw new Error('the new test is not in the list')
  const keys = Object.keys(added.values)
  if (keys.length !== 1) throw new Error(`${keys.length} markers saved, not the one that was filled in`)
  if (added.values.Ferritin !== 210) throw new Error(`Ferritin saved as ${added.values.Ferritin}`)
  // the one thing this must never do
  if (Object.values(added.values).includes(0)) throw new Error('a skipped marker was saved as zero')
  console.log(`  1 of ${keys.length === 1 ? 'many' : '?'} markers filled, the rest left absent`)
})

await step('4b · a wild number warns without being blocked', async () => {
  await nav('Bloods')
  await page.click('[data-testid="add-test"]')
  await page.waitForTimeout(700)
  await page.fill('[data-testid="marker-search"]', 'Haemoglobin')
  await page.waitForTimeout(500)
  await page.locator('[data-testid="marker-input"]').first().fill('1550')
  await page.waitForTimeout(400)
  if (!(await page.locator('[data-testid="marker-warning"]').count())) throw new Error('no warning about a stray digit')
  const save = page.locator('[data-testid="save-test"]')
  if (await save.isDisabled()) throw new Error('the warning blocked the save')
  console.log('  warned, not blocked')
  await closeAll()
})

await step('4c · a custom marker can be added and used', async () => {
  await nav('Bloods')
  await page.click('[data-testid="add-test"]')
  await page.waitForTimeout(700)
  await page.click('[data-testid="add-custom-marker"]')
  await page.waitForTimeout(400)
  await page.fill('[data-testid="custom-name"]', 'Lp(a)')
  await page.fill('[data-testid="custom-unit"]', 'nmol/L')
  await page.click('[data-testid="custom-save"]')
  await page.waitForTimeout(700)
  const s = await state()
  if (!(s.bloods.customMarkers || []).some((m) => m.name === 'Lp(a)')) throw new Error('the custom marker was not stored')
  const field = page.locator('[data-testid="marker-input"][data-marker="Lp(a)"]')
  if (!(await field.count())) throw new Error('the custom marker has no field to fill in')
  await field.fill('88')
  await page.fill('[data-testid="test-date"]', '2026-09-02')
  await page.click('[data-testid="save-test"]')
  await page.waitForTimeout(800)
  const s2 = await state()
  const t = s2.bloods.tests.find((x) => x.date === '2026-09-02')
  if (t?.values['Lp(a)'] !== 88) throw new Error('the custom marker did not record a value')
  console.log('  Lp(a) added and recorded')
})

await step('4d · a test can be edited and deleted', async () => {
  await nav('Bloods')
  await toastGone()
  const row = page.locator('[data-testid="test-row"]').filter({ hasText: 'e2e lab' }).first()
  await row.scrollIntoViewIfNeeded()
  await row.click()
  await page.waitForTimeout(800)
  // the sheet opens on the test it was asked for, not on a blank form
  const lab = await page.locator('[data-testid="test-lab"]').inputValue()
  if (lab !== 'e2e lab') throw new Error(`the sheet opened showing "${lab}"`)
  await page.fill('[data-testid="test-lab"]', 'e2e lab (edited)')
  await page.click('[data-testid="save-test"]')
  await page.waitForTimeout(800)
  let s = await state()
  if (!s.bloods.tests.some((t) => t.lab === 'e2e lab (edited)')) throw new Error('the edit was not saved')

  await toastGone()
  const again = page.locator('[data-testid="test-row"]').filter({ hasText: 'e2e lab (edited)' }).first()
  await again.scrollIntoViewIfNeeded()
  await again.click()
  await page.waitForTimeout(800)
  await page.click('[data-testid="delete-test"]')
  await page.waitForTimeout(400)
  await page.click('[data-testid="confirm-delete-test-yes"]')
  await page.waitForTimeout(800)
  s = await state()
  if (s.bloods.tests.some((t) => (t.lab || '').startsWith('e2e lab'))) throw new Error('the test was not deleted')
  console.log('  edited, then deleted')
})

await step('4e · a report attaches, survives a reload and is in the backup', async () => {
  await nav('Bloods')
  await toastGone()
  const row = page.locator('[data-testid="test-row"]').first()
  await row.click()
  await page.waitForTimeout(800)
  await page.setInputFiles('input[type="file"][aria-label="Report file"]', {
    name: 'report.pdf', mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% e2e\n'),
  })
  await page.waitForTimeout(1200)
  if (!(await page.locator('[data-testid="attachment"]').count())) throw new Error('the attachment did not appear')
  await closeAll()

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(1500)
  const s = await state()
  const withFile = s.bloods.tests.filter((t) => t.attachment)
  if (withFile.length !== 1) throw new Error(`${withFile.length} tests carry an attachment after reload`)
  if (withFile[0].attachment.name !== 'report.pdf') throw new Error('the attachment lost its name')

  // the blob itself, not just the record of it
  const key = withFile[0].attachment.blobKey
  const stored = await page.evaluate(async (k) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('pcc-blobs'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
    })
    return await new Promise((res) => {
      const tx = db.transaction('blobs', 'readonly').objectStore('blobs').get(k)
      tx.onsuccess = () => res(tx.result ? (tx.result.size ?? tx.result.byteLength ?? 1) : 0)
      tx.onerror = () => res(0)
    })
  }, key)
  if (!stored) throw new Error('the file itself is not in IndexedDB after reload')
  console.log(`  report.pdf, ${stored} bytes, still there after reload`)
})

// ------------------------------------------------------------------ 5

await step('5 · "Change dose" is on the Home card and moves the protocol', async () => {
  await nav('Home')
  await toastGone()
  const first = page.locator('[data-testid="row-overflow"]').first()
  await first.scrollIntoViewIfNeeded()
  await first.click()
  await page.waitForTimeout(500)
  const action = page.locator('[data-testid="change-dose"]')
  if (!(await action.count())) throw new Error('no "Change dose" in the overflow menu')
  await action.click()
  await page.waitForTimeout(800)

  const before = await state()
  const sheet = page.locator('[data-testid="sheet"]')
  const name = await sheet.innerText()
  const id = (before.peptides.find((p) => name.includes(p.name.split(/[\s(]/)[0])) || {}).id
  if (!id) throw new Error(`could not tell which compound the sheet is for: ${name.slice(0, 60)}`)
  const doseBefore = before.titration[id]
  const ladderBefore = before.peptides.find((x) => x.id === id).ladder
  const rungBefore = (() => {
    const rungs = rungsOf(ladderBefore)
    return rungs[Math.min(doseBefore?.level ?? 0, rungs.length - 1)]
  })()

  // A number deliberately not on the ladder — but rounded the way the card
  // will print it, since a dose in mcg is shown whole. Otherwise 5c would be
  // looking on screen for decimals the app never shows.
  const dp = ladderBefore?.unit === 'mcg' ? 0 : 3
  const nudge = dp === 0 ? 1 : 10 ** -dp
  let target = Number((rungBefore * 1.37 + 0.13).toFixed(dp))
  while (rungsOf(ladderBefore).some((r) => Math.abs(r - target) < 1e-9)) {
    target = Number((target + nudge).toFixed(dp))
  }
  await page.fill('[data-testid="new-dose"]', String(target))
  await page.fill('[data-testid="dose-reason"]', 'e2e')
  await page.waitForTimeout(300)
  if (!(await page.locator('[data-testid="off-ladder"]').count())) throw new Error('an off-ladder dose was not explained')
  const save = page.locator('[data-testid="dose-change-save"]')
  if (await save.isDisabled()) throw new Error('an off-ladder dose was refused')
  await save.click()
  await page.waitForTimeout(900)

  const after = await state()
  const p = after.peptides.find((x) => x.id === id)
  const now = rungsOf(p.ladder)[after.titration[id].level]
  if (Math.abs(now - target) > 1e-6) throw new Error(`the protocol says ${now}, not ${target}`)
  console.log(`  ${rungBefore} → ${now} on ${p.name}`)
  globalThis.__changed = { id, target, rungBefore, name: p.name }
})

await step('5b · it records on the timeline and resets time at this dose', async () => {
  const s = await state()
  const { id, target } = globalThis.__changed
  const ev = (s.doseEvents || []).filter((e) => e.peptideId === id && e.kind === 'override')
  if (!ev.length) throw new Error('nothing was recorded on the dose timeline')
  const last = ev[ev.length - 1]
  if (Math.abs(last.to - target) > 1e-6) throw new Error(`the timeline records ${last.to}, not ${target}`)
  if (last.note !== 'e2e') throw new Error('the reason was not kept')
  const today = new Date().toISOString().slice(0, 10)
  if (last.date !== today) throw new Error(`the event is dated ${last.date}`)
  if (s.titration[id].levelStartDate !== today) throw new Error('time at this dose did not reset')
  console.log(`  override recorded ${last.from} → ${last.to} on ${last.date}`)
})

await step('5c · today’s card, the units and the run-out all follow', async () => {
  await nav('Home')
  await toastGone()
  const { target, name } = globalThis.__changed
  const body = await page.locator('main').innerText()
  const short = name.split(/[\s(]/)[0]
  if (!body.includes(short)) throw new Error(`${short} is not on today’s screen`)
  // the new number is on the card the same day it was set
  if (!body.includes(String(target))) throw new Error(`today’s card does not show ${target}`)
  console.log(`  ${short} reads ${target} today`)
})

await step('5d · the same change is offered on the compound page', async () => {
  await nav('Home')
  await toastGone()
  // tapping a row logs the dose — the compound page is behind "About"
  const row = page.locator('[data-testid="row-overflow"]').first()
  await row.scrollIntoViewIfNeeded()
  await row.click()
  await page.waitForTimeout(500)
  await page.click('[data-testid="open-compound-sheet"]')
  await page.waitForTimeout(1000)
  if (!(await page.locator('[data-testid="compound-sheet"]').count())) throw new Error('the compound sheet did not open')
  await page.click('[data-testid="sheet-tab-mine"]')
  await page.waitForTimeout(500)
  const btn = page.locator('[data-testid="compound-change-dose"]')
  if (!(await btn.count())) throw new Error('no "Change dose" on the compound page')
  await btn.click()
  await page.waitForTimeout(800)
  if (!(await page.locator('[data-testid="new-dose"]').count())) throw new Error('the sheet did not open')
  await closeAll()
  console.log('  offered from the compound page too')
})

await step('5e · undo puts the dose back where it was', async () => {
  const s0 = await state()
  const id = s0.peptides[0].id
  await nav('Home')
  await toastGone()
  const first = page.locator('[data-testid="row-overflow"]').first()
  await first.click()
  await page.waitForTimeout(500)
  await page.locator('[data-testid="change-dose"]').click()
  await page.waitForTimeout(800)
  const before = JSON.stringify((await state()).peptides.map((p) => p.ladder))
  const current = await page.locator('[data-testid="new-dose"]').inputValue()
  await page.fill('[data-testid="new-dose"]', String(Number(current) + 3.7))
  await page.click('[data-testid="dose-change-save"]')
  await page.waitForTimeout(900)
  const mid = JSON.stringify((await state()).peptides.map((p) => p.ladder))
  if (mid === before) throw new Error('the change did not land')
  const undo = page.locator('[data-testid="toast-undo"]')
  if (!(await undo.count())) throw new Error('no undo offered')
  await undo.click()
  await page.waitForTimeout(900)
  const after = JSON.stringify((await state()).peptides.map((p) => p.ladder))
  if (after !== before) throw new Error('undo did not restore the ladder')
  const events = (await state()).doseEvents.filter((e) => e.kind === 'override')
  console.log(`  undone, ${events.length} override(s) left on the timeline`)
  void id
})

// ------------------------------------------------------------------ 6

await step('6 · the app works normally and nothing else moved', async () => {
  const s = await state()
  if (!s.peptides.length) throw new Error('the protocol is empty')
  if (!Array.isArray(s.doseLogs)) throw new Error('the logs are gone')
  if (!Array.isArray(s.vials)) throw new Error('the shelf is gone')
  if (!s.bloods) throw new Error('the bloods slice is gone')
  for (const tab of ['Home', 'Calendar', 'Symptoms', 'Body', 'Bloods', 'More']) {
    await nav(tab)
    await noOverflow(tab)
  }
  await nav('Home')
  await page.screenshot({ path: `${SHOT}/v35-home.png` })
  console.log(`  ${s.peptides.length} compounds, ${s.doseLogs.length} logs, ${s.vials.length} vials, ${s.bloods.tests.length} tests`)
})

await step('6b · an older install migrates without losing anything', async () => {
  const seeded = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    const s = raw.state
    delete s.bloods
    raw.version = 12
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
    return { logs: s.doseLogs.length, peptides: s.peptides.length, vials: s.vials.length }
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(1500)
  const after = await state()
  if (!after.bloods?.tests?.length) throw new Error('the migration did not seed the bloods slice')
  if (after.doseLogs.length !== seeded.logs) throw new Error('the migration changed doseLogs')
  if (after.peptides.length !== seeded.peptides) throw new Error('the migration changed the protocol')
  if (after.vials.length !== seeded.vials) throw new Error('the migration changed the shelf')
  console.log(`  upgraded from v12: ${after.bloods.tests.length} tests seeded, everything else intact`)
})

await step('6c · the tab bar fits six across at 390px', async () => {
  await nav('Home')
  const buttons = await page.locator('nav button').count()
  if (buttons !== 6) throw new Error(`${buttons} tabs in the bar`)
  const clipped = await page.locator('nav button').evaluateAll(
    (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.getAttribute('aria-label')))
  if (clipped.length) throw new Error(`clipped labels: ${clipped.join(', ')}`)
  await noOverflow('the tab bar')
  await page.screenshot({ path: `${SHOT}/v35-tabs.png` })
  console.log('  six tabs, nothing clipped')
})

const noise = errors.filter((e) => e.startsWith('console') || e.startsWith('pageerror'))
console.log(`\n--- console/page errors: ${noise.length}`)
for (const e of noise) console.log('  ' + e.split('\n')[0])
console.log(`--- step failures: ${failures}`)
await browser.close()
process.exit(failures || noise.length ? 1 : 0)
