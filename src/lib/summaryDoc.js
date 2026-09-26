// Shareable summary: a clean, printable document of protocol + adherence +
// key trends. Deliberately plain — this is the one screen that is a document,
// not a game. Opens in a new tab; the user saves it as PDF via the print dialog.
import { format, parseISO } from 'date-fns'
import { currentRung } from './schedule'
import { slotOf, scheduledWeekdaySet, needsProtocolSetup, WEEKDAYS } from './daily'
import { formatDose } from './calc'
import { metricSeries, rollingAverage, METRIC_BY_KEY } from './metrics'
import { tenureFor, cumulativeExposure, cyclePosition } from './tenure'

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function weekdayLabel(peptide) {
  if (['daily', 'nightly'].includes(peptide.frequency)) return 'Every day'
  const days = [...scheduledWeekdaySet(peptide)].sort((a, b) => a - b)
  return days.map((d) => WEEKDAYS[d]).join(', ')
}

export function buildSummaryHtml({ peptides, titration, doseLogs, measurements, summary, from, to, runs = {} }) {
  const fmt = (d) => format(parseISO(d), 'd MMM yyyy')
  const active = peptides.filter((p) => !needsProtocolSetup(p))
  const today = format(new Date(), 'yyyy-MM-dd')

  const protocolRows = active.map((p) => {
    const { dose, level, maxLevel } = currentRung(p, titration[p.id])
    const ten = tenureFor(p, { runs, todayStr: today })
    return `<tr>
      <td><strong>${esc(p.name)}</strong>${p.reference?.tier ? `<span class="tier">${esc(p.reference.tier)}</span>` : ''}</td>
      <td>${esc(formatDose(dose, p.ladder.unit))}</td>
      <td>${esc(weekdayLabel(p))} · ${esc(slotOf(p))}</td>
      <td>${level + 1} of ${maxLevel + 1}</td>
      <td>${p.cycleOnDays && p.cycleOffDays ? `${p.cycleOnDays}d on / ${p.cycleOffDays}d off` : 'Ongoing'}</td>
      <td>${esc(ten ? (ten.running ? ten.currentWords : `stopped · ${ten.lifetimeWords} lifetime`) : '—')}</td>
    </tr>`
  }).join('')

  // How long each compound has been running, and everything taken of it. The
  // estimated column is typed-in history multiplied out, and is labelled so
  // nobody reads it back as a measurement.
  let anyEstimate = false
  const tenureRows = active.map((p) => {
    const ten = tenureFor(p, { runs, todayStr: today })
    if (!ten) return ''
    const exp = cumulativeExposure(p, { doseLogs, todayStr: today })
    const cyc = cyclePosition(p, today)
    if (exp?.hasEstimate) anyEstimate = true
    const unit = p.ladder?.unit === 'mcg' ? 'mcg' : 'mg'
    const show = (mg) => `${Math.round((unit === 'mcg' ? mg * 1000 : mg) * 100) / 100} ${unit}`
    return `<tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td>${esc(fmt(ten.startedOn))}</td>
      <td>${esc(ten.running ? ten.currentWords : 'not running')}${ten.runCount > 1 ? ` <span class="muted">(${ten.runCount} runs, ${esc(ten.lifetimeWords)} lifetime)</span>` : ''}</td>
      <td>${esc(cyc?.cycled ? cyc.words : 'ongoing')}</td>
      <td class="num">${exp ? exp.doses : 0}</td>
      <td class="num">${exp ? show(exp.loggedMg) : '—'}</td>
      <td class="num">${exp?.hasEstimate ? show(exp.estimatedMg) + ' *' : '—'}</td>
    </tr>`
  }).filter(Boolean).join('')

  const adherenceRows = summary.rows.map((r) => `<tr>
      <td>${esc(r.name)}</td>
      <td class="num">${r.taken} / ${r.scheduled}</td>
      <td class="num">${r.missed}</td>
      <td class="num"><strong>${r.pct}%</strong></td>
    </tr>`).join('')

  // key body-comp trends over the window
  const trendRows = ['weight', 'bodyFat', 'visceralFat', 'muscleMass'].map((key) => {
    const raw = metricSeries(measurements, key).filter((p) => p.date >= from && p.date <= to)
    if (raw.length < 1) return ''
    const series = key === 'weight' ? rollingAverage(raw, 7) : raw
    const first = series[0], last = series[series.length - 1]
    const delta = Math.round((last.value - first.value) * 100) / 100
    const m = METRIC_BY_KEY[key]
    return `<tr>
      <td>${esc(m.label)}${key === 'weight' ? ' <span class="muted">(7-day avg)</span>' : ''}</td>
      <td class="num">${first.value} ${esc(m.unit)}</td>
      <td class="num">${last.value} ${esc(m.unit)}</td>
      <td class="num">${delta > 0 ? '+' : ''}${delta} ${esc(m.unit)}</td>
    </tr>`
  }).filter(Boolean).join('')

  // the compound that has been running longest, for the header
  const longest = active
    .map((p) => tenureFor(p, { runs, todayStr: today }))
    .filter((x) => x && x.running)
    .sort((a, b) => b.currentDays - a.currentDays)[0]
  const longestWords = longest ? longest.currentWords : '—'

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Peptide protocol summary — ${esc(fmt(from))} to ${esc(fmt(to))}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #14161c; background: #fff; margin: 0; padding: 32px 28px 48px; max-width: 820px; }
  h1 { font-size: 21px; margin: 0 0 2px; letter-spacing: -0.01em; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.07em; color: #55596b;
       margin: 28px 0 8px; padding-bottom: 5px; border-bottom: 1px solid #e2e4ea; }
  .sub { color: #55596b; margin: 0 0 4px; }
  .kpis { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
  .kpi { border: 1px solid #e2e4ea; border-radius: 8px; padding: 9px 13px; min-width: 108px; }
  .kpi .v { font-size: 19px; font-weight: 700; letter-spacing: -0.02em; }
  .kpi .l { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #55596b; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eceef3; vertical-align: top; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #55596b; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .tier { font-size: 9px; font-weight: 700; color: #55596b; border: 1px solid #d7dae3;
          border-radius: 4px; padding: 1px 4px; margin-left: 6px; vertical-align: middle; }
  .muted { color: #7a7f90; font-weight: 400; }
  .note { margin-top: 30px; padding: 11px 13px; border: 1px solid #e2e4ea; border-radius: 8px;
          background: #fafbfc; color: #55596b; font-size: 11px; }
  .empty { color: #7a7f90; font-style: italic; padding: 6px 8px; }
  @media print { body { padding: 0; } .noprint { display: none; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
  button { font: inherit; padding: 7px 14px; border-radius: 7px; border: 1px solid #c9cdd8;
           background: #fff; cursor: pointer; }
</style></head>
<body>
  <div class="noprint" style="margin-bottom:18px"><button onclick="window.print()">Print / Save as PDF</button></div>

  <h1>Peptide protocol summary</h1>
  <p class="sub">${esc(fmt(from))} – ${esc(fmt(to))} · generated ${esc(format(new Date(), 'd MMM yyyy'))}</p>

  <div class="kpis">
    <div class="kpi"><div class="v">${summary.overall.pct == null ? '—' : summary.overall.pct + '%'}</div><div class="l">Adherence</div></div>
    <div class="kpi"><div class="v">${summary.overall.taken}/${summary.overall.scheduled}</div><div class="l">Doses taken</div></div>
    <div class="kpi"><div class="v">${active.length}</div><div class="l">Active peptides</div></div>
    <div class="kpi"><div class="v">${esc(longestWords)}</div><div class="l">Longest running</div></div>
  </div>

  <h2>Current protocol</h2>
  ${active.length ? `<table>
    <thead><tr><th>Peptide</th><th>Current dose</th><th>Schedule</th><th>Titration</th><th>Cycle</th><th>Time on</th></tr></thead>
    <tbody>${protocolRows}</tbody></table>` : '<p class="empty">No peptides configured.</p>'}

  <h2>Time on compound &amp; total exposure</h2>
  ${tenureRows ? `<table>
    <thead><tr><th>Peptide</th><th>Started</th><th>Time on</th><th>Cycle position</th>
      <th class="num">Doses logged</th><th class="num">Total logged</th><th class="num">Estimated</th></tr></thead>
    <tbody>${tenureRows}</tbody></table>
    ${anyEstimate ? '<p class="empty">* Estimated: entered by hand for a period before logging began, multiplied out from a stated dose and frequency. Not a record made at the time, and not counted in adherence.</p>' : ''}`
    : '<p class="empty">No peptides configured.</p>'}

  <h2>Adherence by peptide</h2>
  ${adherenceRows ? `<table>
    <thead><tr><th>Peptide</th><th class="num">Taken</th><th class="num">Missed</th><th class="num">Rate</th></tr></thead>
    <tbody>${adherenceRows}</tbody></table>` : '<p class="empty">Nothing scheduled in this window.</p>'}

  <h2>Body composition</h2>
  ${trendRows ? `<table>
    <thead><tr><th>Metric</th><th class="num">Start</th><th class="num">Latest</th><th class="num">Change</th></tr></thead>
    <tbody>${trendRows}</tbody></table>` : '<p class="empty">No measurements recorded in this window.</p>'}

  <div class="note">
    <strong>About this document.</strong> Self-reported data from a personal tracking app. It is a record of what was
    logged, not medical advice, and no dose, schedule or evidence tier here has been reviewed by a clinician.
    Adherence counts only doses that were recorded at the time; time-on-compound is the user's own stated start
    date and may reach back before any of this was being logged.
    Evidence-tier labels (T1–T5) reflect the strength of published data for a compound, not a recommendation.
  </div>
</body></html>`
}

export function openSummaryDocument(data) {
  const html = buildSummaryHtml(data)
  const win = window.open('', '_blank')
  if (!win) {
    // popup blocked — fall back to a download
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `peptide-summary-${format(new Date(), 'yyyy-MM-dd')}.html`
    a.click()
    URL.revokeObjectURL(url)
    return false
  }
  win.document.write(html)
  win.document.close()
  return true
}
