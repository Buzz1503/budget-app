import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const BASE = process.env.BASE_URL || 'http://localhost:5178'
const SHOT = new URL('./shots', import.meta.url).pathname
mkdirSync(SHOT, { recursive: true })
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
// Vite serves node_modules under the configured base, so this has to follow BASE
const IDB = new URL('node_modules/idb-keyval/dist/index.js', BASE).toString()
const DL = join(tmpdir(), 'pcc-dl')
rmSync(DL, { recursive: true, force: true })
mkdirSync(DL, { recursive: true })

const errors = []
const browser = await chromium.launch({ executablePath: EXE })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

const step = async (name, fn) => {
  try { await fn(); console.log('PASS', name) }
  catch (e) { console.log('FAIL', name, '—', e.message.split('\n')[0]); errors.push(`step ${name}: ${e.message}`) }
}
const waitText = async (re, timeout = 8000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) { if (re.test(await page.textContent('body'))) return true; await page.waitForTimeout(150) }
  throw new Error('timeout waiting for ' + re)
}
const goSettings = async () => {
  await page.click('nav button:has-text("More")')
  await page.click('text=Settings & badges')
  await waitText(/Full backup/)
}
const save = async (dl) => {
  const p = join(DL, dl.suggestedFilename())
  await dl.saveAs(p)
  return p
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.click('text=Got it')

await step('five-tab nav; History lives under More', async () => {
  const labels = await page.locator('nav button span').allTextContents()
  const want = ['Home', 'Calendar', 'Symptoms', 'Body', 'More']
  for (const w of want) if (!labels.includes(w)) throw new Error(`missing tab ${w}`)
  if (await page.locator('nav button').count() !== 5) throw new Error('nav is not 5 tabs')
  await page.click('nav button:has-text("More")')
  await waitText(/History & adherence/)
})

// ---------- seed some data to back up ----------
await step('seed doses, a symptom check-in and a photo blob', async () => {
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
  // a photo blob straight into IndexedDB, so backup has something binary to carry
  await page.evaluate(async (idb) => {
    const { set, createStore } = await import(/* @vite-ignore */ idb)
    const store = createStore('pcc-blobs', 'blobs')
    await set('photo-test-1', new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/jpeg' }), store)
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.photos = [{ id: 'p1', date: new Date().toISOString().slice(0, 10), pose: 'front', blobKey: 'photo-test-1' }]
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  }, IDB)
  await page.reload({ waitUntil: 'networkidle' })
})

let backupPath = null
await step('full backup downloads one file containing data AND photo blobs', async () => {
  await goSettings()
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('button:has-text("Back up everything")'),
  ])
  backupPath = await save(dl)
  const bundle = JSON.parse(readFileSync(backupPath, 'utf8'))
  if (bundle.format !== 'peptide-command-center/backup') throw new Error('wrong format marker')
  if (!bundle.appState?.state?.doseLogs?.length) throw new Error('structured data missing from backup')
  const blobKeys = Object.keys(bundle.blobs || {})
  if (!blobKeys.includes('photo-test-1')) throw new Error('IndexedDB photo blob NOT in backup')
  if (!bundle.blobs['photo-test-1'].data) throw new Error('blob has no base64 payload')
  await waitText(/photo\/scan file/)
})
await page.screenshot({ path: `${SHOT}/v6-01-backup.png` })

await step('restore repopulates data and photo blobs after a confirm', async () => {
  // wipe everything, then restore
  await page.evaluate(async (idb) => {
    const { clear, createStore } = await import(/* @vite-ignore */ idb)
    await clear(createStore('pcc-blobs', 'blobs'))
    localStorage.clear()
  }, IDB)
  await page.reload({ waitUntil: 'networkidle' })
  await page.click('text=Got it')
  await goSettings()
  await page.setInputFiles('input[accept="application/json,.json"]', backupPath)
  await waitText(/Replace all current data\?/) // confirm gate must appear
  await waitText(/photo\/scan files/)
  await page.click('button:has-text("Yes, restore")')
  await page.waitForTimeout(2500) // page reloads itself after restore
  const restored = await page.evaluate(async (idb) => {
    const { get, createStore } = await import(/* @vite-ignore */ idb)
    const blob = await get('photo-test-1', createStore('pcc-blobs', 'blobs'))
    const s = JSON.parse(localStorage.getItem('peptide-command-center')).state
    return { logs: s.doseLogs.length, photos: s.photos.length, blobSize: blob ? blob.size : 0 }
  }, IDB)
  if (restored.logs < 1) throw new Error('dose logs not restored')
  if (restored.photos < 1) throw new Error('photo records not restored')
  if (restored.blobSize !== 5) throw new Error(`photo blob not restored (size ${restored.blobSize})`)
})

await step('backup nudge appears on Home and can be dismissed', async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.backupMeta = { lastBackupAt: '2020-01-01T00:00:00.000Z', lastBackupEntryCount: 0, nudgeDismissedAt: null }
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  // v15 moved the standing nudges off the main column and into the alert bell
  const bell = page.locator('[data-testid="alert-bell"]')
  await bell.waitFor({ timeout: 10000 })
  await bell.click()
  await page.waitForTimeout(400)
  await waitText(/back up to protect your data|never backed up/i)
  await page.click('button:has-text("Later")')
  await page.waitForTimeout(500)
  if (/back up to protect your data/i.test(await page.textContent('body'))) throw new Error('nudge did not dismiss')
})
await page.screenshot({ path: `${SHOT}/v6-02-nudge.png` })

await step('calendar export downloads a valid .ics with weekday + slot rules', async () => {
  await goSettings()
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('button:has-text("Download .ics")'),
  ])
  const p = await save(dl)
  const ics = readFileSync(p, 'utf8')
  if (!ics.startsWith('BEGIN:VCALENDAR')) throw new Error('not an ics file')
  if (!ics.trimEnd().endsWith('END:VCALENDAR')) throw new Error('ics not terminated')
  const begins = (ics.match(/BEGIN:VEVENT/g) || []).length
  const ends = (ics.match(/END:VEVENT/g) || []).length
  if (begins === 0 || begins !== ends) throw new Error(`unbalanced events ${begins}/${ends}`)
  if (!/RRULE:FREQ=WEEKLY;BYDAY=(MO|TU|WE|TH|FR|SA|SU)/.test(ics)) throw new Error('no weekday recurrence rule')
  if (!/SUMMARY:.*(AM|PM) shot/.test(ics)) throw new Error('no AM/PM slot in event title')
  if (!/DTSTART:\d{8}T(080000|210000)/.test(ics)) throw new Error('slot time not applied')
  console.log(`  ics: ${begins} events`)
})

await step('calendar range mode adds UNTIL', async () => {
  await page.click('button:has-text("Date range")')
  await page.waitForTimeout(200)
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('button:has-text("Download .ics")'),
  ])
  const ics = readFileSync(await save(dl), 'utf8')
  if (!/UNTIL=\d{8}T/.test(ics)) throw new Error('range export has no UNTIL')
})
await page.screenshot({ path: `${SHOT}/v6-03-calendar.png` })

await step('History shows logged doses, sites and adherence %', async () => {
  await page.click('nav button:has-text("More")')
  await page.click('text=History & adherence')
  await waitText(/Adherence/)
  const txt = await page.textContent('body')
  if (!/injection/.test(txt)) throw new Error('no injection list')
  if (!/%/.test(txt)) throw new Error('no adherence percentage')
  if (!/Abdomen|Thigh|love handle/i.test(txt)) throw new Error('injection site not shown in history')
})
await page.screenshot({ path: `${SHOT}/v6-04-history.png` })

await step('History groups a co-draw as one injection event', async () => {
  await page.click('nav button:has-text("Home")')
  await page.click('button:has-text("AM")')
  await page.waitForTimeout(400)
  // Selank + Semax is a confirmed MIX, so the co-draw goes through
  const a = page.locator('button[aria-label="Select Selank to co-draw"]')
  const b = page.locator('button[aria-label="Select Semax to co-draw"]')
  if (await a.count() && await b.count()) {
    await a.click(); await b.click()
    await page.click('button:has-text("Log together")')
    await waitText(/pick one spot|Not one shot/i)
    if (await page.locator('button:has-text("Log 2 together")').count()) {
      await page.click('button:has-text("Log 2 together")')
      await page.waitForTimeout(900)
      await page.click('nav button:has-text("More")')
      await page.click('text=History & adherence')
      await waitText(/CO-DRAW/)
    }
  }
})

await step('shareable summary opens a legible document', async () => {
  const [popup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 15000 }),
    page.click('button:has-text("Shareable summary")'),
  ])
  await popup.waitForLoadState('domcontentloaded')
  const txt = await popup.textContent('body')
  for (const s of ['Peptide protocol summary', 'Current protocol', 'Adherence by peptide', 'not medical advice']) {
    if (!txt.includes(s)) throw new Error(`summary missing section: ${s}`)
  }
  await popup.screenshot({ path: `${SHOT}/v6-05-summary.png`, fullPage: true })
  await popup.close()
})

await step('reference: existing library peptides are enriched (tier badge shows)', async () => {
  await page.click('nav button:has-text("More")')
  await page.click('text=Library')
  await waitText(/Retatrutide/)
  const txt = await page.textContent('body')
  if (!/T[1-5X]/.test(txt)) throw new Error('no evidence tier badge on library cards')
  const enriched = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('peptide-command-center')).state
    const p = s.peptides.find((x) => x.id === 'bpc157')
    return { tier: p?.reference?.tier, mech: !!p?.reference?.mechanism, doseText: p?.doseText }
  })
  if (!enriched.tier) throw new Error('reference not attached to existing peptide')
  if (!enriched.mech) throw new Error('mechanism not attached')
  if (!enriched.doseText) throw new Error('descriptive dose text not seeded')
})

await step('reference: enrichment never overwrote a user-set protocol value', async () => {
  const before = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('peptide-command-center')).state
    const p = s.peptides.find((x) => x.id === 'bpc157')
    return { ceiling: p.ladder.ceiling, vialMg: p.recon.vialMg }
  })
  // seeds ship with real numbers; enrichment must not have zeroed or changed them
  if (before.ceiling !== 500) throw new Error(`ladder ceiling changed to ${before.ceiling}`)
  if (before.vialMg !== 5) throw new Error(`recon vialMg changed to ${before.vialMg}`)
})

await step('reference panel separates Established from Reported', async () => {
  await page.click('h3:has-text("BPC-157")')
  await page.waitForTimeout(400)
  await page.click('summary:has-text("Reference")')
  await waitText(/Established \(evidence\)/)
  await waitText(/Reported \(community — not evidence\)/)
  const txt = await page.textContent('body')
  if (!/Mechanism/.test(txt)) throw new Error('mechanism section missing')
  if (!/Safety/.test(txt)) throw new Error('safety section missing')
  if (!/Monitor/.test(txt)) throw new Error('monitor section missing')
})
await page.screenshot({ path: `${SHOT}/v6-06-reference.png`, fullPage: true })

await step('adding from the list pre-fills reference text but no fabricated numbers', async () => {
  await page.click('button:has-text("Add")')
  await page.waitForFunction(() => document.querySelectorAll('div.max-h-\\[46vh\\] > button').length === 86, null, { timeout: 10000 })
  await page.fill('input[placeholder*="Search"]', 'thymosin')
  await page.waitForTimeout(400)
  await page.locator('div.max-h-\\[46vh\\] > button', { hasText: /^TB-500 \(Thymosin/ }).first().click()
  await page.waitForTimeout(900)
  const p = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('peptide-command-center')).state
    return s.peptides.find((x) => x.id === 'tb500')
  })
  if (!p) throw new Error('tb500 not added')
  if (!p.doseText) throw new Error('suggested dose text not pre-filled')
  if (!p.frequencyText) throw new Error('suggested frequency not pre-filled')
  if (!p.reference?.tier) throw new Error('tier not attached')
  // structured numbers must stay blank — never fabricated
  if (p.ladder.ceiling !== 0 || p.recon.vialMg !== 0) throw new Error('structured dose was fabricated')
})

await step('TX compound gets no dose text, only the safety reason', async () => {
  await page.click('button:has-text("Add")')
  await page.waitForFunction(() => document.querySelectorAll('div.max-h-\\[46vh\\] > button').length === 86, null, { timeout: 10000 })
  await page.fill('input[placeholder*="Search"]', 'dermorphin')
  await page.waitForTimeout(400)
  await waitText(/No dosing provided/)
  await page.locator('div.max-h-\\[46vh\\] > button', { hasText: /Dermorphin/ }).first().click()
  await page.waitForTimeout(900)
  const p = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('peptide-command-center')).state
    return s.peptides.find((x) => x.id === 'dermorphin')
  })
  if (!p) throw new Error('TX compound not added')
  if (p.doseText) throw new Error('TX compound got a fabricated dose text')
  if (p.reference?.tier !== 'TX') throw new Error('TX tier not attached')
  if (!p.reference?.safety?.length) throw new Error('TX safety reason missing')
  // the safety reason must be visible, not buried in a collapsed section
  await waitText(/No dosing provided for this compound/)
  const shown = await page.evaluate(() => {
    const el = [...document.querySelectorAll('p')].find((e) => /No dosing provided for this compound/.test(e.textContent))
    return !!el && el.offsetParent !== null
  })
  if (!shown) throw new Error('TX safety reason is not visible')
})
await page.screenshot({ path: `${SHOT}/v6-07-tx.png` })

await step('persistence: everything survives a reload', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  if (!s.doseLogs.length) throw new Error('dose logs lost')
  if (!s.peptides.find((p) => p.id === 'tb500')) throw new Error('added peptide lost')
  if (!s.backupMeta?.lastBackupAt) throw new Error('backup metadata lost')
  console.log(`  peptides ${s.peptides.length} · logs ${s.doseLogs.length} · photos ${s.photos.length}`)
})

console.log('\n--- console/page errors:', errors.length)
errors.forEach((e) => console.log(' ', e.slice(0, 220)))
await browser.close()
process.exit(errors.length ? 1 : 0)
