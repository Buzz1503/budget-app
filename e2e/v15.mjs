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
const waitText = async (re, timeout = 20000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (re.test(await page.textContent('body'))) return true
    await page.waitForTimeout(150)
  }
  throw new Error('timeout waiting for ' + re)
}
const body = () => page.textContent('body')
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
const patch = (fn) => page.evaluate((src) => {
  const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
  // eslint-disable-next-line no-new-func
  new Function('s', src)(raw.state)
  localStorage.setItem('peptide-command-center', JSON.stringify(raw))
}, fn)
const TAB_MARK = {
  Home: /Pepito \+/, Calendar: /This week|Adherence this month/,
  Symptoms: /How are you feeling/i, Body: /How to measure/, More: /Build \/ rebuild my protocol/,
}
const nav = async (label) => {
  await page.click(`nav button[aria-label="${label}"]`)
  await waitText(TAB_MARK[label])
  await page.waitForTimeout(250)
}
const openPicker = async () => {
  await page.locator('button[aria-label^="Log "]').first().click()
  await waitText(/INJECT HERE|Next on your path/, 12000)
}
const closeAny = async () => {
  for (const sel of ['[data-testid="site-detail"] button[aria-label="Close"]', 'button:text-is("Done")', 'div.fixed.inset-0.z-50 button[aria-label="Close"]']) {
    const b = page.locator(sel).first()
    if (await b.count()) { await b.click(); await page.waitForTimeout(400) }
  }
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await waitText(/not medical advice/)
await page.click('text=Got it')
await page.click('button:has-text("AM")')
await page.waitForTimeout(400)

// ---------- 1 · motivation is gone ----------
await step('the AM motivation quote is gone, and nothing empty is left behind', async () => {
  await openPicker()
  await page.locator('button:has-text("Log here")').first().click()
  await page.waitForTimeout(1200)
  if (await page.locator('[data-testid="motivation-line"]').count()) {
    throw new Error('the motivation line is still rendered')
  }
  // the celebration itself must still fire
  if (!/logged/i.test(await body())) throw new Error('no log celebration')
  const st = await state()
  if (!st.doseLogs.length) throw new Error('the dose did not log')
  if (st.motivation) throw new Error('the motivation slice is still persisted')
  await closeAny()
})

// ---------- 2 · Home declutter ----------
await step('standing nudges are collapsed into one alert bell', async () => {
  await patch(`
    s.openVials.bpc157 = { remainingMg: 0.2, reconstitutedAt: new Date(Date.now() - 27*86400000).toISOString().slice(0,10) };
    s.backupMeta = { lastBackupAt: null, lastBackupEntryCount: 0, nudgeDismissedAt: null };
  `)
  await page.reload({ waitUntil: 'networkidle' })
  await waitText(/Pepito/)
  await page.click('button:has-text("AM")')
  await page.waitForTimeout(400)
  const bell = page.locator('[data-testid="alert-bell"]')
  if (!(await bell.count())) throw new Error('no alert bell')
  // and not as full-width cards in the main column
  if (await page.locator('main button:has-text("Back up now")').count()) {
    throw new Error('the backup nudge is still a card in the main column')
  }
  await bell.click()
  await page.waitForTimeout(400)
  const panel = page.locator('[data-testid="alert-panel"]')
  if (!(await panel.count())) throw new Error('the bell did not expand')
  if (!/Back up now|expires|runs out/i.test(await panel.textContent())) {
    throw new Error('the panel carries none of the nudges')
  }
  await page.keyboard.press('Escape')
  await bell.click()
  await page.waitForTimeout(300)
})

await step('the dose list leads the screen', async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.settings.disclaimerDismissed = true
    raw.state.coachMarks = { 'log-button': true, 'site-map': true }
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await waitText(/Pepito/)
  await page.click('button:has-text("AM")')
  await page.waitForTimeout(500)
  // v16 lists every compound in the combine plan rather than truncating to one
  // line, which makes the plan taller — but the plan IS dose content, not
  // chrome. Measure to whichever dose block comes first; v16 asserts the
  // tighter 200px bound on this same quantity.
  const y = await page.evaluate(() => {
    const card = document.querySelector('main button[aria-label^="Log "]')
    const plan = document.querySelector('[data-testid="shot-plan"]')
    const tops = [card, plan].filter(Boolean).map((el) => el.getBoundingClientRect().top + window.scrollY)
    return tops.length ? Math.min(...tops) : null
  })
  if (y == null) throw new Error('no dose content found')
  // v28: display title + the focal metric card sit above the list by design
  if (y > 340) throw new Error(`the dose content starts ${Math.round(y)}px down — too much above it`)
})

await step('the mix explanation is behind an info tap', async () => {
  const txt = await body()
  const essay = /Only pairs the matrix rates/
  if (essay.test(txt)) throw new Error('the explanation is still shown by default')
  const info = page.locator('button[aria-label="Why these are combined"]')
  if (!(await info.count())) throw new Error('no info control on the combine plan')
  await info.first().click()
  await page.waitForTimeout(400)
  if (!essay.test(await body())) throw new Error('the info tap did not reveal the explanation')
  await info.first().click()
  await page.waitForTimeout(300)
})

// ---------- 3 · living map ----------
await step('beginner clarity is preserved on the map', async () => {
  await openPicker()
  const txt = await body()
  for (const w of ['belly button', 'INJECT HERE', 'Last shot']) {
    if (!txt.includes(w)) throw new Error(`lost "${w}"`)
  }
  // plain-language locations still there
  if (!/finger-widths|third of the way down/.test(txt)) throw new Error('plain-language locations are gone')
})

await step('a just-used site reads hot and a rested one reads healed', async () => {
  const txt = await body()
  if (!/just used|let it heal/i.test(txt)) throw new Error('no hot site after logging one')
  // the colour key explains the healing, behind the info tap
  await page.locator('button[aria-label="What do the colours mean?"]').first().click()
  await page.waitForTimeout(400)
  const key = await body()
  for (const w of ['Healed', 'Still cooling', 'Just used', 'Reacting', 'more than its turn']) {
    if (!key.includes(w)) throw new Error(`colour key missing "${w}"`)
  }
  await page.locator('button[aria-label="What do the colours mean?"]').first().click()
  await page.waitForTimeout(300)
})

await step('picking a spot plays the pin-drop and seals it', async () => {
  const spot = page.locator('svg [data-site="thl-lo"]').first()
  await spot.click()
  await page.waitForTimeout(300)
  const rec = await page.locator('[data-testid="recommendation"]').textContent()
  if (!/Your pick/.test(rec)) throw new Error('picking did not update the readout')
  if (!/Left thigh/.test(rec)) throw new Error(`picked the wrong spot: ${rec.slice(0, 80)}`)
})

await step('tapping a site opens its story with history and reactions', async () => {
  await page.locator('button:has-text("All 16 spots in words")').click()
  await page.waitForTimeout(400)
  await page.locator('[data-testid="spot-list"] button[aria-label^="History and reactions for Abdomen upper-left"]').first().click()
  await page.waitForTimeout(500)
  const sheet = page.locator('[data-testid="site-detail"]')
  await sheet.waitFor({ timeout: 6000 })
  const txt = await sheet.textContent()
  for (const w of ['last used', 'uses · 90d', 'Reactions', 'Recent shots here']) {
    if (!txt.includes(w)) throw new Error(`site story missing "${w}"`)
  }
})

await step('logging a reaction rests the site and excludes it', async () => {
  await page.locator('[data-testid="site-detail"] button:has-text("Log a reaction")').click()
  await page.waitForTimeout(300)
  await page.locator('[data-testid="site-detail"] button:has-text("Lump / hard spot")').click()
  await page.waitForTimeout(600)
  const txt = await page.locator('[data-testid="site-detail"]').textContent()
  if (!/Resting/.test(txt)) throw new Error('the site is not marked resting')
  if (!/excluded from suggestions and the path/.test(txt)) throw new Error('exclusion is not explained')
  const st = await state()
  if (!st.siteReactions['abd-ul']?.length) throw new Error('the reaction did not persist')
  // and the button on the sheet now refuses it
  const useBtn = page.locator('[data-testid="site-detail"] button:has-text("Resting — pick another spot")')
  if (!(await useBtn.count())) throw new Error('the sheet still offers the resting site')
  await page.locator('[data-testid="site-detail"] button[aria-label="Close"]').click()
  await page.waitForTimeout(400)
})

await step('the resting site is dropped from suggestions and the path', async () => {
  const excluded = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    return Object.keys(raw.state.siteReactions || {})
  })
  if (!excluded.includes('abd-ul')) throw new Error('no reaction recorded to test with')
  // reopen and confirm nothing routes there
  await closeAny()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await nav('Home')
  await openPicker()
  const rec = await page.locator('[data-testid="recommendation"]').textContent()
  if (/Belly · upper-left/.test(rec)) throw new Error('the resting site is still being recommended')
})

await step('rotation health scores and nudges once there is enough history', async () => {
  await closeAny()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  // hammer one spot, which is exactly what the score should punish
  await patch(`
    const d = (n) => new Date(Date.now() - n*86400000).toISOString().slice(0,10);
    s.doseLogs = Array.from({length: 10}, (_, i) => ({
      id: 'seed-'+i, peptideId: 'bpc157', siteId: 'abd-lr', date: d(10-i),
      loggedAt: d(10-i)+'T09:00:00', unit: 'mcg', doseValue: 250,
    }));
    s.siteReactions = {};
  `)
  await page.reload({ waitUntil: 'networkidle' })
  await waitText(/Pepito/)
  await page.click('button:has-text("AM")')
  await page.waitForTimeout(400)
  await openPicker()
  const health = page.locator('[data-testid="rotation-health"]')
  await health.waitFor({ timeout: 8000 })
  const txt = await health.textContent()
  if (!/Rotation health/.test(txt)) throw new Error('no rotation health card')
  if (!/spot.? used in \d+ days|favouring/i.test(txt)) throw new Error(`no clustering/balance nudge: ${txt.slice(0, 160)}`)
  await health.locator('button').first().click()
  await page.waitForTimeout(400)
  const open = await health.textContent()
  for (const w of ['Spread across the map', 'Rest between reuses', 'Left / right balance']) {
    if (!open.includes(w)) throw new Error(`health breakdown missing "${w}"`)
  }
})

await step('an over-used site is routed around even when it looks rested', async () => {
  const rec = await page.locator('[data-testid="recommendation"]').textContent()
  if (/Belly · lower-right/.test(rec)) throw new Error('the hammered site is still recommended')
})

// ---------- 4 · path mode ----------
await step('follow-the-path gives a next spot and previews what comes after', async () => {
  await page.locator('button[aria-label="Follow the path"]').click()
  await page.waitForTimeout(500)
  const rec = await page.locator('[data-testid="recommendation"]').textContent()
  if (!/Next on your path/.test(rec)) throw new Error('path mode did not engage')
  if (!/Then:/.test(rec)) throw new Error('no preview of the next stops')
  const st = await state()
  if (st.rotation?.mode !== 'path') throw new Error('the mode did not persist')
})

await step('the path auto-advances after each log and never repeats a spot', async () => {
  const seen = []
  for (let i = 0; i < 4; i++) {
    const rec = await page.locator('[data-testid="recommendation"]').textContent()
    const name = (rec.match(/Next on your path([^·]+?)(?:Two|Front|Back|Left|Right|$)/) || [])[0] || rec.slice(0, 60)
    await page.locator('button:has-text("Log here")').first().click()
    await page.waitForTimeout(1000)
    const st = await state()
    seen.push(st.doseLogs.at(-1).siteId)
    await closeAny()
    await page.waitForTimeout(400)
    if (i < 3) { await nav('Home'); await openPicker() }
  }
  if (new Set(seen).size !== seen.length) throw new Error(`the path repeated a spot: ${seen.join(', ')}`)
  console.log(`  path walked: ${seen.join(' → ')}`)
})

await step('single-suggestion mode still works', async () => {
  await nav('Home')
  await openPicker()
  await page.locator('button[aria-label="Suggest a spot"]').click()
  await page.waitForTimeout(500)
  const rec = await page.locator('[data-testid="recommendation"]').textContent()
  if (!/Inject here/.test(rec)) throw new Error('suggest mode did not engage')
  if (!/rested|healed|never used/.test(rec)) throw new Error('no reason given for the suggestion')
})

// ---------- 5 · IM front/back ----------
await step('an IM peptide exposes a back view with the glutes on it', async () => {
  await closeAny()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await nav('Home')
  // v20 ships Test E SubQ into thigh fat, so nothing in the seed stack is IM.
  // The IM map is still a feature; put a compound on that route (as the Library
  // would) and make it due today, so this keeps testing the map itself.
  await patch(`
    s.peptides = s.peptides.map((p) => p.id === 'testosterone-e'
      ? { ...p, route: 'IM', allowedZone: undefined, frequency: 'daily', scheduleWeekdays: [0,1,2,3,4,5,6] }
      : p);
  `)
  await page.reload({ waitUntil: 'networkidle' })
  await waitText(/Pepito/)
  await page.click('button:has-text("AM")')
  await page.waitForTimeout(400)
  await page.locator('button[aria-label="Log Testosterone Enanthate"]').click()
  await waitText(/Intramuscular/, 10000)
  const backBtn = page.locator('button[aria-label="back view"]')
  if (!(await backBtn.count())) throw new Error('no back view toggle on the IM map')
  await backBtn.click()
  await page.waitForTimeout(500)
  const sites = await page.locator('svg [data-site]').evaluateAll((els) => els.map((e) => e.getAttribute('data-site')))
  if (!sites.includes('im-glute-l') || !sites.includes('im-glute-r')) {
    throw new Error(`the back view has no glutes: ${sites.join(', ')}`)
  }
  await page.locator('button[aria-label="front view"]').click()
  await page.waitForTimeout(400)
  const front = await page.locator('svg [data-site]').evaluateAll((els) => els.map((e) => e.getAttribute('data-site')))
  if (front.includes('im-glute-l')) throw new Error('the glutes are on the front view too')
  if (!front.includes('im-delt-l')) throw new Error('the shoulders are missing from the front view')
})

// ---------- 6 · layout + persistence ----------
await step('no horizontal overflow at 390px on any tab', async () => {
  await closeAny()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  for (const tab of ['Home', 'Calendar', 'Symptoms', 'Body', 'More']) {
    await nav(tab)
    await page.waitForTimeout(450)
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (over > 1) throw new Error(`${tab} overflows by ${over}px`)
  }
})

await step('reactions, rotation mode and logs survive a reload', async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.siteReactions = { 'thl-uo': [{ id: 'r1', kind: 'bruise', date: new Date().toISOString().slice(0, 10), cleared: false }] }
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await waitText(/Pepito/)
  const st = await state()
  if (!st.siteReactions['thl-uo']) throw new Error('reactions lost on reload')
  if (!st.rotation?.mode) throw new Error('rotation mode lost on reload')
  if (!st.doseLogs.length) throw new Error('dose logs lost on reload')
})

await nav('Home')
await page.screenshot({ path: `${SHOT}/v15-home.png`, fullPage: true })
await page.click('button:has-text("AM")')
await page.waitForTimeout(300)
if (await page.locator('button[aria-label^="Log "]').count()) {
  await openPicker()
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${SHOT}/v15-map.png`, fullPage: true })
}

await browser.close()
if (errors.length) {
  console.log('\n--- FAILURES ---')
  for (const e of errors) console.log(e)
  process.exit(1)
}
console.log('\nv15 e2e: all green')
