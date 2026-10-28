// The PDF path end to end through pdf.js (the Node build of the same library).
//
// 1. A PDF written here with the app's own PDF writer, its text drawn out of
//    reading order, proves extraction, line rebuilding and the parser together.
// 2. The real reports in test-fixtures/private/ (never committed). With the
//    folder empty these tests are skipped and say so.

/* global process */
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PdfDoc } from '../../lib/pdf/pdfDoc'
import { itemsFromPdf } from './pdfItems'
import { rebuildLines } from './pdfLines'
import { parseEvoltLines, checkEvolt, isEvoltText } from './evoltPdf'
import { parseWithingsReport, isWithingsReportText } from './withings'
import { scanFromImport } from '../scanImport'
import { EVOLT_26_OCT_PAGE1, EVOLT_26_OCT_NUTRITION, EVOLT_26_OCT_EXPECTED } from './fixtures'

const pdfjs = () => import('pdfjs-dist/legacy/build/pdf.mjs')

/** Each fixture line's columns as separate text runs, drawn bottom to top and right to left. */
function writtenPdf() {
  const doc = new PdfDoc({ title: 'test' })
  const pages = [EVOLT_26_OCT_PAGE1, EVOLT_26_OCT_NUTRITION]
  pages.forEach((text, pi) => {
    if (pi) doc.addPage()
    const runs = []
    text.split('\n').forEach((line, li) => {
      for (const m of line.matchAll(/\S+(?: \S+)*/g)) runs.push([30 + m.index * (108 / 28), 40 + li * 16, m[0]])
    })
    for (const [x, y, s] of runs.reverse()) doc.text(x, y, s, { size: 7.5 })
  })
  return doc.output()
}

describe('PDF extraction end to end', () => {
  it('reads an Evolt-shaped PDF written out of order', async () => {
    const lines = rebuildLines(await itemsFromPdf(await pdfjs(), writtenPdf()))
    expect(isEvoltText(lines.map((l) => l.text).join('\n'))).toBe(true)
    const read = parseEvoltLines(lines)
    const { entry } = scanFromImport(read.raw)
    for (const [k, v] of Object.entries(EVOLT_26_OCT_EXPECTED)) expect([k, entry?.[k]]).toEqual([k, v])
    expect(checkEvolt(read.raw).ok).toBe(true)
  }, 30000)
})

const DIR = join(process.cwd(), 'test-fixtures', 'private')
const pdfs = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.pdf')) : []
const SKIP = 'skipped: no PDFs in test-fixtures/private/ (put the real Evolt and Withings reports there to run these)'

describe.skipIf(!pdfs.length)(pdfs.length ? `real reports in test-fixtures/private (${pdfs.length})` : SKIP, () => {
  const load = async (f) => rebuildLines(await itemsFromPdf(await pdfjs(), new Uint8Array(readFileSync(join(DIR, f)))))

  it('every Evolt report passes its checks', async (ctx) => {
    let n = 0
    for (const f of pdfs) {
      const lines = await load(f)
      if (!isEvoltText(lines.map((l) => l.text).join('\n'))) continue
      n++
      const read = parseEvoltLines(lines)
      expect([f, checkEvolt(read.raw).problems]).toEqual([f, []])
    }
    if (!n) ctx.skip()
  }, 120000)

  it('the 26 Oct 2026 Evolt report reads exactly (skipped when it is not among the files)', async (ctx) => {
    for (const f of pdfs) {
      const lines = await load(f)
      if (!isEvoltText(lines.map((l) => l.text).join('\n'))) continue
      const read = parseEvoltLines(lines)
      if (read.raw.date !== '2026-10-26') continue
      const { entry } = scanFromImport(read.raw)
      for (const [k, v] of Object.entries(EVOLT_26_OCT_EXPECTED)) expect([k, entry?.[k]]).toEqual([k, v])
      expect(entry?.recommendations?.caloriesKcal).toEqual([2206, 2306])
      expect(entry?.balance).toEqual({ upperLower: 'Balanced', leftRight: 'Balanced' })
      return
    }
    ctx.skip()
  }, 120000)

  it('the Withings Medical Report for 24 May to 24 Jun 2026 reads its summary (skipped when it is not among the files)', async (ctx) => {
    for (const f of pdfs) {
      const lines = await load(f)
      const text = lines.map((l) => l.text).join('\n')
      if (isEvoltText(text) || !isWithingsReportText(text)) continue
      const r = parseWithingsReport(lines)
      if (r?.from !== '2026-05-24') continue
      expect(r).toMatchObject({
        to: '2026-06-24', weight: 93.9, weightTrend: -1, weighIns: 36, bmi: 33, bmr: 1959, metabolicAge: 39, bodyFat: 30.4, boneMass: 3.3,
        muscleMass: 63, visceralFat: 4.8, leanMass: 66.3, waterMass: 45.9, hrAwake: 70, hrAsleep: 58, sleepWeekdayMin: 395, sleepWeekendMin: 389,
        sleepEfficiency: 91, snoringMin: 0, snoringNights: 14,
      })
      return
    }
    ctx.skip()
  }, 120000)
})
