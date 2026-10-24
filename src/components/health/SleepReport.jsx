import { useState } from 'react'
import { FileText } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { addDays } from '../../health/tz'
import { signals, APNEA_LABEL, TESTOSTERONE_NOTE } from '../../sleep/apnea'
import { eveningLogs, latestBloods } from '../../lib/pdf/reportData'
import { dailySeries } from '../../body/bodySeries'
import { useBodyInput } from '../../lib/useBody'
import { useApnea } from './ApneaScreen'
import useSleepLab from './useSleepLab'

const mean = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const BAND = { low: 'low', intermediate: 'intermediate', high: 'high' }

/** Everything the sleep report needs for the last `days` days, as plain numbers. */
export function sleepReportData({ lab, apnea, state, days, today, weight }) {
  const from = addDays(today, -days + 1)
  const extras = [...lab.extras.values()].filter((e) => e.night.date >= from && e.night.date <= today).sort((a, b) => a.night.date.localeCompare(b.night.date))
  const inp = extras.map((e) => e.input)
  const sig = signals(extras.map((e) => ({
    date: e.night.date, breathing: e.overnight?.breathing ?? null, elevated: e.overnight?.breathingElevated ?? null,
    spo2: e.spo2?.readings ? e.spo2 : null, snoringMin: e.sounds?.snoringMin ?? null, lowConfidence: !!e.sounds?.lowConfidence,
    awakenings: e.overnight?.awakenings ?? null, morning: state.morningChecks?.[e.night.date] || null,
  })))
  const snore = extras.filter((e) => e.sounds && !e.sounds.lowConfidence)
  const bp = lab.model.daily.filter((r) => r.date >= from && r.date <= today && r.bpSys != null && r.bpDia != null).map((r) => ({ date: r.date, sys: r.bpSys, dia: r.bpDia }))
  const round = (v) => (v == null ? null : Math.round(v))
  return {
    days, from, to: today, generatedOn: today,
    averages: {
      nights: extras.length,
      asleepMin: mean(inp.map((i) => i.asleepMin)), score: round(mean(inp.map((i) => i.score))),
      deepMin: mean(inp.map((i) => i.deepMin)), remMin: mean(inp.map((i) => i.remMin)), awakeMin: mean(inp.map((i) => i.awakeMin)),
      sleepingHR: mean(inp.map((i) => i.hrAvg)), hrv: mean(inp.map((i) => i.hrv)),
    },
    trends: {
      asleep: inp.filter((i) => i.asleepMin != null).map((i) => ({ date: i.date, value: i.asleepMin / 60 })),
      score: inp.filter((i) => i.score != null).map((i) => ({ date: i.date, value: i.score })),
      breathing: inp.filter((i) => i.breathing != null).map((i) => ({ date: i.date, value: i.breathing })),
    },
    apnea: {
      label: APNEA_LABEL, score: apnea.sb.score, band: BAND[apnea.sb.band] || apnea.sb.band, known: apnea.sb.known,
      level: apnea.like.level, reasons: apnea.like.reasons, items: apnea.sb.items.map((i) => ({ label: i.label, answer: i.answer, source: i.source })),
    },
    signals: sig,
    snoring: {
      nights: snore.length,
      avgMin: mean(snore.map((e) => e.sounds.snoringMin)),
      over15: snore.filter((e) => e.sounds.snoringMin >= 15).length,
      lowConfidence: extras.filter((e) => e.sounds?.lowConfidence).length,
    },
    logs: eveningLogs(state, addDays(from, -1), addDays(today, -1)),
    weight: weight.filter((p) => p.date >= from && p.date <= today),
    bp,
    bloods: latestBloods(state, ['Haematocrit', 'Haemoglobin', 'Testosterone']),
    testosteroneNote: TESTOSTERONE_NOTE,
  }
}

/** "Sleep report 30 days" and "90 days": made on the phone, then the share sheet. */
export default function SleepReportButtons() {
  const lab = useSleepLab()
  const apnea = useApnea(lab)
  const input = useBodyInput()
  const [busy, setBusy] = useState(null)
  const showToast = useStore((s) => s.showToast)
  const make = async (days) => {
    setBusy(days)
    try {
      const [{ sleepReportPdf }, { deliverPdf, reportName }] = await Promise.all([import('../../lib/pdf/reports'), import('../../lib/pdf/deliver')])
      const today = todayStr()
      const weight = dailySeries('weight', input).map((p) => ({ date: p.date, value: p.value }))
      const bytes = sleepReportPdf(sleepReportData({ lab, apnea, state: useStore.getState(), days, today, weight }))
      await deliverPdf(reportName(`sleep-report-${days}-days`, today), bytes)
    } catch (err) {
      const { logError } = await import('../../lib/errorLog')
      logError(err, { kind: 'report', where: 'sleep report' })
      showToast('The report could not be made')
    }
    setBusy(null)
  }
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="sleep-report">
      {[30, 90].map((d) => (
        <button key={d} type="button" onClick={() => make(d)} disabled={!!busy} data-testid={`sleep-report-${d}`}
          className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-full text-sm font-black disabled:opacity-60" style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>
          <FileText size={15} /> {busy === d ? 'Making…' : `Sleep, ${d} days`}
        </button>
      ))}
    </div>
  )
}
