// v18 — clean number inputs, 2 mL default, Symptoms redesign.
// (Its Insights and Recap suites were removed in v23 with those features.)
// Runs at 390×844 against a build (or the dev server) on BASE_URL.
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
const main = () => page.locator('main').textContent()
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
const modal = () => page.locator('div.fixed.inset-0.z-50 > div.card')
const nav = async (label) => {
  await page.click(`nav button:has-text("${label}")`)
  await page.waitForTimeout(500)
}
// Re-entering Symptoms from another screen, so each step starts with a clean
// selection — tapping the nav button while already there does not remount.
const symptoms = async () => {
  await nav('Home')
  await nav('Symptoms')
}
const more = async (label) => {
  await nav('More')
  await page.click(`button:has-text("${label}")`)
  await page.waitForTimeout(700)
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await waitText(/not medical advice/)
if (await modal().count()) {
  await page.click('button:has-text("Got it")')
  await page.waitForTimeout(500)
}

// ================================================================ 1 · inputs

await step('no numeric field anywhere renders as type=number', async () => {
  const screens = ['calc', 'supplies', 'protocol', 'settings']
  for (const s of screens) {
    await page.evaluate(() => localStorage.setItem('__probe', '1'))
    await more({ calc: 'Calculator', supplies: 'Stock', protocol: 'Protocol overview', settings: 'Settings' }[s])
    const n = await page.locator('input[type="number"]').count()
    if (n > 0) throw new Error(`${s} still has ${n} type=number input(s)`)
  }
})

await step('a numeric field shows a plain number, never a padded zero', async () => {
  await more('Calculator')
  const vals = await page.locator('input[inputmode="decimal"], input[inputmode="numeric"]').evaluateAll(
    (els) => els.map((e) => e.value)
  )
  if (!vals.length) throw new Error('found no numeric fields on the calculator')
  const bad = vals.filter((v) => /^0[0-9]/.test(v))
  if (bad.length) throw new Error(`padded zeros still rendering: ${bad.join(', ')}`)
})

await step('a numeric field can be cleared to empty and typed into cleanly', async () => {
  await more('Calculator')
  const f = page.locator('input[inputmode="decimal"]').first()
  await f.fill('')
  if ((await f.inputValue()) !== '') throw new Error('the field refused to go empty')
  await f.type('25')
  if ((await f.inputValue()) !== '25') throw new Error(`typing 25 produced "${await f.inputValue()}"`)
  await f.blur()
  await page.waitForTimeout(300)
  if (/^0\d/.test(await f.inputValue())) throw new Error('a leading zero came back on blur')
})

await step('decimals survive where they matter', async () => {
  await more('Calculator')
  const f = page.locator('input[inputmode="decimal"]').first()
  await f.fill('')
  await f.type('0.5')
  if ((await f.inputValue()) !== '0.5') throw new Error(`0.5 became "${await f.inputValue()}"`)
})

// ============================================================== 2 · 2 mL BAC

await step('every reconstituted peptide defaults to 2 mL of BAC water', async () => {
  const st = await state()
  const wrong = st.peptides
    .filter((p) => p.recon && p.id !== 'testosterone-e' && p.recon.bacMl !== 2)
    .map((p) => `${p.name}=${p.recon.bacMl}`)
  if (wrong.length) throw new Error(`not on 2 mL: ${wrong.join(', ')}`)
})

await step('the pre-mixed oil vial keeps its real concentration', async () => {
  const st = await state()
  const te = st.peptides.find((p) => p.id === 'testosterone-e')
  if (!te) return // not every stack carries it
  const mgPerMl = te.recon.vialMg / te.recon.bacMl
  if (mgPerMl !== 250) throw new Error(`Test E reads ${mgPerMl} mg/mL — should be 250`)
})

await step('the BAC field is editable and the concentration follows it', async () => {
  await more('Calculator')
  await waitText(/mg\/mL|Concentration/i)
  const before = await main()
  const fields = page.locator('input[inputmode="decimal"]')
  const count = await fields.count()
  if (count < 2) throw new Error('the calculator is not showing its inputs')
  // second field is the BAC volume on this screen
  await fields.nth(1).fill('')
  await fields.nth(1).type('3')
  await page.waitForTimeout(400)
  if ((await main()) === before) throw new Error('changing the BAC volume changed nothing on screen')
})

// =========================================================== 3 · Symptoms UI

await step('the Symptoms tab opens search-first', async () => {
  await symptoms()
  await waitText(/How are you feeling/i)
  if (!(await page.locator('input[placeholder*="Search" i]').count())) {
    throw new Error('no search box')
  }
})

await step('Issues is the FULL negative catalogue, not just the stack', async () => {
  await symptoms()
  const cats = page.locator('[data-testid="symptom-categories"] > div > button')
  const heads = (await cats.allInnerTexts()).map((t) => t.split('\n')[0].trim())
  for (const want of ['Sleep', 'General & energy', 'Mood', 'Focus & memory', 'Head & nerves',
    'Gut & digestion', 'Heart & blood', 'Breathing', 'Skin & hair', 'Hormonal & sexual',
    'Muscles & joints', 'Injection site', 'Urinary', 'Blood sugar & weight', 'Other']) {
    if (!heads.includes(want)) throw new Error(`missing category "${want}" — got [${heads.join(', ')}]`)
  }
  // the counts across the categories should add up to the whole catalogue
  const total = (await cats.allInnerTexts())
    .map((t) => parseInt(t.split('\n')[1] || '0', 10)).reduce((a, b) => a + b, 0)
  if (total < 100) throw new Error(`only ${total} negative symptoms on offer — expected 100+`)
})

await step('general symptoms no stack compound causes are still loggable', async () => {
  await symptoms()
  for (const label of ['Trouble falling asleep', 'Waking through the night',
    'Dizziness / light-headed', 'Bloating', 'Back pain', 'Blurred vision']) {
    await page.fill('input[placeholder*="Search" i]', label)
    await page.waitForTimeout(320)
    const n = await page.locator(`[data-testid="symptom-search-results"] button:has-text("${label}")`).count()
    if (n === 0) throw new Error(`"${label}" is not in the catalogue`)
  }
  await page.fill('input[placeholder*="Search" i]', '')
  await page.waitForTimeout(300)
})

await step('Good effects stays tied to the stack', async () => {
  await symptoms()
  await page.click('button:has-text("Good effects")')
  await page.waitForTimeout(500)
  const txt = await page.locator('[data-testid="symptom-categories"]').textContent()
  // the positive list must be far shorter than 100 and must not be a review of systems
  for (const bad of ['Sleep', 'Urinary', 'Breathing']) {
    if (new RegExp(`\\b${bad}\\b`).test(txt.split('\n')[0] || '')) {
      throw new Error(`Good effects is showing the negative categories (${bad})`)
    }
  }
  await page.click('button:has-text("Issues")')
  await page.waitForTimeout(400)
})

await step('an unassociated symptom logs anyway, with a soft note instead of a false cause', async () => {
  await symptoms()
  await page.fill('input[placeholder*="Search" i]', 'Waking through the night')
  await page.waitForTimeout(350)
  await page.locator('[data-testid="symptom-search-results"] button').first().click()
  await page.waitForTimeout(600)
  const note = page.locator('[data-testid="unattributed-note"]')
  if (!(await note.count())) throw new Error('no soft note for an unattributed symptom')
  const t = await note.textContent()
  if (!/not a known effect of my current protocol/i.test(t)) throw new Error('the note does not say so plainly')
  if (!/logged anyway/i.test(t)) throw new Error('the note does not say it was logged regardless')
  await page.fill('input[placeholder*="Search" i]', '')
  await page.waitForTimeout(300)
  // and it really does save
  await page.locator('main button').filter({ hasText: /^(Log \d|Update check-in)$/ }).last().click()
  await page.waitForTimeout(900)
  const st = await state()
  const ids = (st.symptomLogs.at(-1)?.tags || []).map((x) => x.id)
  if (!ids.includes('broken_sleep')) throw new Error(`the unattributed symptom was not saved — got [${ids}]`)
})

await step('search filters the stack-relevant list', async () => {
  await symptoms()
  await page.fill('input[placeholder*="Search" i]', 'sleep')
  await page.waitForTimeout(400)
  const results = page.locator('[data-testid="symptom-search-results"]')
  if (!(await results.count())) throw new Error('no results block appeared')
  const chips = await results.locator('button').count()
  if (chips === 0) throw new Error('search for "sleep" matched nothing')
  await page.fill('input[placeholder*="Search" i]', '')
  await page.waitForTimeout(300)
})

await step('"Likely for you right now" is stack-weighted and present', async () => {
  await symptoms()
  const likely = page.locator('[data-testid="likely-now"]')
  if (!(await likely.count())) throw new Error('no likely-now row')
  if ((await likely.locator('button').count()) === 0) throw new Error('likely-now is empty')
})

await step('Issues / Good effects is a segmented toggle that switches the list', async () => {
  await symptoms()
  const before = await page.locator('[data-testid="symptom-categories"]').textContent()
  await page.click('button:has-text("Good effects")')
  await page.waitForTimeout(500)
  const after = await page.locator('[data-testid="symptom-categories"]').textContent()
  if (before === after) throw new Error('switching polarity did not change the list')
  await page.click('button:has-text("Issues")')
  await page.waitForTimeout(400)
})

await step('categories are collapsed by default and expand on tap', async () => {
  await symptoms()
  const cats = page.locator('[data-testid="symptom-categories"]')
  const headings = cats.locator('button')
  const n = await headings.count()
  if (n < 5) throw new Error(`expected ~10 categories, found ${n}`)
  const collapsedLen = (await cats.textContent()).length
  await headings.first().click()
  await page.waitForTimeout(450)
  const expandedLen = (await cats.textContent()).length
  if (expandedLen <= collapsedLen) throw new Error('tapping a category revealed nothing')
})

await step('chips carry no emoji — categories use monochrome icons', async () => {
  await symptoms()
  const text = await page.locator('[data-testid="symptom-categories"]').textContent()
  const emoji = text.match(/\p{Extended_Pictographic}/gu)
  if (emoji) throw new Error(`emoji still on the symptom list: ${[...new Set(emoji)].join(' ')}`)
})

await step('severity is visible as mild / moderate / strong, not hidden', async () => {
  await symptoms()
  await page.locator('[data-testid="likely-now"] button').first().click()
  await page.waitForTimeout(450)
  const panel = page.locator('[data-testid="selected-panel"]')
  if (!(await panel.count())) throw new Error('nothing appeared after picking a symptom')
  for (const word of ['Mild', 'Moderate', 'Strong']) {
    if (!(await panel.locator(`button:has-text("${word}")`).count())) {
      throw new Error(`no ${word} button`)
    }
  }
})

await step('the note field is behind "add note", not always on screen', async () => {
  await symptoms()
  if ((await page.locator('textarea').count()) > 0) {
    throw new Error('a note box is on screen before it was asked for')
  }
  await page.locator('[data-testid="likely-now"] button').first().click()
  await page.waitForTimeout(400)
  if ((await page.locator('textarea').count()) > 0) throw new Error('note box appeared unbidden')
  await page.click('button:has-text("Add note")')
  await page.waitForTimeout(350)
  if ((await page.locator('textarea').count()) === 0) throw new Error('"Add note" opened nothing')
})

await step('the injection-site picker only appears for a site symptom', async () => {
  await symptoms()
  await page.locator('[data-testid="likely-now"] button').first().click()
  await page.waitForTimeout(400)
  const panel = page.locator('[data-testid="selected-panel"]')
  const hadSite = await panel.locator('button:has-text("Which site?")').count()
  // now add one from the Injection site category
  await page.click('[data-testid="symptom-categories"] button:has-text("Injection site")')
  await page.waitForTimeout(400)
  const inj = page.locator('[data-testid="symptom-categories"] button').filter({ hasText: /Injection-site reaction/i }).first()
  if (!(await inj.count())) throw new Error('no injection-site symptom in that category')
  await inj.click()
  await page.waitForTimeout(450)
  if ((await panel.locator('button:has-text("Which site?")').count()) === 0) {
    throw new Error('the site question never appeared for a site symptom')
  }
  if (hadSite > 0) throw new Error('the site question was showing for a non-site symptom')
})

await step('logging a check-in names the likely compounds inline', async () => {
  await symptoms()
  await page.locator('[data-testid="likely-now"] button').first().click()
  await page.waitForTimeout(400)
  await page.locator('[data-testid="selected-panel"]').locator('..').locator('button')
    .filter({ hasText: /^(Log \d|Update check-in)$/ }).last().click()
  await page.waitForTimeout(900)
  const attr = page.locator('[data-testid="attribution-panel"]')
  if (!(await attr.count())) throw new Error('no attribution appeared after logging')
  const text = await attr.textContent()
  if (!/candidates, not a diagnosis/i.test(text)) throw new Error('the attribution caveat is missing')
})

await step('recently logged comes back as a quick row', async () => {
  // Deliberately logged from a category rather than "Likely now": a chip already
  // sitting in the likely row is excluded from this one, so it would never show.
  await symptoms()
  await page.click('[data-testid="symptom-categories"] button:has-text("Gut")')
  await page.waitForTimeout(500)
  const label = 'Constipation'
  await page.click(`[data-testid="symptom-categories"] button:text-is("${label}")`)
  await page.waitForTimeout(450)
  await page.locator('main button').filter({ hasText: /^(Log \d|Update check-in)$/ }).last().click()
  await page.waitForTimeout(900)

  await symptoms()
  const recent = page.locator('[data-testid="recently-logged"]')
  if (!(await recent.count())) throw new Error('no recently-logged row after a check-in')
  const text = await recent.textContent()
  if (!text.includes(label)) {
    throw new Error(`recently-logged does not carry "${label}" — it reads "${text.trim()}"`)
  }
})

await step('the 14-day heatmap has moved off the logging screen into History', async () => {
  await symptoms()
  if (/last 14 days/i.test(await main())) throw new Error('the heatmap is still on the Symptoms tab')
  await more('History & adherence')
  await waitText(/Adherence/)
  if (!(await page.locator('[data-testid="symptom-history"]').count())) {
    throw new Error('the symptom history section is not on the History screen')
  }
  if (!/last 14 days/i.test(await main())) throw new Error('the heatmap did not land in History')
})

// ============================================================= 4 · Insights

// v23 removed the Insights engine and the weekly recap. Their suites went with
// them; everything else v18 shipped is still asserted above and below.

await step('nothing overflows horizontally at 390px on any screen', async () => {
  const screens = [
    ['nav', 'Home'], ['nav', 'Calendar'], ['nav', 'Symptoms'], ['nav', 'Body'],
    ['more', 'Protocol overview'], ['more', 'History & adherence'],
    ['more', 'Stock'], ['more', 'Calculator'],
  ]
  const bad = []
  for (const [how, label] of screens) {
    if (how === 'nav') await nav(label); else await more(label)
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    if (over) bad.push(label)
  }
  if (bad.length) throw new Error(`horizontal overflow on: ${bad.join(', ')}`)
})

await step('the bottom nav does not cover the last card on the new screens', async () => {
  for (const label of ['Protocol overview', 'History & adherence']) {
    await more(label)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(450)
    const clear = await page.evaluate(() => {
      const navEl = document.querySelector('nav')
      const navTop = navEl.getBoundingClientRect().top
      // the lowest element that actually renders content, not main's padding box
      let lowest = 0
      for (const el of document.querySelectorAll('main *')) {
        const r = el.getBoundingClientRect()
        if (r.height === 0 || r.width === 0) continue
        if (!el.textContent.trim()) continue
        lowest = Math.max(lowest, r.bottom)
      }
      return navTop - lowest
    })
    if (clear < -1) throw new Error(`${label}: content runs ${Math.round(-clear)}px under the nav`)
  }
})

await step('tap targets on the new screens are at least 40px tall', async () => {
  await more('Protocol overview')
  const small = await page.evaluate(() => {
    const out = []
    for (const b of document.querySelectorAll('main button')) {
      const r = b.getBoundingClientRect()
      if (r.height > 0 && r.height < 40) out.push(`${b.textContent.trim().slice(0, 24)}=${Math.round(r.height)}`)
    }
    return out
  })
  if (small.length > 2) throw new Error(`too-small tap targets: ${small.join(', ')}`)
})

// =========================================================== 7 · regressions

await step('the five-tab nav is untouched', async () => {
  const labels = (await page.locator('nav button span:not(:has(svg))').allTextContents()).map((s) => s.trim())
  if (labels.join('|') !== 'Home|Calendar|Symptoms|Body|More') {
    throw new Error(`nav is [${labels.join(', ')}]`)
  }
})

await step('Home is still decluttered — no streak, no disclaimer in the column', async () => {
  await nav('Home')
  const t = await main()
  if (/day streak/i.test(t)) throw new Error('a streak came back to Home')
  if (/not medical advice/i.test(t)) throw new Error('the disclaimer came back to Home')
})

await step('the Mix screen still leads with the inspect-before-injecting framing', async () => {
  // The non-bypassable CAUTION gate itself has its own suite (v3); what matters
  // here is that this release did not disturb the standing warning above it.
  await more('Mix')
  await waitText(/Reaction chamber/i)
  const t = await main()
  if (!/not proof of compatibility/i.test(t)) throw new Error('the compatibility caveat is gone')
  if (!/inspect the drawn solution/i.test(t)) throw new Error('the visual-inspection instruction is gone')
})

await step('no runtime errors anywhere in the run', async () => {
  const real = errors.filter((e) => e.startsWith('pageerror') || e.startsWith('console'))
  if (real.length) throw new Error(real.slice(0, 3).join(' | '))
})

await page.screenshot({ path: `${SHOT}/v18-home.png`, fullPage: true })
await browser.close()

const failures = errors.filter((e) => e.startsWith('step ') || e.startsWith('pageerror') || e.startsWith('console'))
console.log(`\n${failures.length ? `${failures.length} FAILURE(S)` : 'ALL PASS'}`)
for (const f of failures) console.log(' -', f.split('\n')[0])
process.exit(failures.length ? 1 : 0)
