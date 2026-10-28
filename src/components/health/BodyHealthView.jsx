import { useMemo, useState, Suspense, lazy } from 'react'
import { Info, HeartPulse, Flame } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { useHealth } from '../../health/state'
import Modal from '../ui/Modal'
import { addDays, dateRange } from '../../health/tz'
import { rowFor } from '../../health/engine/model'
import { glp1NoteDue, GLP1_RHR_NOTE } from '../../health/engine/protocol'
import { round } from '../../health/engine/stats'
import useHealthModel, { useCompounds } from './useHealthModel'
import useSaunaInput from './useSaunaInput'
import { recoveryStat } from '../../sauna/saunaEffects'
import TrendChart from '../charts/TrendChart'
import useChartEvents from '../charts/useChartEvents'
import { ReadinessRing, Sparkline } from './atoms'
import { AnswerLine, DeltaChip, SectionTitle, StatRow } from '../ui/Glance'
import { recoveryAnswer } from '../../lib/glance'
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

function RecoveryRow({ label, metric, unit, row, spark, dp = 0, testid }) {
  return (
    <div className="flex items-center gap-3 py-3" data-testid={testid}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium">{label}</p>
        <p className="text-[13px] font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
          {row.baseline != null ? `Usual ${row.baseline} ${unit}` : 'Building your usual'}
        </p>
      </div>
      <Sparkline values={spark} width={56} />
      <div className="flex w-[118px] shrink-0 flex-col items-end gap-1">
        <p className="text-[17px] font-semibold tabular-nums">{row.value != null ? round(row.value, dp) : '–'}<span className="ml-0.5 text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>{unit}</span></p>
        {row.delta != null && <DeltaChip metric={metric} delta={row.delta} unit={unit === '/min' ? '' : unit} dp={dp} />}
      </div>
    </div>
  )
}

/** Mornings after sauna against mornings without, once there are 7 of each. */
function SaunaRecoveryLine() {
  const hasSauna = useStore((s) => s.saunaSessions.length > 0)
  const { input } = useSaunaInput()
  const stat = useMemo(() => (hasSauna ? recoveryStat(input) : null), [hasSauna, input])
  if (!stat) return null
  return (
    <div className="card px-4 pt-3" data-testid="recovery-sauna-line">
      <SectionTitle icon={Flame} title="After sauna" />
      <StatRow label="HRV, morning after" metric="hrv" value={Math.round(stat.diff) === 0 ? 'Same' : null} delta={Math.round(stat.diff) === 0 ? null : stat.diff} deltaUnit="ms"
        sub={`${stat.withN} mornings after, ${stat.withoutN} without`} />
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
  const rows = { hrv: rowFor(model, 'hrv', t), rhr: rowFor(model, 'rhr', t), sleep: rowFor(model, 'sleep', t), resp: showResp ? rowFor(model, 'resp', t) : null }

  return (
    <div className="space-y-4" data-testid="recovery-view">
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
          </div>
        </div>
        <AnswerLine className="mt-3" testid="recovery-answer">{recoveryAnswer(rows)}</AnswerLine>
        {r.chip && <p className="mt-1 truncate text-sm font-medium" style={{ color: 'var(--text-2)' }} data-testid="baseline-chip">{r.chip}</p>}
      </div>

      <div className="card px-4 pt-3" data-testid="recovery-rows">
        <SectionTitle icon={HeartPulse} title="This morning" infoTitle="This morning"
          info={<>
            <p>Each value against your usual, built from the last 28 days. The chip is green when the move is the better way for that measure, amber when it is the other way.</p>
            {glp1 && <p data-testid="glp1-note">{GLP1_RHR_NOTE}</p>}
          </>} />
        <div className="rows">
          <RecoveryRow testid="row-hrv" label="HRV" metric="hrv" unit="ms" row={rows.hrv} spark={spark('hrv')} />
          <RecoveryRow testid="row-rhr" label="Resting heart rate" metric="rhr" unit="bpm" dp={1} row={rows.rhr} spark={spark('rhr')} />
          <RecoveryRow testid="row-sleep" label="Sleep" metric="sleep" unit="h" dp={1} row={rows.sleep} spark={spark('sleep')} />
          {showResp && <RecoveryRow testid="row-resp" label="Respiratory rate" metric="respiratory" unit="/min" dp={1} row={rows.resp} spark={spark('resp')} />}
        </div>
      </div>

      <SaunaRecoveryLine />

      <TrendChart metric="readiness" title="Readiness" series={clean(readinessSeries)} dp={0} events={events} />
      <TrendChart metric="hrv" title="Heart rate variability" unit="ms" series={clean(series('hrv'))} dp={0} events={events}
        note="Apple Watch measures HRV as SDNN." />
      <TrendChart metric="rhr" title="Resting heart rate" unit="bpm" series={clean(series('rhr'))} dp={0} events={events} />

      <button onClick={() => setCompare(true)} className="w-full rounded-full py-3 text-sm font-bold" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="open-compare">
        Compare
      </button>

      <HowCalculated open={info} onClose={() => setInfo(false)} />
      {compare && <Suspense fallback={null}><CompareSheet model={model} onClose={() => setCompare(false)} /></Suspense>}
    </div>
  )
}
