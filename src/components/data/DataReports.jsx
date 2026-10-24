import { Suspense, lazy, useState } from 'react'
import { FileText } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { HEALTH_BUILD, SleepReportButtons } from '../../health/ui'
import { dailySeries, seriesByFamily } from '../../body/bodySeries'
import { useBodyInput } from '../../lib/useBody'
import { protocolLines, asNeededCounts, flaggedBloods } from '../../lib/pdf/reportData'
import { addDaysStr } from '../../lib/schedule'
import { coldStartWords, readColdStarts } from '../../lib/coldStart'
import ErrorLogCard from './ErrorLogCard'

const BackupsCard = __NATIVE__ ? lazy(() => import('../native/BackupsCard')) : () => null
const muted = { color: 'var(--text-3)' }
const FAMILY = { evolt: 'Evolt', scale: 'scale', dexa: 'DEXA' }

/** The family with the most readings for a field, as dated values. */
function bestFamily(field, input) {
  const fams = Object.entries(seriesByFamily(field, input)).filter(([k]) => k !== 'dexa').sort((a, b) => b[1].length - a[1].length)
  const [name, pts] = fams[0] || [null, []]
  return { name, points: pts.map((p) => ({ date: p.date, value: p.value })) }
}

/** Health summary: the protocol, flagged bloods and body composition, as a PDF. */
function HealthSummaryButton() {
  const input = useBodyInput()
  const [busy, setBusy] = useState(false)
  const showToast = useStore((s) => s.showToast)
  const make = async () => {
    setBusy(true)
    try {
      const [{ healthSummaryPdf }, { deliverPdf, reportName }] = await Promise.all([import('../../lib/pdf/reports'), import('../../lib/pdf/deliver')])
      const state = useStore.getState()
      const today = todayStr()
      const fat = bestFamily('bodyFat', input)
      const lean = bestFamily('leanMass', input)
      const bytes = healthSummaryPdf({
        generatedOn: today,
        protocol: protocolLines(state, today),
        asNeeded: asNeededCounts(state, addDaysStr(today, -29), today),
        bloods: flaggedBloods(state),
        body: {
          weight: dailySeries('weight', input).map((p) => ({ date: p.date, value: p.value })),
          bodyFat: fat.points, leanMass: lean.points,
          source: `Weight is the newest reading each day from any scale. Body fat and lean mass are from ${FAMILY[fat.name] || 'one device'} only, never mixed with another device.`,
        },
      })
      await deliverPdf(reportName('health-summary', today), bytes)
    } catch (err) {
      const { logError } = await import('../../lib/errorLog')
      logError(err, { kind: 'report', where: 'health summary' })
      showToast('The report could not be made')
    }
    setBusy(false)
  }
  return (
    <button type="button" onClick={make} disabled={busy} data-testid="health-summary"
      className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full text-sm font-black disabled:opacity-60" style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>
      <FileText size={15} /> {busy ? 'Making…' : 'Health summary'}
    </button>
  )
}

/**
 * More › Data › Backups and reports: automatic backups (iPhone), the PDFs to
 * share with a doctor, the local error log, and how fast the app starts.
 */
export default function DataReports() {
  const cold = coldStartWords(readColdStarts())
  return (
    <div className="space-y-4" data-testid="data-reports">
      <h1 className="t-display">Backups and reports</h1>
      {__NATIVE__ && <Suspense fallback={null}><BackupsCard /></Suspense>}
      <section className="card space-y-2 p-4" data-testid="doctor-reports">
        <p className="t-label">Share with your doctor</p>
        <p className="text-xs font-medium" style={muted}>Plain PDFs made on this device. Nothing is uploaded; you choose where they go.</p>
        {HEALTH_BUILD && <Suspense fallback={null}><SleepReportButtons /></Suspense>}
        <HealthSummaryButton />
      </section>
      <ErrorLogCard />
      {cold && <p className="px-1 text-xs font-medium tabular-nums" style={muted} data-testid="cold-start">Start-up time on this device: {cold}.</p>}
    </div>
  )
}
