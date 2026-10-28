// Reading an Evolt 360 report straight from its PDF.
//
// Only page 1 and the "YOUR NUTRITION" section are read. Values are found by
// their labels and by where they sit on the page (see pdfLines.ts), never by
// the order the text came out in. The result has the same shape as one scan
// in src/data/evolt_scans.json, so it becomes an entry through the same
// `scanFromImport` as every scan already on record. `checkEvolt` then checks
// the scan's own sums; any failure makes it "Needs a check" and it is never
// saved without being looked at.

import { type PdfLine, xMid } from './pdfLines'

export const isEvoltText = (text: string) => /VOLT\s*360/i.test(text)

interface Tok { li: number; v: number; raw: string; start: number; end: number; x: number; pct: boolean }

const NUM = /(?<![\d.])(\d+(?:\.\d+)?|\.\d+)(?![\d])/g

function tokensOf(lines: PdfLine[], li: number): Tok[] {
  const line = lines[li]
  if (!line) return []
  const out: Tok[] = []
  for (const m of line.text.matchAll(NUM)) {
    const start = m.index as number
    const end = start + m[0].length
    out.push({ li, v: Number(m[1]), raw: m[1], start, end, x: xMid(line, start, end), pct: /^\s*%/.test(line.text.slice(end)) })
  }
  return out
}

const tokKey = (t: { li: number; start: number }) => `${t.li}:${t.start}`

/** One parse: the lines, and every number already given to a field. */
class Reader {
  used = new Set<string>()
  constructor(public lines: PdfLine[]) {}

  find(re: RegExp, from = 0, to = this.lines.length): { li: number; start: number; end: number; x: number } | null {
    for (let li = Math.max(0, from); li < Math.min(to, this.lines.length); li++) {
      const m = this.lines[li].text.match(re)
      if (m && m.index != null) return { li, start: m.index, end: m.index + m[0].length, x: xMid(this.lines[li], m.index, m.index + m[0].length) }
    }
    return null
  }

  take(t: Tok | null): Tok | null { if (t) this.used.add(tokKey(t)); return t }

  free(li: number, ok: (t: Tok) => boolean): Tok[] {
    return tokensOf(this.lines, li).filter((t) => !this.used.has(tokKey(t)) && ok(t))
  }

  /**
   * The number that belongs to a label: on the same line straight after it
   * (only units or punctuation between), else the nearest by x on the lines
   * below.
   */
  near(re: RegExp, ok: (t: Tok) => boolean, o: { from?: number; to?: number; below?: number; maxDx?: number } = {}): Tok | null {
    const at = this.find(re, o.from, o.to)
    if (!at) return null
    const line = this.lines[at.li]
    const same = this.free(at.li, ok).filter((t) => t.start >= at.end)[0]
    if (same && !/[a-z]/i.test(line.text.slice(at.end, same.start).replace(/\b(kg|cm|kcal|cm²|cm2|years?|yrs|ratio)\b/gi, ''))) return this.take(same)
    const maxDx = o.maxDx ?? 90
    for (let d = 1; d <= (o.below ?? 4); d++) {
      const best = this.free(at.li + d, ok).map((t) => ({ t, dx: Math.abs(t.x - at.x) })).filter((c) => c.dx <= maxDx).sort((a, b) => a.dx - b.dx)[0]
      if (best) return this.take(best.t)
    }
    return null
  }
}

/** "(23.7%)" straight after a value. */
function pctAfter(line: PdfLine, t: Tok): number | null {
  const m = line.text.slice(t.end).match(/^\s*(?:kg|cm)?\s*\(\s*(\d+(?:\.\d+)?)\s*%\s*\)/i)
  return m ? Number(m[1]) : null
}

// ------------------------------------------------------- the numbered blocks

const LABEL_KEYS: Array<[RegExp, string | null]> = [
  [/VISCERAL\s+FAT\s+LEVEL/i, 'visceral_fat_level'],
  [/VISCERAL\s+FAT\s+AREA/i, 'visceral_fat_area_cm2'],
  [/WAIST/i, 'waist_hip_ratio'],
  [/SKELETAL/i, 'skeletal_muscle_mass_kg'],
  [/LEAN/i, 'lean_body_mass_kg'],
  [/PROTEIN/i, 'protein_kg'],
  [/MINERAL/i, 'mineral_kg'],
  [/WATER\s+INDEX|\bBWI\b/i, 'bwi_score'],
  [/BODY\s+WATER|\bTBW\b/i, 'total_body_water_kg'],
  [/FAT\s+MASS/i, 'fat_mass_kg'],
  [/BODY\s+FAT|\bPBF\b|FAT\s*%/i, 'body_fat_pct'],
  [/\bBMR\b|BASAL/i, 'bmr_kcal'],
  [/\bBMI\b/i, null],
  [/WEIGHT/i, 'weight_kg'],
]

export const keyForLabel = (label: string): string | null => {
  for (const [re, key] of LABEL_KEYS) if (re.test(label)) return key
  return null
}

const LABEL = /(?:^|\s)(\d{1,2})\s?\.\s+([A-Za-z][A-Za-z0-9 %&()/'-]*?)(?=\s+\d{1,2}\s?\.\s+[A-Za-z]|\s*$)/g
/** "66.5 / High [47.3 - 57.8]", "13 / Over Range [1 - 9]", "0.93 / High [0.75-0.90]" */
const VALUE = /(\d+(?:\.\d+)?|\.\d+)\s*(?:kg|cm²|cm2|cm|%|kcal)?\s*\/\s*([A-Za-z]+(?:\s+Range)?)\s*(?:\[\s*(\d*\.?\d+)\s*[-–~]\s*(\d*\.?\d+)\s*\])?/g

interface Numbered { key: string; value: number; status: string; range: [number, number] | null }

function numberedBlocks(r: Reader, to: number): Numbered[] {
  const out: Numbered[] = []
  for (let li = 0; li < to; li++) {
    const line = r.lines[li]
    const labels = [...line.text.matchAll(LABEL)]
      .map((m) => {
        const start = (m.index as number) + m[0].indexOf(m[1])
        return { key: keyForLabel(m[2]), x: xMid(line, start, (m.index as number) + m[0].length) }
      })
    if (!labels.length) continue
    // the value row: the first line below with "value / status" pieces
    for (let d = 1; d <= 4 && li + d < to; d++) {
      const vl = r.lines[li + d]
      const values = [...vl.text.matchAll(VALUE)].map((m) => ({
        m, x: xMid(vl, m.index as number, (m.index as number) + m[1].length),
      }))
      if (!values.length) continue
      values.forEach((v, i) => {
        const label = labels.length === values.length ? labels[i] : labels.slice().sort((a, b) => Math.abs(a.x - v.x) - Math.abs(b.x - v.x))[0]
        if (!label?.key) return
        const [, n, status, lo, hi] = v.m
        out.push({ key: label.key, value: Number(n), status: status.replace(/\s+/g, ' '), range: lo != null && hi != null ? [Number(lo), Number(hi)] : null })
        // the number is spoken for
        r.used.add(`${li + d}:${v.m.index}`)
        for (const t of tokensOf(r.lines, li + d)) if (t.start >= (v.m.index as number) && t.end <= (v.m.index as number) + v.m[0].length) r.used.add(tokKey(t))
      })
      break
    }
  }
  return out
}

// -------------------------------------------------------------- the parse

const REGIONS: Array<[RegExp, string]> = [
  [/LEFT\s+ARM/i, 'left_arm'], [/RIGHT\s+ARM/i, 'right_arm'], [/TORSO|TRUNK/i, 'torso'], [/LEFT\s+LEG/i, 'left_leg'], [/RIGHT\s+LEG/i, 'right_leg'],
]

const BALANCE: Array<[RegExp, string]> = [
  [/extremely\s+(?:un|im)balanced/i, 'Extremely unbalanced'],
  [/slightly\s+(?:un|im)balanced/i, 'Slightly unbalanced'],
  [/(?:un|im)balanced/i, 'Unbalanced'],
  [/balanced/i, 'Balanced'],
]
const BALANCE_ANY = /(?:extremely\s+|slightly\s+)?(?:un|im)?balanced/gi

/** "Upper - Lower" and "Left - Right" wording to a status word. */
export function balanceStatus(words: string | null | undefined): string | null {
  if (!words) return null
  for (const [re, s] of BALANCE) if (re.test(words)) return s
  return null
}

export interface EvoltRead {
  /** one scan in the evolt_scans.json shape */
  raw: Record<string, unknown>
  /** fields looked for and not found */
  missing: string[]
}

const r1 = (v: number) => Math.round(v * 10) / 10

export function parseEvoltLines(all: PdfLine[]): EvoltRead {
  const page1 = all.filter((l) => l.page === 1)
  const r = new Reader(page1)
  const raw: Record<string, unknown> = { device: 'Evolt 360' }
  const status: Record<string, string> = {}
  const ranges: Record<string, [number, number]> = {}
  const text = page1.map((l) => l.text).join('\n')

  const d = text.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\s+(\d{1,2}):(\d{2})/)
  if (d) {
    raw.date = `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`
    raw.time = `${d[4].padStart(2, '0')}:${d[5]}`
  }
  const h = text.match(/(\d{2,3}(?:\.\d)?)\s*cm\s+(\d{2,3}(?:\.\d+)?)\s*kg\s+(\d{1,3})\s*(?:years?|yrs?)?\s*(Male|Female)/i)
  if (h) {
    raw.height_cm = Number(h[1]); raw.weight_kg = Number(h[2]); raw.age = Number(h[3]); raw.sex = h[4][0].toUpperCase() + h[4].slice(1).toLowerCase()
    const at = r.find(/\d{2,3}(?:\.\d)?\s*cm\s+\d{2,3}(?:\.\d+)?\s*kg/)
    if (at) for (const t of tokensOf(page1, at.li)) r.used.add(tokKey(t))
  }

  for (const n of numberedBlocks(r, page1.length)) {
    if (raw[n.key] != null && n.key !== 'weight_kg') continue
    if (n.key === 'weight_kg' && raw.weight_kg != null) { status.weight_kg = n.status; if (n.range) ranges.weight_kg = n.range; continue }
    raw[n.key] = n.value
    if (n.status) status[n.key] = n.status
    if (n.range) ranges[n.key] = n.range
  }

  const inRange = (lo: number, hi: number) => (t: Tok) => !t.pct && t.v >= lo && t.v <= hi
  const set = (key: string, t: Tok | null) => { if (t && raw[key] == null) raw[key] = t.v }

  // fallbacks for values that were not in a numbered block
  if (raw.lean_body_mass_kg == null) set('lean_body_mass_kg', r.near(/LEAN\s+BODY\s+MASS/i, inRange(20, 150)))
  if (raw.fat_mass_kg == null) set('fat_mass_kg', r.near(/(?:BODY\s+)?FAT\s+MASS/i, inRange(1, 150)))
  if (raw.total_body_water_kg == null) set('total_body_water_kg', r.near(/TOTAL\s+BODY\s+WATER/i, inRange(10, 100)))

  // ICF and ECF: the values are not on their labels' row. Take them by
  // position around the labelled row and keep the pair that adds up to total body water.
  const icfAt = r.find(/\bICF\b|INTRACELLULAR/i)
  const ecfAt = r.find(/\bECF\b|EXTRACELLULAR/i)
  if (icfAt && ecfAt) {
    const around = (at: { li: number; x: number }) => {
      const c: Array<{ t: Tok; score: number }> = []
      for (let li = at.li - 3; li <= at.li + 4; li++) {
        for (const t of r.free(li, inRange(3, 70))) c.push({ t, score: Math.abs(t.x - at.x) + Math.abs(li - at.li) * 20 })
      }
      return c.sort((a, b) => a.score - b.score).slice(0, 4).map((c) => c.t)
    }
    const ic = around(icfAt)
    const ec = around(ecfAt)
    const tbw = raw.total_body_water_kg as number | undefined
    let pick: [Tok, Tok] | null = null
    let best = Infinity
    for (const i of ic) {
      for (const e of ec) {
        if (tokKey(i) === tokKey(e)) continue
        const miss = tbw != null ? Math.abs(i.v + e.v - tbw) : 0
        if (miss < best - 1e-9) { best = miss; pick = [i, e] }
      }
    }
    if (pick && (tbw == null || best > 0.3)) pick = ic[0] && ec[0] && tokKey(ic[0]) !== tokKey(ec[0]) ? [ic[0], ec[0]] : pick
    if (pick) {
      const [i, e] = pick
      r.take(i); r.take(e)
      raw.icf_kg = i.v; raw.ecf_kg = e.v
      const ip = pctAfter(page1[i.li], i); const ep = pctAfter(page1[e.li], e)
      if (ip != null) raw.icf_pct = ip
      if (ep != null) raw.ecf_pct = ep
      if (raw.icf_pct == null && raw.ecf_pct == null && i.v + e.v > 0) {
        raw.icf_pct = Math.round((i.v / (i.v + e.v)) * 100); raw.ecf_pct = 100 - (raw.icf_pct as number)
      }
    }
  }

  const withPct = (re: RegExp, kg: string, pct: string, lo: number, hi: number) => {
    const t = r.near(re, inRange(lo, hi))
    if (!t) return
    raw[kg] = t.v
    const p = pctAfter(page1[t.li], t)
    if (p != null) raw[pct] = p
  }
  withPct(/SUBCUTANEOUS/i, 'subcutaneous_fat_kg', 'subcutaneous_fat_pct', 0.5, 100)
  withPct(/VISCERAL\s+FAT(?!\s*(?:AREA|LEVEL))/i, 'visceral_fat_kg', 'visceral_fat_pct', 0.1, 40)
  if (raw.visceral_fat_area_cm2 == null) set('visceral_fat_area_cm2', r.near(/VISCERAL\s+FAT\s+AREA/i, inRange(10, 400)))
  if (raw.visceral_fat_level == null) set('visceral_fat_level', r.near(/VISCERAL\s+FAT\s+LEVEL/i, inRange(1, 30)))
  set('abdominal_circumference_cm', r.near(/ABDOMINAL/i, inRange(40, 200)))
  if (raw.bmr_kcal == null) set('bmr_kcal', r.near(/\bBMR\b|BASAL\s+METABOLIC/i, inRange(600, 4500)))
  set('tee_kcal', r.near(/\bTEE\b|TOTAL\s+ENERGY/i, inRange(800, 8000)))
  set('bio_age', r.near(/BIO(?:LOGICAL)?\s*AGE/i, inRange(5, 110)))
  if (raw.bwi_score == null) set('bwi_score', r.near(/\bBWI\b|BODY\s+WATER\s+INDEX/i, inRange(0, 10)))

  // waist to hip ratio: its value and its own range pattern ("0.75 - 0.90", no brackets)
  const whrAt = r.find(/WAIST\s*(?:TO\s*)?[-/]?\s*HIP(?:\s+RATIO)?/i)
  if (raw.waist_hip_ratio == null) set('waist_hip_ratio', r.near(/WAIST\s*(?:TO\s*)?[-/]?\s*HIP(?:\s+RATIO)?/i, inRange(0.4, 1.6), { maxDx: 140 }))
  if (whrAt && !ranges.waist_hip_ratio) {
    for (let li = Math.max(0, whrAt.li - 1); li <= whrAt.li + 3 && li < page1.length; li++) {
      const m = page1[li].text.match(/(?<![\d.])(0?\.\d{1,2})\s*[-–~]\s*(0?\.\d{1,2}|1(?:\.0{1,2})?)(?![\d])/)
      if (m) {
        ranges.waist_hip_ratio = [Number(m[1]), Number(m[2])]
        for (const t of tokensOf(page1, li)) if (t.start >= (m.index as number) && t.end <= (m.index as number) + m[0].length) r.used.add(tokKey(t))
        break
      }
    }
  }

  // segmental lean and fat, by region title, never by order alone
  const titles: Array<{ key: string; li: number; start: number; end: number; x: number }> = []
  for (const [re, key] of REGIONS) {
    const at = r.find(new RegExp(re.source, 'i'))
    if (at) titles.push({ key, ...at })
  }
  if (titles.length) {
    const first = Math.min(...titles.map((t) => t.li))
    const last = Math.max(...titles.map((t) => t.li)) + 4
    const claimed: Record<string, Tok[]> = Object.fromEntries(titles.map((t) => [t.key, []]))
    for (let li = first; li <= last && li < page1.length; li++) {
      for (const t of r.free(li, (x) => !x.pct && /\./.test(x.raw) && x.v > 0 && x.v < 60)) {
        let owner: (typeof titles)[number] | null = null
        let score = Infinity
        for (const ti of titles) {
          if (li < ti.li || li - ti.li > 4) continue
          if (li === ti.li) {
            // on the title's own line: after the title, before the next title on that line
            const nextOnLine = titles.filter((o) => o.li === li && o.start > ti.start).sort((a, b) => a.start - b.start)[0]
            if (t.start < ti.end || (nextOnLine && t.start > nextOnLine.start)) continue
          }
          const s = (li - ti.li) * 40 + Math.abs(t.x - ti.x)
          if (s < score) { score = s; owner = ti }
        }
        if (owner) claimed[owner.key].push(t)
      }
    }
    const seg: Record<string, { lean_kg?: number; fat_kg?: number }> = {}
    for (const ti of titles) {
      const [lean, fat] = claimed[ti.key].sort((a, b) => a.li - b.li || a.x - b.x)
      if (lean && fat) { r.take(lean); r.take(fat); seg[ti.key] = { lean_kg: lean.v, fat_kg: fat.v } }
    }
    if (Object.keys(seg).length) raw.segmental = seg
  }

  // balance: "Upper - Lower" and "Left - Right" to a status
  const balance: Record<string, string> = {}
  for (const [re, key] of [[/UPPER\s*[-–]\s*LOWER/i, 'upper_lower'], [/LEFT\s*[-–]\s*RIGHT/i, 'left_right']] as const) {
    const at = r.find(re)
    if (!at) continue
    const line = page1[at.li]
    const sameLine = [...line.text.matchAll(BALANCE_ANY)].filter((m) => (m.index as number) >= at.end)
    const other = re.source.startsWith('UPPER') ? /LEFT\s*[-–]\s*RIGHT/i : /UPPER\s*[-–]\s*LOWER/i
    const otherAt = line.text.slice(at.end).search(other)
    const mine = sameLine.find((m) => otherAt < 0 || (m.index as number) < at.end + otherAt)
    let words: string | null = mine ? mine[0] : null
    for (let dd = 1; !words && dd <= 3 && at.li + dd < page1.length; dd++) {
      const l = page1[at.li + dd]
      const near = [...l.text.matchAll(BALANCE_ANY)].map((m) => ({ w: m[0], dx: Math.abs(xMid(l, m.index as number, (m.index as number) + m[0].length) - at.x) }))
        .filter((c) => c.dx <= 120).sort((a, b) => a.dx - b.dx)[0]
      if (near) words = near.w
    }
    const s = balanceStatus(words)
    if (s) balance[key] = s
  }
  if (Object.keys(balance).length) raw.balance = balance

  // YOUR NUTRITION: calories and the three macros, ranges optional
  const nIdx = all.findIndex((l) => /YOUR\s+NUTRITION/i.test(l.text))
  if (nIdx >= 0) {
    const nl = all.slice(nIdx, nIdx + 40)
    const rec: Record<string, [number, number]> = {}
    for (const l of nl) {
      const m = l.text.match(/(?<![\d.])(\d{3,4})\s*(?:kcal)?\s*[-–]\s*(\d{3,4})(?![\d])/)
      if (m && Number(m[1]) >= 800) { rec.calories_kcal = [Number(m[1]), Number(m[2])]; break }
    }
    const nr = new Reader(nl)
    const MACRO = /(\d{1,4})\s*g\s*[-–]\s*(\d{1,4})\s*g(?:\s*\(\s*\d+\s*%\s*\))?/g
    const usedMacro = new Set<string>()
    for (const [re, key] of [[/PROTEIN/i, 'protein_g'], [/CARB/i, 'carbs_g'], [/\bFATS?\b/i, 'fat_g']] as const) {
      const at = nr.find(re)
      if (!at) continue
      let best: { lo: number; hi: number; k: string; s: number } | null = null
      for (let li = at.li; li <= at.li + 4 && li < nl.length; li++) {
        for (const m of nl[li].text.matchAll(MACRO)) {
          const k = `${li}:${m.index}`
          if (usedMacro.has(k) || (li === at.li && (m.index as number) < at.start)) continue
          const s = (li - at.li) * 40 + Math.abs(xMid(nl[li], m.index as number, (m.index as number) + m[0].length) - at.x)
          if (!best || s < best.s) best = { lo: Number(m[1]), hi: Number(m[2]), k, s }
        }
      }
      if (best) { usedMacro.add(best.k); rec[key] = [best.lo, best.hi] }
    }
    if (Object.keys(rec).length) raw.evolt_recommendations = rec
  }

  if (Object.keys(status).length) raw.status = status
  if (Object.keys(ranges).length) raw.reference_ranges = ranges
  for (const k of ['weight_kg', 'lean_body_mass_kg', 'fat_mass_kg', 'body_fat_pct']) if (typeof raw[k] === 'number') raw[k] = r1(raw[k] as number)

  const WANTED = ['date', 'time', 'height_cm', 'weight_kg', 'age', 'lean_body_mass_kg', 'fat_mass_kg', 'body_fat_pct', 'skeletal_muscle_mass_kg',
    'protein_kg', 'mineral_kg', 'total_body_water_kg', 'icf_kg', 'ecf_kg', 'subcutaneous_fat_kg', 'visceral_fat_kg', 'visceral_fat_area_cm2',
    'visceral_fat_level', 'abdominal_circumference_cm', 'waist_hip_ratio', 'bmr_kcal', 'tee_kcal', 'bio_age', 'bwi_score', 'segmental', 'balance']
  const missing = WANTED.filter((k) => raw[k] == null)
  return { raw, missing }
}

// -------------------------------------------------------------- the checks

export const EVOLT_TOLERANCE = { weight: 0.3, water: 0.3, segmentFat: 1.0, bodyFatPct: 0.5 }

export interface CheckResult { ok: boolean; problems: string[] }

/**
 * The scan's own sums. Lean + fat within 0.3 kg of weight, ICF + ECF within
 * 0.3 kg of total body water, body fat % within 0.5 of fat over weight, and
 * the five regions: fat within 1.0 kg of fat mass, lean no more than lean
 * body mass and at least three quarters of it (the head and neck are lean
 * mass in no region, so the five never add up to all of it).
 */
export function checkEvolt(raw: Record<string, unknown>): CheckResult {
  const problems: string[] = []
  const n = (k: string) => (typeof raw[k] === 'number' ? (raw[k] as number) : null)
  const w = n('weight_kg'); const lean = n('lean_body_mass_kg'); const fat = n('fat_mass_kg')
  if (!raw.date) problems.push('No scan date found')
  if (w == null) problems.push('No weight found')
  if (lean == null) problems.push('No lean body mass found')
  if (fat == null) problems.push('No fat mass found')
  if (w != null && lean != null && fat != null && Math.abs(lean + fat - w) > EVOLT_TOLERANCE.weight + 1e-9) problems.push(`Lean ${lean} + fat ${fat} is not weight ${w}`)
  const tbw = n('total_body_water_kg'); const icf = n('icf_kg'); const ecf = n('ecf_kg')
  if (tbw != null && (icf == null || ecf == null)) problems.push('ICF or ECF not found')
  if (tbw != null && icf != null && ecf != null && Math.abs(icf + ecf - tbw) > EVOLT_TOLERANCE.water + 1e-9) problems.push(`ICF ${icf} + ECF ${ecf} is not total body water ${tbw}`)
  const bf = n('body_fat_pct')
  if (bf != null && w && fat != null && Math.abs((fat / w) * 100 - bf) > EVOLT_TOLERANCE.bodyFatPct + 1e-9) problems.push(`Body fat ${bf}% does not match fat mass over weight`)
  const seg = raw.segmental as Record<string, { lean_kg?: number; fat_kg?: number }> | undefined
  const regions = ['left_arm', 'right_arm', 'torso', 'left_leg', 'right_leg']
  if (!seg || regions.some((k) => seg[k]?.lean_kg == null || seg[k]?.fat_kg == null)) problems.push('Not all five regions found')
  else {
    const leanSum = regions.reduce((s, k) => s + (seg[k].lean_kg as number), 0)
    const fatSum = regions.reduce((s, k) => s + (seg[k].fat_kg as number), 0)
    if (fat != null && Math.abs(fatSum - fat) > EVOLT_TOLERANCE.segmentFat + 1e-9) problems.push(`The five regions' fat (${fatSum.toFixed(2)}) is not fat mass ${fat}`)
    if (lean != null && (leanSum > lean + EVOLT_TOLERANCE.segmentFat || leanSum < lean * 0.75)) problems.push(`The five regions' lean (${leanSum.toFixed(2)}) does not fit lean body mass ${lean}`)
  }
  return { ok: !problems.length, problems }
}
