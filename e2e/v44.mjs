// v44 — importing blood results from a file, and exporting them.
//
// At 390x844. Most steps drive the real file input and then read the store,
// because the claims are about what was and was not written: nothing saved
// before confirming, a merge leaving existing values alone, a malformed file
// leaving the record exactly as it was. Backup and export go through the real
// buttons.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'

const BASE = process.env.BASE_URL || 'http://localhost:5174/budget-app/'
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const SEED = JSON.parse(readFileSync(new URL('../src/data/blood_results.json', import.meta.url), 'utf8'))
const MARKER = Object.fromEntries(SEED.markers.map((m) => [m.name, m]))
const SCHEMA = 'pepito-bloods-import/v1'

const errors = []
const browser = await chromium.launch({ executablePath: EXE })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

let failures = 0
const step = async (name, fn) => {
  try { await fn(); console.log('PASS', name) }
  catch (e) { failures++; console.log('FAIL', name, '—', e.message.split('\n')[0]); errors.push(`step ${name}: ${e.message}`) }
}

const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
const setState = (fn, arg) => page.evaluate(([f, a]) => {
  const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
  // eslint-disable-next-line no-new-func
  new Function('s', 'a', f)(raw.state, a)
  localStorage.setItem('peptide-command-center', JSON.stringify(raw))
}, [fn, arg])
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
const bloodsTab = async () => {
  await page.click('nav button[aria-label="Bloods"]'); await page.waitForTimeout(700)
}
const noOverflow = async (where) => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth)
  if (w > 391) throw new Error(`${where} overflows to ${w}px`)
}
const wrap = (result, extra = {}) => ({ schema: SCHEMA, result, ...extra })
const pickFile = async (name, content) => {
  const buffer = Buffer.from(typeof content === 'string' ? content : JSON.stringify(content))
  await page.setInputFiles('[data-testid="import-results-input"]', { name, mimeType: 'application/json', buffer })
  await page.waitForTimeout(700)
}
const row = (key) => page.locator(`[data-testid="import-row-${key}"]`)
const preview = () => page.locator('[data-testid="import-preview"]')
const cancelPreview = async () => {
  if (await preview().count()) { await page.click('[data-testid="import-cancel"]'); await page.waitForTimeout(400) }
}
const tests = async () => (await state()).bloods.tests
const T = MARKER.Testosterone

const NOT_BLOOD = ['peptides', 'vials', 'openVials', 'doseLogs', 'titration', 'doseEvents', 'skips', 'pushes', 'pauses', 'finishedVials', 'sharedDraws', 'runs', 'gearItems', 'supplements']
const outsideSnapshot = async () => {
  const s = await state()
  return JSON.stringify(Object.fromEntries(NOT_BLOOD.map((k) => [k, s[k]])))
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('nav button')
await page.waitForTimeout(1300)
await gotIt()
await bloodsTab()

const pristine = (await state()).bloods
const outsideBefore = await outsideSnapshot()
const resetBloods = async () => {
  await setState('s.bloods = a', pristine)
  await reload(); await bloodsTab()
}

// a date with nothing on it, and one that already has a test
const taken = new Set(SEED.results.map((r) => r.date))
const FREE = ['2026-08-10', '2026-07-01', '2026-06-01'].find((d) => !taken.has(d))
const existingTest = pristine.tests[pristine.tests.length - 1]
const mid = (name) => {
  const m = MARKER[name]
  return m.ref_low != null && m.ref_high != null ? Math.round(((m.ref_low + m.ref_high) / 2) * 100) / 100 : (m.ref_high ?? m.ref_low ?? 1)
}
// key order is not part of the data: the export follows the catalogue, the app's own
// record follows the order it was entered in
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v)
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))
const missingFrom = (t) => Object.keys(MARKER).find((n) => t.values[n] == null && MARKER[n].unit !== undefined && n !== 'Testosterone')

// =============================================== 1 · a preview, and nothing saved

await step('1 · Import opens a preview with every value shown, and nothing is saved', async () => {
  const file = wrap({
    date: FREE, lab: 'Imedical', ref: '404358', notes: 'Collected 07:12 AM.',
    Testosterone: 18, Haematocrit: 0.46, Oestradiol: 120, 'Example Marker': 5, 'Mystery Thing': 9,
  }, { new_markers: [{ name: 'Example Marker', panel: 'Hormones', unit: 'nmol/L', ref_low: 1, ref_high: 10 }] })
  await pickFile('results.json', file)
  if (!(await preview().count())) throw new Error('no preview opened')
  await noOverflow('preview')

  for (const j of [0, 1, 2, 3, 4]) {
    if (!(await row(`0:${j}`).count())) throw new Error(`value ${j + 1} is not in the preview`)
  }
  if ((await page.locator('[data-testid="import-date-text-0"]').innerText()) !== new Date(`${FREE}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(/,/g, '').replace(/^(\w+) (\d+) (\w+) (\d+)$/, '$1 $2 $3 $4')) {
    const shown = await page.locator('[data-testid="import-date-text-0"]').innerText()
    if (!/^\w+day \d{1,2} \w+ 2026$/.test(shown)) throw new Error(`the date reads "${shown}", not a full weekday-day-month-year`)
  }
  if ((await tests()).length !== pristine.tests.length) throw new Error('something was saved before confirming')

  // every row can be edited and excluded
  await page.fill('[data-testid="import-value-0:0"]', '21')
  await page.click('[data-testid="import-exclude-0:1"]')
  await page.waitForTimeout(300)
  if ((await row('0:1').getAttribute('data-excluded')) !== 'true') throw new Error('Exclude did not exclude the row')
  if ((await page.locator('[data-testid="import-value-0:0"]').inputValue()) !== '21') throw new Error('the edit did not stick')
  await page.click('[data-testid="import-exclude-0:1"]')
  await page.waitForTimeout(200)
  if ((await tests()).length !== pristine.tests.length) throw new Error('editing saved something')

  await cancelPreview()
  if ((await tests()).length !== pristine.tests.length) throw new Error('cancelling saved something')
  if (await preview().count()) throw new Error('the preview did not close')
  console.log('  5 values shown, editable and excludable; cancelling left the record untouched')
})

await step('2 · recognised, new and unrecognised are distinguished and counted', async () => {
  const file = wrap({
    date: FREE, Testosterone: 18, Haematocrit: 0.46, Oestradiol: 120, 'Example Marker': 5, 'Mystery Thing': 9,
  }, { new_markers: [{ name: 'Example Marker', panel: 'Hormones', unit: 'nmol/L', ref_low: 1, ref_high: 10 }] })
  await pickFile('results.json', file)
  const kinds = {}
  for (const j of [0, 1, 2, 3, 4]) kinds[j] = await row(`0:${j}`).getAttribute('data-kind')
  const want = { 0: 'recognised', 1: 'recognised', 2: 'recognised', 3: 'new', 4: 'unrecognised' }
  if (JSON.stringify(kinds) !== JSON.stringify(want)) throw new Error(`kinds are ${JSON.stringify(kinds)}`)
  const labels = await page.$$eval('[data-testid^="import-kind-"]', (els) => els.map((e) => e.textContent))
  if (JSON.stringify(labels) !== JSON.stringify(['Recognised', 'Recognised', 'Recognised', 'New marker', 'Unrecognised'])) throw new Error(`labels ${labels}`)
  const counts = await page.locator('[data-testid="import-counts"]').innerText()
  if (counts !== '5 values, 1 new marker, 1 unrecognised') throw new Error(`the count reads "${counts}"`)
  // three different treatments, not three shades of one
  const colours = await page.$$eval('[data-testid^="import-kind-"]', (els) => els.map((e) => getComputedStyle(e).color))
  if (new Set(colours).size < 3) throw new Error('the three kinds are not visually distinct')
  console.log(`  "${counts}"`)
})

await step('2b · an unrecognised name must be decided: add, map or skip', async () => {
  if (await page.locator('[data-testid="import-commit"]').isEnabled()) throw new Error('Import is live with an undecided marker')
  if (!/Decide what to do/.test(await page.locator('[data-testid="import-blockers"]').innerText())) throw new Error('the blocker does not say what to do')
  for (const id of ['add', 'map', 'skip']) {
    if (!(await page.locator(`[data-testid="import-res-0:4-${id}"]`).count())) throw new Error(`no "${id}" choice`)
  }
  // map it to an existing marker: it is judged against that marker
  await page.click('[data-testid="import-res-0:4-map"]')
  await page.selectOption('[data-testid="import-map-0:4"]', 'Prolactin')
  await page.waitForTimeout(300)
  if (!(await page.locator('[data-testid="import-commit"]').isEnabled())) throw new Error('mapping did not unblock the import')
  const range = await page.locator('[data-testid="import-range-0:4"]').innerText()
  if (!/range|High|Low/.test(range)) throw new Error(`a mapped row shows no range: "${range}"`)
  // skip it
  await page.click('[data-testid="import-res-0:4-skip"]'); await page.waitForTimeout(300)
  if ((await row('0:4').getAttribute('data-excluded')) !== 'true') throw new Error('Skip did not leave it out')
  // add it as a new marker, with a panel and unit
  await page.click('[data-testid="import-exclude-0:4"]').catch(() => {})
  await cancelPreview()
})

await step('2c · adding an unrecognised name creates the marker, and it is saved', async () => {
  await pickFile('results.json', wrap({ date: FREE, Testosterone: 18, 'Mystery Thing': 9 }))
  await page.click('[data-testid="import-res-0:1-add"]')
  await page.selectOption('[data-testid="import-def-panel-0:1"]', 'Lipids')
  await page.fill('[data-testid="import-def-unit-0:1"]', 'mmol/L')
  await page.fill('[data-testid="import-def-low-0:1"]', '0.5')
  await page.fill('[data-testid="import-def-high-0:1"]', '12.5')
  await page.waitForTimeout(300)
  if (!(await page.locator('[data-testid="import-commit"]').isEnabled())) throw new Error('Import is not live after choosing')
  await page.click('[data-testid="import-commit"]'); await page.waitForTimeout(900)
  const s = await state()
  const m = s.bloods.customMarkers.find((x) => x.name === 'Mystery Thing')
  if (!m) throw new Error('the marker was not created')
  if (m.panel !== 'Lipids' || m.unit !== 'mmol/L' || m.refLow !== 0.5 || m.refHigh !== 12.5) throw new Error(`created as ${JSON.stringify(m)}`)
  const t = s.bloods.tests.find((x) => x.date === FREE)
  if (t.values['Mystery Thing'] !== 9 || t.values.Testosterone !== 18) throw new Error(`values ${JSON.stringify(t.values)}`)
  if (t.seeded) throw new Error('an imported result was marked as seeded')
  console.log('  Mystery Thing added to Lipids (mmol/L, 0.5 to 12.5) and 2 values saved')
})

// ================================================= 3 · duplicates, merge, replace

await step('3 · a date that exists offers merge, replace or cancel, and has no default', async () => {
  await resetBloods()
  const absent = missingFrom(existingTest)
  const file = wrap({ date: existingTest.date, Testosterone: (existingTest.values.Testosterone ?? 10) + 1, [absent]: mid(absent) })
  await pickFile('dup.json', file)
  if (!(await page.locator('[data-testid="import-conflict-0"]').count())) throw new Error('no conflict panel')
  for (const id of ['merge', 'replace', 'cancel']) {
    if (!(await page.locator(`[data-testid="import-mode-0-${id}"]`).count())) throw new Error(`no ${id} choice`)
  }
  for (const id of ['merge', 'replace']) {
    if ((await page.locator(`[data-testid="import-mode-0-${id}"]`).getAttribute('data-on')) === 'true') throw new Error(`${id} is chosen by default`)
  }
  if (await page.locator('[data-testid="import-commit"]').isEnabled()) throw new Error('Import is live before a choice')
  console.log(`  ${existingTest.date} already has ${Object.keys(existingTest.values).length} markers; no default chosen`)
})

await step('3b · merge fills only empty markers and never overwrites', async () => {
  const absent = missingFrom(existingTest)
  const had = existingTest.values.Testosterone
  await page.click('[data-testid="import-mode-0-merge"]'); await page.waitForTimeout(300)
  if (had != null) {
    const note = await page.locator('[data-testid="import-effect-0:0"]').innerText()
    if (!/Keeps the/.test(note)) throw new Error(`the existing value is not marked as kept: "${note}"`)
  }
  if ((await page.locator('[data-testid="import-effect-0:1"]').getAttribute('data-effect')) !== 'fills') throw new Error('the empty slot is not marked as filled')
  await page.click('[data-testid="import-commit"]'); await page.waitForTimeout(900)
  const t = (await tests()).find((x) => x.date === existingTest.date)
  for (const [k, v] of Object.entries(existingTest.values)) {
    if (t.values[k] !== v) throw new Error(`${k} changed from ${v} to ${t.values[k]}`)
  }
  if (t.values[absent] !== mid(absent)) throw new Error(`${absent} was not filled with ${mid(absent)}`)
  if ((await tests()).length !== pristine.tests.length) throw new Error('merging added a second test')
  console.log(`  every existing value unchanged; ${absent} filled with ${mid(absent)}`)
})

await step('3c · replace overwrites that date and keeps its report', async () => {
  await resetBloods()
  // give the existing test a report, so we can see replace keeps it
  await setState('const t = s.bloods.tests.find((x) => x.date === a.d); t.attachment = { blobKey: "blood-keepme", name: "old.pdf", type: "application/pdf", size: 4 }', { d: existingTest.date })
  await reload(); await bloodsTab()
  await pickFile('dup.json', wrap({ date: existingTest.date, lab: 'New lab', Testosterone: 33 }))
  await page.click('[data-testid="import-mode-0-replace"]'); await page.waitForTimeout(300)
  const note = await page.locator('[data-testid="import-mode-note-0"]').innerText()
  if (!/Removes the \d+ value/.test(note)) throw new Error(`replace does not say what it removes: "${note}"`)
  await page.click('[data-testid="import-commit"]'); await page.waitForTimeout(900)
  const t = (await tests()).find((x) => x.date === existingTest.date)
  if (JSON.stringify(t.values) !== JSON.stringify({ Testosterone: 33 })) throw new Error(`values are ${JSON.stringify(t.values)}`)
  if (t.lab !== 'New lab') throw new Error('the lab was not replaced')
  if (t.id !== existingTest.id) throw new Error('replacing changed the test id')
  if (t.attachment?.blobKey !== 'blood-keepme') throw new Error('replacing dropped the attached report')
  if ((await tests()).length !== pristine.tests.length) throw new Error('replacing added a second test')
})

await step('3d · cancel on a duplicate leaves the record exactly as it was', async () => {
  await resetBloods()
  const before = JSON.stringify((await state()).bloods)
  await pickFile('dup.json', wrap({ date: existingTest.date, Testosterone: 99 }))
  await page.click('[data-testid="import-mode-0-cancel"]'); await page.waitForTimeout(500)
  if (await preview().count()) throw new Error('cancel did not close the preview')
  if (JSON.stringify((await state()).bloods) !== before) throw new Error('cancelling changed the record')
})

// ================================================================ 4 · the flags

await step('4 · out-of-range is flagged as normal and does not block', async () => {
  await resetBloods()
  await pickFile('hi.json', wrap({ date: FREE, Testosterone: T.ref_high + 2, Haematocrit: 0.46 }))
  const r = row('0:0')
  const range = r.locator('[data-testid="import-range-0:0"]')
  if ((await range.getAttribute('data-status')) !== 'high') throw new Error('a high value is not marked high')
  const text = await range.innerText()
  if (!/High/.test(text) || !text.includes(String(T.ref_high))) throw new Error(`the range line reads "${text}"`)
  if (await page.locator('[data-testid^="import-problem-0:0"]').count()) throw new Error('out-of-range was raised as a problem')
  if (!(await page.locator('[data-testid="import-commit"]').isEnabled())) throw new Error('an out-of-range value blocked the import')
  if (!/outside the interval/.test(await page.locator('[data-testid="import-tosave"]').innerText())) throw new Error('the summary does not mention it')
  await cancelPreview()
})

await step('4b · an implausible value is flagged, and asks to be confirmed before it goes in', async () => {
  const wild = T.ref_high * 20
  await pickFile('wild.json', wrap({ date: FREE, Testosterone: wild }))
  const p = page.locator('[data-testid="import-problem-0:0-implausible"]')
  if (!(await p.count())) throw new Error('no implausible flag')
  if (!/stray digit/.test(await p.innerText())) throw new Error('the flag does not say what to check')
  if (await page.locator('[data-testid="import-commit"]').isEnabled()) throw new Error('an unconfirmed implausible value is importable')
  await page.click('[data-testid="import-confirm-0:0"]'); await page.waitForTimeout(300)
  if (!(await page.locator('[data-testid="import-confirmed-0:0"]').count())) throw new Error('confirming did not register')
  if (!(await page.locator('[data-testid="import-commit"]').isEnabled())) throw new Error('confirming did not unblock it')
  // editing the value takes the confirmation away: it is a different number now
  await page.fill('[data-testid="import-value-0:0"]', String(wild + 1)); await page.waitForTimeout(300)
  if (await page.locator('[data-testid="import-commit"]').isEnabled()) throw new Error('an edited value kept its old confirmation')
  await page.fill('[data-testid="import-value-0:0"]', String(T.ref_high)); await page.waitForTimeout(300)
  if (!(await page.locator('[data-testid="import-commit"]').isEnabled())) throw new Error('fixing the value did not clear the flag')
  await cancelPreview()
})

await step('4c · a unit mismatch is flagged, never converted', async () => {
  await pickFile('unit.json', wrap({ date: FREE, Testosterone: { value: 18, unit: 'ng/dL' } }))
  const p = page.locator('[data-testid="import-problem-0:0-unit"]')
  if (!(await p.count())) throw new Error('no unit flag')
  const text = await p.innerText()
  if (!text.includes('ng/dL') || !text.includes(T.unit) || !/not converted/.test(text)) throw new Error(`the flag reads "${text}"`)
  if ((await page.locator('[data-testid="import-value-0:0"]').inputValue()) !== '18') throw new Error('the value was changed')
  // a number in another unit gets no in-range or high verdict against this interval
  const verdict = page.locator('[data-testid="import-range-0:0"]')
  if ((await verdict.getAttribute('data-status')) !== 'uncompared') throw new Error('a mismatched value was judged against the interval')
  if (!/different unit/.test(await verdict.innerText())) throw new Error('it does not say why it was not compared')
  if (await page.locator('[data-testid="import-problem-0:0-implausible"]').count()) throw new Error('a stray-digit flag fired on a figure in another unit')
  if (await page.locator('[data-testid="import-commit"]').isEnabled()) throw new Error('a unit mismatch is importable unconfirmed')
  await page.click('[data-testid="import-confirm-0:0"]'); await page.waitForTimeout(300)
  await page.click('[data-testid="import-commit"]'); await page.waitForTimeout(900)
  const t = (await tests()).find((x) => x.date === FREE)
  if (t.values.Testosterone !== 18) throw new Error(`saved as ${t.values.Testosterone}, not exactly 18`)
})

await step('4d · a spelling difference in the unit is not a mismatch', async () => {
  await resetBloods()
  await pickFile('unit.json', wrap({ date: FREE, Testosterone: { value: 18, unit: T.unit.toUpperCase() } }))
  if (await page.locator('[data-testid^="import-problem-0:0"]').count()) throw new Error('a case difference was flagged')
  await cancelPreview()
})

// ================================================================== 5 · bad files

await step('5 · a malformed file gives a clear error and imports nothing', async () => {
  await resetBloods()
  const before = JSON.stringify((await state()).bloods)
  const bad = [
    ['broken.json', '{"schema": "x", "result": {', /not valid JSON/],
    ['nodate.json', JSON.stringify(wrap({ Testosterone: 18 })), /no "date"/],
    ['baddate.json', JSON.stringify(wrap({ date: '2026-02-30', Testosterone: 18 })), /not a real date/],
    ['schema.json', JSON.stringify({ schema: 'other/v2', result: { date: FREE, Testosterone: 1 } }), /other\/v2/],
    ['empty.json', '', /empty/],
    ['list.json', JSON.stringify([wrap({ date: FREE, T: 1 }), wrap({ T: 2 })]), /Result 2 has no "date"/],
    ['dupe.json', JSON.stringify([wrap({ date: FREE, Testosterone: 1 }), wrap({ date: FREE, Testosterone: 2 })]), /both dated/],
  ]
  for (const [name, content, pattern] of bad) {
    await pickFile(name, content)
    if (await preview().count()) throw new Error(`${name}: a preview opened`)
    const text = await page.locator('[data-testid="import-error-text"]').innerText().catch(() => '')
    if (!pattern.test(text)) throw new Error(`${name}: the error reads "${text}"`)
    if (!/Nothing was imported/.test(await page.locator('[data-testid="import-error"]').innerText())) throw new Error(`${name}: it does not say nothing was imported`)
    await noOverflow(`error for ${name}`)
    await page.keyboard.press('Escape'); await page.waitForTimeout(350)
    if (JSON.stringify((await state()).bloods) !== before) throw new Error(`${name}: the record changed`)
  }
  console.log(`  ${bad.length} different bad files, each named what was wrong; the record never moved`)
})

// ============================================================ 6 · attaching the source

await step('6 · the source report attaches, survives a reload, and is in a backup', async () => {
  await resetBloods()
  await pickFile('with-pdf.json', wrap({ date: FREE, Testosterone: 18, Haematocrit: 0.46 }))
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')
  await page.setInputFiles('[data-testid="import-attach-input-0"]', { name: 'report.pdf', mimeType: 'application/pdf', buffer: pdf })
  await page.waitForTimeout(300)
  if (!(await page.locator('[data-testid="import-attached-0"]').innerText()).includes('report.pdf')) throw new Error('the file is not shown as attached')
  await page.click('[data-testid="import-commit"]'); await page.waitForTimeout(1200)

  const t = (await tests()).find((x) => x.date === FREE)
  if (!t.attachment?.blobKey) throw new Error('no attachment on the new test')
  if (t.attachment.name !== 'report.pdf' || t.attachment.type !== 'application/pdf') throw new Error(`attachment is ${JSON.stringify(t.attachment)}`)

  const readBlob = (key) => page.evaluate(async (k) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('pcc-blobs'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    return await new Promise((res) => {
      const tx = db.transaction('blobs', 'readonly').objectStore('blobs').get(k)
      tx.onsuccess = () => res(tx.result ? { size: tx.result.size, type: tx.result.type } : null)
      tx.onerror = () => res(null)
    })
  }, key)
  const key = t.attachment.blobKey
  const before = await readBlob(key)
  if (!before || before.size !== pdf.length) throw new Error(`the report is not stored intact (${JSON.stringify(before)})`)

  await reload(); await bloodsTab()
  const after = await readBlob(key)
  if (!after || after.size !== pdf.length) throw new Error('the report did not survive a reload')
  const row = page.locator('[data-testid="test-row"]', { hasText: 'report attached' })
  if (!(await row.count())) throw new Error('the test list does not say a report is attached')

  // viewable from that date later
  await row.first().click(); await page.waitForTimeout(800)
  const open = page.locator('[data-testid="attachment-open"]')
  if (!(await open.count())) throw new Error('the report cannot be opened from the test')
  if (!(await open.getAttribute('href'))?.startsWith('blob:')) throw new Error('the open link is not a blob URL')
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)

  // and it is in a backup, through the real button
  await page.click('nav button[aria-label="More"]'); await page.waitForTimeout(600)
  await page.click('[data-testid="more-settings"]'); await page.waitForTimeout(800)
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('button:has-text("Back up everything")'),
  ])
  const bundle = JSON.parse(readFileSync(await download.path(), 'utf8'))
  if (!bundle.blobs?.[key]) throw new Error('the report is not in the backup file')
  if (bundle.blobs[key].type !== 'application/pdf') throw new Error('the report lost its type in the backup')
  console.log(`  stored intact (${before.size} bytes), kept through a reload, openable from the test, and in the backup`)
})

await step('6b · a photo of the report attaches too', async () => {
  await bloodsTab()
  await resetBloods()
  await pickFile('with-photo.json', wrap({ date: FREE, Testosterone: 18 }))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mNk+M9QzwAFjDAGACkNA/9K0RtxAAAAAElFTkSuQmCC', 'base64')
  await page.setInputFiles('[data-testid="import-attach-input-0"]', { name: 'scan.png', mimeType: 'image/png', buffer: png })
  await page.click('[data-testid="import-commit"]'); await page.waitForTimeout(1000)
  const t = (await tests()).find((x) => x.date === FREE)
  if (t.attachment?.type !== 'image/png') throw new Error('the photo was not attached')
})

await step('6c · Undo puts the record back, and removes the report it stored', async () => {
  await resetBloods()
  const before = JSON.stringify((await state()).bloods)
  await pickFile('undo.json', wrap({ date: FREE, Testosterone: 18 }))
  await page.setInputFiles('[data-testid="import-attach-input-0"]', { name: 'r.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') })
  await page.click('[data-testid="import-commit"]'); await page.waitForTimeout(1000)
  const key = (await tests()).find((x) => x.date === FREE).attachment.blobKey
  await page.click('[data-testid="toast-undo"]'); await page.waitForTimeout(700)
  if (JSON.stringify((await state()).bloods) !== before) throw new Error('Undo did not restore the record')
  const left = await page.evaluate(async (k) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('pcc-blobs'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    return await new Promise((res) => { const tx = db.transaction('blobs', 'readonly').objectStore('blobs').get(k); tx.onsuccess = () => res(!!tx.result); tx.onerror = () => res(false) })
  }, key)
  if (left) throw new Error('the report file was left behind')
})

// ======================================================= 7 · export, and back in again

await step('7 · Export writes the record in the import format', async () => {
  await resetBloods()
  // something custom and something with notes, so the round trip has teeth
  await setState(`
    s.bloods.customMarkers = [{ name: 'Example Marker', panel: 'Hormones', unit: 'nmol/L', refLow: 1, refHigh: 10, custom: true }]
    s.bloods.tests.push({ id: 'bt-x', date: a.d, lab: 'Imedical', ref: '404358', notes: 'Collected 07:12 AM.', values: { Testosterone: 18, 'Example Marker': 5 }, attachment: null })
    s.bloods.tests.sort((p, q) => p.date.localeCompare(q.date))
  `, { d: FREE })
  await reload(); await bloodsTab()
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('[data-testid="export-results"]'),
  ])
  const name = download.suggestedFilename()
  if (!/^pepito-blood-results-\d{4}-\d{2}-\d{2}\.json$/.test(name)) throw new Error(`the file is called ${name}`)
  const out = JSON.parse(readFileSync(await download.path(), 'utf8'))
  const have = await tests()
  if (!Array.isArray(out) || out.length !== have.length) throw new Error(`${out.length} entries for ${have.length} tests`)
  if (!out.every((e) => e.schema === SCHEMA && e.result?.date)) throw new Error('an entry is not in the import schema')
  const mine = out.find((e) => e.result.date === FREE)
  if (mine.result.lab !== 'Imedical' || mine.result.Testosterone !== 18 || mine.result['Example Marker'] !== 5) throw new Error('an entry lost a value')
  if (mine.new_markers?.[0]?.name !== 'Example Marker') throw new Error('the custom marker was not carried')
  if (JSON.stringify(out).match(/seeded|attachment|blobKey/)) throw new Error('the file carries things the app keeps for itself')
  globalThis.__exported = readFileSync(await download.path(), 'utf8')
  console.log(`  ${out.length} tests written as ${name}`)
})

await step('7b · the exported file re-imports cleanly into an empty record', async () => {
  const original = (await tests()).map((t) => ({ date: t.date, lab: t.lab, ref: t.ref, notes: t.notes, values: t.values }))
  const customBefore = (await state()).bloods.customMarkers
  // wipe, then bring it all back through the real importer
  await setState('s.bloods.tests = []; s.bloods.customMarkers = []')
  await reload(); await bloodsTab()
  if ((await tests()).length !== 0) throw new Error('the record was not emptied')
  await pickFile('roundtrip.json', globalThis.__exported)
  if (!(await preview().count())) throw new Error('the exported file did not open a preview')
  const counts = await page.locator('[data-testid="import-counts"]').innerText()
  if (/unrecognised/.test(counts)) throw new Error(`the export has unrecognised markers: "${counts}"`)
  if (await page.locator('[data-testid="import-conflict-0"]').count()) throw new Error('an empty record reported a conflict')
  if (await page.locator('[data-testid^="import-problem-"]').count()) throw new Error('re-importing raised flags')
  if (!(await page.locator('[data-testid="import-commit"]').isEnabled())) throw new Error('a clean re-import is blocked')
  await page.click('[data-testid="import-commit"]'); await page.waitForTimeout(1200)
  const back = (await tests()).map((t) => ({ date: t.date, lab: t.lab, ref: t.ref, notes: t.notes, values: t.values }))
  if (back.length !== original.length) throw new Error(`${back.length} tests came back, ${original.length} went out`)
  const i = back.findIndex((b, k) => !same(b, original[k]))
  if (i >= 0) {
    const diff = Object.keys({ ...back[i].values, ...original[i].values }).filter((k) => back[i].values[k] !== original[i].values[k])
    throw new Error(`test ${i} (${original[i].date}) differs after the round trip: ${diff.slice(0, 4).join(', ') || 'in lab/ref/notes'}`)
  }
  const custom = (await state()).bloods.customMarkers
  if (custom.length !== customBefore.length || custom[0]?.name !== 'Example Marker' || custom[0].refHigh !== 10) throw new Error('the custom marker did not come back')
  console.log(`  ${back.length} tests, every value and the custom marker identical`)
})

await step('7c · re-importing into the same record flags every date and changes nothing', async () => {
  const before = JSON.stringify((await state()).bloods.tests)
  await pickFile('again.json', globalThis.__exported)
  const n = await page.locator('[data-testid^="import-conflict-"]').count()
  if (n !== (await tests()).length) throw new Error(`${n} conflicts for ${(await tests()).length} tests`)
  if (await page.locator('[data-testid="import-commit"]').isEnabled()) throw new Error('importable without choosing')
  for (let i = 0; i < n; i++) await page.click(`[data-testid="import-mode-${i}-merge"]`)
  await page.waitForTimeout(400)
  if (await page.locator('[data-testid="import-commit"]').isEnabled()) throw new Error('a merge with nothing to add is importable')
  await cancelPreview()
  if (JSON.stringify((await state()).bloods.tests) !== before) throw new Error('the record changed')
})

// ===================================================================== 8 · several at once

await step('8 · an array imports several tests at once, each with its own choices', async () => {
  await resetBloods()
  const free2 = ['2026-07-01', '2026-06-01', '2026-05-01'].filter((d) => !taken.has(d))
  const file = [
    wrap({ date: free2[0], lab: 'A', Testosterone: 15 }),
    wrap({ date: free2[1], lab: 'B', Testosterone: 17 }),
    wrap({ date: existingTest.date, Testosterone: 99 }),
  ]
  await pickFile('many.json', file)
  for (const i of [0, 1, 2]) if (!(await page.locator(`[data-testid="import-entry-${i}"]`).count())) throw new Error(`result ${i + 1} is missing`)
  await noOverflow('multi preview')
  // the third is a duplicate: skip it, import the other two
  await page.click('[data-testid="import-mode-2-cancel"]'); await page.waitForTimeout(400)
  if ((await page.locator('[data-testid="import-entry-2"]').getAttribute('data-skipped')) !== 'true') throw new Error('Skip did not skip it')
  await page.click('[data-testid="import-commit"]'); await page.waitForTimeout(1000)
  const now = await tests()
  if (now.length !== pristine.tests.length + 2) throw new Error(`${now.length} tests, expected ${pristine.tests.length + 2}`)
  if (JSON.stringify(now.find((t) => t.date === existingTest.date).values) !== JSON.stringify(existingTest.values)) throw new Error('the skipped duplicate was changed')
})

// =============================================================== 9 · nothing else moved

await step('9 · peptide stock, doses and everything else are untouched', async () => {
  const after = await outsideSnapshot()
  if (after !== outsideBefore) {
    const a = JSON.parse(outsideBefore), b = JSON.parse(after)
    throw new Error(`changed: ${Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).join(', ')}`)
  }
})

await step('10 · the Bloods tab fits 390px with the new actions', async () => {
  await bloodsTab()
  await noOverflow('Bloods')
  for (const id of ['import-results', 'export-results']) {
    if (!(await page.locator(`[data-testid="${id}"]`).isVisible())) throw new Error(`${id} is not visible`)
  }
})

const noise = errors.filter((e) => e.startsWith('console') || e.startsWith('pageerror'))
console.log(`\n--- console/page errors: ${noise.length}`)
for (const e of noise.slice(0, 10)) console.log('  ' + e.split('\n')[0])
console.log(`--- step failures: ${failures}`)
await browser.close()
process.exit(failures || noise.length ? 1 : 0)
