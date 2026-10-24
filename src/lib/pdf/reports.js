// The two reports to share with a doctor, plain and factual, made on the
// device: the Sleep report (30 or 90 days) and the Health summary. Each takes
// ready numbers (gathered by the screens) and lays them out; nothing here
// interprets them beyond what the app already shows.
import { format, parseISO } from 'date-fns'
import { PdfDoc, A4, wrap } from './pdfDoc'

const M = 48 // margin
const INK = '#111111'
const SOFT = '#555555'
const RULE = '#BBBBBB'
const SERIES = '#2F6FD6'
const day = (d) => format(parseISO(d), 'd MMM yyyy')
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10)
const hm = (min) => (min == null ? '-' : `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} min`)

/** A flowing page layout: headings, rows, notes and small charts, with page breaks. */
export class Report {
  constructor(title, subtitle) {
    this.doc = new PdfDoc({ title })
    this.title = title
    this.y = M
    this.doc.text(M, this.y + 14, title, { size: 18, bold: true, color: INK })
    this.y += 24
    if (subtitle) { this.doc.text(M, this.y + 10, subtitle, { size: 10, color: SOFT }); this.y += 16 }
    this.y += 8
  }

  ensure(h) {
    if (this.y + h <= A4.h - M) return
    this.doc.addPage()
    this.y = M
  }

  h2(text) {
    // a heading keeps room for a chart after it, so it is never left alone at the foot of a page
    this.ensure(140)
    this.y += 10
    this.doc.text(M, this.y + 12, text, { size: 13, bold: true, color: INK })
    this.y += 18
    this.doc.line(M, this.y, A4.w - M, this.y, { color: RULE })
    this.y += 8
  }

  para(text, { muted = false, size = 10 } = {}) {
    for (const line of wrap(text, A4.w - 2 * M, size)) {
      this.ensure(size + 4)
      this.doc.text(M, this.y + size, line, { size, color: muted ? SOFT : INK })
      this.y += size + 4
    }
    this.y += 2
  }

  row(label, value) {
    const left = (A4.w - 2 * M) * 0.45
    const lines = wrap(String(value ?? '-'), A4.w - 2 * M - left, 10)
    this.ensure(14 * lines.length)
    this.doc.text(M, this.y + 10, label, { size: 10, color: SOFT })
    lines.forEach((l, i) => this.doc.text(M + left, this.y + 10 + i * 13, l, { size: 10, color: INK }))
    this.y += 13 * lines.length + 2
  }

  /** A small line chart of dated values, with its range and first and last dates. */
  chart(points, { label, unit = '', dp = 0 } = {}) {
    const pts = (points || []).filter((p) => p.value != null)
    if (pts.length < 2) { if (label) this.row(label, pts.length ? `${r1(pts[0].value)} ${unit}` : 'No readings'); return }
    const h = 70
    this.ensure(h + 34)
    this.doc.text(M, this.y + 10, unit ? `${label} (${unit})` : label, { size: 10, bold: true, color: INK })
    this.y += 16
    const top = this.y
    const ys = pts.map((p) => p.value)
    const lo = Math.min(...ys)
    const hi = Math.max(...ys)
    const pad = (hi - lo) * 0.1 || 1
    const t0 = parseISO(pts[0].date).getTime()
    const t1 = parseISO(pts.at(-1).date).getTime() || t0 + 1
    const L = M + 36
    const R = A4.w - M
    const x = (d) => L + ((parseISO(d).getTime() - t0) / Math.max(1, t1 - t0)) * (R - L)
    const y = (v) => top + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * h
    const k = 10 ** dp
    const lab = (v) => `${Math.round(v * k) / k}`
    this.doc.text(M, y(hi) + 3, lab(hi), { size: 8, color: SOFT })
    this.doc.text(M, y(lo) + 3, lab(lo), { size: 8, color: SOFT })
    this.doc.line(L, top + h, R, top + h, { color: RULE })
    this.doc.polyline(pts.map((p) => [x(p.date), y(p.value)]), { width: 1.2, color: SERIES })
    if (pts.length <= 40) pts.forEach((p) => this.doc.dot(x(p.date), y(p.value), 1.4, { color: SERIES }))
    this.doc.text(L, top + h + 11, day(pts[0].date), { size: 8, color: SOFT })
    const last = day(pts.at(-1).date)
    this.doc.text(R - last.length * 4.2, top + h + 11, last, { size: 8, color: SOFT })
    this.y = top + h + 22
  }

  finish(footer) {
    const pages = this.doc.pages
    pages.forEach((ops, i) => {
      this.doc.ops = ops
      this.doc.text(M, A4.h - 24, `${footer} · page ${i + 1} of ${pages.length}`, { size: 8, color: SOFT })
    })
    return this.doc.output()
  }
}

const yesNo = (v) => (v == null ? 'Unknown' : v ? 'Yes' : 'No')

/**
 * Sleep report for the last 30 or 90 days: averages and trends, the apnea
 * screen with each STOP-BANG item and its source, breathing disturbances,
 * blood oxygen, snoring, how often sedatives and alcohol were logged, weight
 * and blood pressure, and related bloods.
 */
export function sleepReportPdf(d) {
  const rep = new Report(`Sleep report, last ${d.days} days`, `${day(d.from)} to ${day(d.to)} · made ${day(d.generatedOn)} with Pepito+ from Apple Health and the app's own logs`)
  rep.h2('Sleep averages')
  const a = d.averages || {}
  rep.row('Nights recorded', a.nights ?? 0)
  rep.row('Time asleep', hm(a.asleepMin))
  rep.row('Sleep score', a.score ?? '-')
  rep.row('Deep sleep', a.deepMin != null ? `${Math.round(a.deepMin)} min` : '-')
  rep.row('REM sleep', a.remMin != null ? `${Math.round(a.remMin)} min` : '-')
  rep.row('Time awake in the night', a.awakeMin != null ? `${Math.round(a.awakeMin)} min` : '-')
  rep.row('Average sleeping heart rate', a.sleepingHR != null ? `${r1(a.sleepingHR)} bpm` : '-')
  rep.row('Overnight HRV', a.hrv != null ? `${Math.round(a.hrv)} ms` : '-')
  rep.chart(d.trends?.asleep, { label: 'Time asleep', unit: 'h', dp: 1 })
  rep.chart(d.trends?.score, { label: 'Sleep score' })

  rep.h2('Apnea screen (STOP-BANG)')
  rep.para(d.apnea.label, { muted: true })
  rep.row('Score', `${d.apnea.score} of 8 (${d.apnea.band}), ${d.apnea.known} of 8 items known`)
  rep.row('Overall likelihood', d.apnea.level)
  for (const reason of d.apnea.reasons || []) rep.para(`${reason}.`, { muted: true })
  for (const i of d.apnea.items) rep.row(i.label, `${yesNo(i.answer)}. ${i.source}`)

  rep.h2('Breathing and blood oxygen')
  const s = d.signals || {}
  rep.row('Breathing disturbances elevated', s.breathingNights ? `${s.elevatedNights} of ${s.breathingNights} nights` : 'No data')
  rep.chart(d.trends?.breathing, { label: 'Breathing disturbances per hour', dp: 1 })
  rep.row('Lowest blood oxygen', s.spo2Lowest != null ? `${s.spo2Lowest}%` : 'No data')
  rep.row('Readings below 90%', s.spo2PctBelow90 != null ? `${s.spo2PctBelow90}%` : 'No data')
  rep.row('Nights with dips of 3 points or more', s.spo2Nights ? `${s.dipNights} of ${s.spo2Nights}` : 'No data')
  rep.para('Apple Watch samples blood oxygen every few minutes in sleep, so these are spot readings, not continuous oximetry.', { muted: true })

  rep.h2('Snoring')
  const sn = d.snoring || {}
  rep.row('Nights recorded by Sleep sounds', sn.nights ?? 0)
  rep.row('Average snoring', sn.avgMin != null ? `${Math.round(sn.avgMin)} min a night` : 'No data')
  rep.row('Nights with 15 min or more', sn.nights ? `${sn.over15} of ${sn.nights}` : 'No data')
  if (sn.lowConfidence) rep.para(`${sn.lowConfidence} nights with the phone in the bed are left out.`, { muted: true })

  rep.h2('Sedatives and alcohol logged')
  if (!(d.logs?.length)) rep.para('None logged.', { muted: true })
  for (const l of d.logs || []) rep.row(l.name, `${l.nights} of ${d.days} evenings${l.typical ? `, usually ${l.typical}` : ''}`)

  rep.h2('Weight and blood pressure')
  rep.chart(d.weight, { label: 'Weight', unit: 'kg', dp: 1 })
  rep.chart((d.bp || []).map((p) => ({ date: p.date, value: p.sys })), { label: 'Systolic blood pressure', unit: 'mmHg' })
  rep.chart((d.bp || []).map((p) => ({ date: p.date, value: p.dia })), { label: 'Diastolic blood pressure', unit: 'mmHg' })

  rep.h2('Related bloods')
  for (const b of d.bloods || []) rep.row(b.name, b.value != null ? `${b.value}${b.unit ? ` ${b.unit}` : ''} on ${day(b.date)}` : 'No result')
  if (d.testosteroneNote) rep.para(d.testosteroneNote, { muted: true })
  return rep.finish('Pepito+ sleep report')
}

/**
 * Health summary: the current protocol with doses and start dates, trends
 * for flagged blood markers, and the body composition trend.
 */
export function healthSummaryPdf(d) {
  const rep = new Report('Health summary', `Made ${day(d.generatedOn)} with Pepito+`)
  rep.h2('Current protocol')
  if (!d.protocol?.length) rep.para('Nothing on the protocol.', { muted: true })
  for (const p of d.protocol || []) rep.row(p.name, [p.dose, p.schedule, p.since ? `since ${day(p.since)}` : null].filter(Boolean).join(', '))
  if (d.asNeeded?.length) {
    rep.para('As needed, last 30 days:', { muted: true })
    for (const x of d.asNeeded) rep.row(x.name, `${x.count} times${x.typical ? `, usually ${x.typical}` : ''}`)
  }
  rep.h2('Blood markers outside their range')
  if (!d.bloods?.length) rep.para('No flagged markers in the results entered.', { muted: true })
  for (const b of d.bloods || []) {
    rep.row(b.name, `${b.latest}${b.unit ? ` ${b.unit}` : ''} on ${day(b.date)}${b.range ? ` (range ${b.range})` : ''}`)
    if (b.points?.length >= 2) rep.chart(b.points, { label: `${b.name} over time`, unit: b.unit, dp: 1 })
  }
  rep.h2('Body composition')
  rep.chart(d.body?.weight, { label: 'Weight', unit: 'kg', dp: 1 })
  rep.chart(d.body?.bodyFat, { label: 'Body fat', unit: '%', dp: 1 })
  rep.chart(d.body?.leanMass, { label: 'Lean mass', unit: 'kg', dp: 1 })
  if (d.body?.source) rep.para(d.body.source, { muted: true })
  return rep.finish('Pepito+ health summary')
}
