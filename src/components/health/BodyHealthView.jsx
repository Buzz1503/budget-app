import { useMemo, useState, Suspense, lazy } from 'react'
import { Info } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { useHealth } from '../../health/state'
import Modal from '../ui/Modal'
import { addDays, dateRange } from '../../health/tz'
import { rowFor } from '../../health/engine/model'
import { glp1NoteDue, GLP1_RHR_NOTE } from '../../health/engine/protocol'
import { round } from '../../health/engine/stats'
import useHealthModel, { useCompounds } from './useHealthModel'
import TrendChart from '../charts/TrendChart'
import useChartEvents from '../charts/useChartEvents'
import { ReadinessRing, Sparkline, Delta, Stat } from './atoms'
import { HEALTH_BANDS } from './bands'
import { SyncLine } from './HealthSettings'

const CompareSheet = lazy(() => import('./CompareSheet'))

const lastDays = (t, n) => dateRange(addDays(t, -(n - 1)), t)
const clean = (rows) => rows.filter((r) => r.value != null)

/** Shown instead of a screen when nothing has been read yet. */
export function EmptyState() {
  const syncing = useHealth((s) => s.syncing)
  return (
    <div className="card p-4" data-testid="health-empty-state">
      {syncing ? <SyncLine /> : (
        <p className="text-sm font-medium leading-snug" style={{ color: 'var(--text-2)' }}>
          No data yet. Check Settings › Health › Data Access &amp; Devices › Pepito+.
        </p>
      )}
    </div>
  )
}

export function NotConnected({ goTo }) {
  return (
    <button onClick={() => goTo?.('health')} className="card w-full p-4 text-left" data-testid="health-not-connected">
      <p className="t-label">Connect Apple Health</p>
      <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-2)' }}>More › Health explains what is read, then asks iOS for access.</p>
    </button>
  )
}

export default function BodyHealthView({ goTo }) {
  const connected = useStore((s) => s.healthSettings.connected)
  const model = useHealthModel()
  if (!connected) return <NotConnected goTo={goTo} />
  if (!model.hasData) return <EmptyState />
  // Training left Body in stage 2D; its data and engines stay (sleep factors,
  // the planner and sauna detection read them), so any old link lands here
  return <RecoveryView model={model} />
}

// ---------------------------------------------------------------- Recovery

function HowCalculated({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="How this is calculated">
      <div className="space-y-3 text-sm font-medium leading-relaxed" style={{ color: 'var(--text-2)' }} data-testid="readiness-info">
        <p>Readiness compares this morning with your own usual, built from the last 28 days (today left out). It needs 14 days of data before it shows a score.</p>
        <p>It weighs heart rate variability (40 %), resting heart rate (25 %), last night’s sleep (25 %), and respiratory rate and wrist temperature (5 % each, and only when they are higher than usual). Anything missing is left out and the rest re-weighted. Your usual sits at 60.</p>
        <p>When a compound marked as affecting your baseline starts, stops or changes dose, the score keeps using the baseline from before until 10 days of new data exist, then uses only the new data.</p>
        <p>Apple Watch reports HRV as SDNN, which is a different measure to the one Whoop and Bevel use. Scores here are built on your own baseline and will not match those apps.</p>
        <p style={{ color: 'var(--text-3)' }}>A personal record, not medical advice.</p>
      </div>
    </Modal>
  )
}

function RecoveryRow({ label, unit, row, spark, dp = 0, note = null, testid }) {
  return (
    <div className="py-2.5" data-testid={testid}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{label}</p>
          <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
            {row.baseline != null ? `Usual ${row.baseline} ${unit}` : 'Building baseline'}
          </p>
        </div>
        <Sparkline values={spark} />
        <div className="w-[96px] shrink-0 text-right">
          <p className="text-base font-black tabular-nums">{row.value != null ? round(row.value, dp) : '–'}<span className="ml-1 text-xs font-bold" style={{ color: 'var(--text-3)' }}>{unit}</span></p>
          <p className="text-xs font-medium"><Delta value={row.delta} dp={dp} /></p>
        </div>
      </div>
      {note && <p className="mt-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }} data-testid="glp1-note">{note}</p>}
    </div>
  )
}

function RecoveryView({ model }) {
  const t = todayStr()
  const compounds = useCompounds()
  const [info, setInfo] = useState(false)
  const [compare, setCompare] = useState(false)
  const r = model.readiness(t)
  const days28 = lastDays(t, 28)
  const spark = (key) => days28.map((d) => model.series[key].get(d) ?? null)
  const year = useMemo(() => lastDays(t, 365), [t])
  const readinessSeries = useMemo(() => year.map((d) => ({ date: d, value: model.readiness(d).score })), [year, model])
  const series = (key) => year.map((d) => ({ date: d, value: model.series[key].get(d) ?? null }))
  const showResp = model.series.resp.size > 0
  const glp1 = glp1NoteDue(t, model.events, compounds)
  const events = useChartEvents()

  return (
    <div className="space-y-3" data-testid="recovery-view">
      <div className="card p-4">
        <div className="flex items-center gap-4">
          <ReadinessRing score={r.score} band={r.band} size={104} stroke={9} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="t-caption min-w-0 flex-1" style={{ color: 'var(--text-3)' }}>Readiness today</p>
              <button onClick={() => setInfo(true)} aria-label="How this is calculated" data-testid="readiness-info-button" className="rounded-full p-1" style={{ color: 'var(--text-3)' }}>
                <Info size={16} />
              </button>
            </div>
            {r.status === 'ok' && <p className="text-2xl font-black" style={{ color: HEALTH_BANDS[r.band].tone }} data-testid="recovery-band">{r.bandLabel}</p>}
            {r.status === 'building' && <p className="text-sm font-bold" data-testid="recovery-building">Building baseline: day {r.buildingDay} of 14</p>}
            {r.status === 'insufficient' && <p className="text-sm font-bold" data-testid="recovery-insufficient">Not enough data from last night</p>}
            {r.chip && (
              <span className="mt-1 inline-block rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="baseline-chip">
                {r.chip}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="card rows px-4" data-testid="recovery-rows">
        <RecoveryRow testid="row-hrv" label="Heart rate variability" unit="ms" row={rowFor(model, 'hrv', t)} spark={spark('hrv')} />
        <RecoveryRow testid="row-rhr" label="Resting heart rate" unit="bpm" dp={1} row={rowFor(model, 'rhr', t)} spark={spark('rhr')} note={glp1 ? GLP1_RHR_NOTE : null} />
        <RecoveryRow testid="row-sleep" label="Sleep" unit="h" dp={1} row={rowFor(model, 'sleep', t)} spark={spark('sleep')} />
        {showResp && <RecoveryRow testid="row-resp" label="Respiratory rate" unit="/min" dp={1} row={rowFor(model, 'resp', t)} spark={spark('resp')} />}
      </div>

      <TrendChart metric="readiness" title="Readiness" series={clean(readinessSeries)} dp={0} events={events} />
      <TrendChart metric="hrv" title="Heart rate variability" unit="ms" series={clean(series('hrv'))} dp={0} events={events}
        note="Apple Watch measures HRV as SDNN." />
      <TrendChart metric="rhr" title="Resting heart rate" unit="bpm" series={clean(series('rhr'))} dp={0} events={events} />

      <button onClick={() => setCompare(true)} className="w-full rounded-full py-3 text-sm font-bold" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="open-compare">
        Compare
      </button>
      <p className="px-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>A personal record, not medical advice.</p>

      <HowCalculated open={info} onClose={() => setInfo(false)} />
      {compare && <Suspense fallback={null}><CompareSheet model={model} onClose={() => setCompare(false)} /></Suspense>}
    </div>
  )
}
