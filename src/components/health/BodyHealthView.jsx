import { useMemo, useState, Suspense, lazy } from 'react'
import { format } from 'date-fns'
import { Info } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { useHealth } from '../../health/state'
import Modal from '../ui/Modal'
import { addDays, dateRange } from '../../health/tz'
import { rowFor } from '../../health/engine/model'
import { glp1NoteDue, GLP1_RHR_NOTE } from '../../health/engine/protocol'
import { planBedtime, hhmm } from '../../health/engine/planner'
import { nightsEnding } from '../../health/engine/sleep'
import { weeklyMeans } from '../../health/engine/training'
import { vo2Percentile, fitnessAge, smoothVo2 } from '../../health/engine/fitness'
import { mean, round } from '../../health/engine/stats'
import useHealthModel, { tz, useCompounds } from './useHealthModel'
import TrendChart from '../charts/TrendChart'
import useChartEvents from '../charts/useChartEvents'
import { ReadinessRing, Sparkline, Delta, minutesWords, Stat } from './atoms'
import { HEALTH_BANDS } from './bands'
import { SyncLine } from './HealthSettings'

const CompareSheet = lazy(() => import('./CompareSheet'))

const lastDays = (t, n) => dateRange(addDays(t, -(n - 1)), t)
const clean = (rows) => rows.filter((r) => r.value != null)

/** Shown instead of a screen when nothing has been read yet. */
function EmptyState() {
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

function NotConnected({ goTo }) {
  return (
    <button onClick={() => goTo?.('health')} className="card w-full p-4 text-left" data-testid="health-not-connected">
      <p className="t-label">Connect Apple Health</p>
      <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-2)' }}>More › Health explains what is read, then asks iOS for access.</p>
    </button>
  )
}

export default function BodyHealthView({ segment, goTo }) {
  const connected = useStore((s) => s.healthSettings.connected)
  const model = useHealthModel()
  if (!connected) return <NotConnected goTo={goTo} />
  if (!model.hasData) return <EmptyState />
  if (segment === 'recovery') return <RecoveryView model={model} />
  if (segment === 'sleep') return <SleepView model={model} />
  return <TrainingView model={model} />
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
          <p className="text-base font-black tabular-nums">{row.value != null ? round(row.value, dp) : '—'}<span className="ml-1 text-xs font-bold" style={{ color: 'var(--text-3)' }}>{unit}</span></p>
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

// ------------------------------------------------------------------- Sleep

const STAGE_SHADE = { deep: 'var(--text)', core: 'var(--text-2)', rem: 'var(--text-3)', awake: 'var(--surface2)' }

function StageBar({ night }) {
  const parts = night.hasStages
    ? [['Deep', 'deep', night.deepMin], ['Core', 'core', night.coreMin], ['REM', 'rem', night.remMin], ['Awake', 'awake', night.awakeMin]]
    : [['Asleep', 'core', night.asleepMin], ['Awake', 'awake', night.awakeMin]]
  const total = parts.reduce((s, p) => s + p[2], 0) || 1
  return (
    <div data-testid="stage-bar">
      <div className="flex h-3 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface-sunk)' }}>
        {parts.map(([label, key, min]) => (
          <span key={label} style={{ width: `${(min / total) * 100}%`, background: STAGE_SHADE[key] }} />
        ))}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1">
        {parts.map(([label, key, min]) => (
          <div key={label} data-testid={`stage-${key}`}>
            <p className="flex items-center gap-1 text-[11px] font-bold" style={{ color: 'var(--text-3)' }}>
              <span className="h-2 w-2 rounded-full" style={{ background: STAGE_SHADE[key] }} />{label}
            </p>
            <p className="text-xs font-black tabular-nums">{Math.round(min)} min</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function DurationBars({ model }) {
  const t = todayStr()
  const days = lastDays(t, 14)
  const need = model.needH
  const vals = days.map((d) => (model.nightBy.get(d)?.asleepMin ?? null))
  const maxH = Math.max(need, ...vals.filter((v) => v != null).map((v) => v / 60)) + 0.5
  const W = 320
  const H = 110
  const bw = (W - 30) / days.length
  const y = (h) => H - 16 - (h / maxH) * (H - 26)
  return (
    <div className="card p-3" data-testid="sleep-duration-chart">
      <p className="t-caption" style={{ color: 'var(--text-2)' }}>Last 14 nights</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label="Hours asleep over the last 14 nights">
        {vals.map((v, i) => v != null && (
          <rect key={days[i]} x={24 + i * bw + 2} y={y(v / 60)} width={bw - 4} height={H - 16 - y(v / 60)} rx="3" fill="var(--text-2)" data-testid="sleep-bar" />
        ))}
        <line x1="24" x2={W} y1={y(need)} y2={y(need)} stroke="var(--text)" strokeDasharray="3 3" />
        <text x="20" y={y(need) + 3} fontSize="9" fontWeight="700" textAnchor="end" fill="var(--text-2)">{need} h</text>
        <text x="24" y={H - 3} fontSize="9" fontWeight="700" fill="var(--text-3)">{format(new Date(`${days[0]}T00:00:00`), 'd MMM')}</text>
        <text x={W} y={H - 3} fontSize="9" fontWeight="700" textAnchor="end" fill="var(--text-3)">Last night</text>
      </svg>
      <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Dashed line: your sleep need ({need} h).</p>
    </div>
  )
}

function SleepView({ model }) {
  const t = todayStr()
  const settings = useStore((s) => s.healthSettings)
  const [showInputs, setShowInputs] = useState(false)
  const night = model.nightBy.get(t)
  const latestDate = night ? t : [...model.nightBy.keys()].sort().at(-1)
  const shown = model.nightBy.get(latestDate)
  const perf = shown ? model.sleepScore(latestDate) : null
  const recent7 = nightsEnding(model.nightBy, t, 7)
  const recent14 = nightsEnding(model.nightBy, t, 14)
  const debt = model.debtH(t)
  const plan = planBedtime({
    recent: recent14, debtH: debt, needH: model.needH,
    yesterdayLoad: model.loadVsUsual(addDays(t, -1)).label, wakeTarget: settings.wakeTarget, tz,
  })
  const naps = lastDays(t, 7).flatMap((d) => (model.nightBy.get(d)?.naps || []).map((n) => ({ ...n, date: d })))
  const sdMin = perf?.consistencySdMin
  const clock = (ms) => hhmm(tz.hourOf(ms) * 60)
  const events = useChartEvents()
  const sleepSeries = useMemo(() => [...model.nightBy.values()].map((n) => ({ date: n.date, value: n.asleepMin / 60 })).sort((a, b) => a.date.localeCompare(b.date)), [model])

  return (
    <div className="space-y-3" data-testid="sleep-view">
      {shown ? (
        <div className="card p-4" data-testid="last-night">
          <div className="flex items-baseline gap-2">
            <p className="t-caption min-w-0 flex-1" style={{ color: 'var(--text-3)' }}>{latestDate === t ? 'Last night' : `Night ending ${format(new Date(`${latestDate}T00:00:00`), 'd MMM')}`}</p>
            <p className="text-xs font-bold tabular-nums" style={{ color: 'var(--text-3)' }}>{shown.sourceName}</p>
          </div>
          <div className="mt-1 flex items-end gap-3">
            <p className="text-3xl font-black tabular-nums" data-testid="asleep-duration">{minutesWords(shown.asleepMin)}</p>
            <p className="pb-1 text-sm font-bold tabular-nums" style={{ color: 'var(--text-2)' }} data-testid="sleep-score">Score {perf?.score ?? '—'}</p>
          </div>
          <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
            In bed {minutesWords(shown.inBedMin)} · {clock(shown.start)} to {clock(shown.end)}
          </p>
          <div className="mt-3"><StageBar night={shown} /></div>
          {!shown.hasStages && <p className="mt-2 text-xs font-medium" style={{ color: 'var(--text-3)' }}>No sleep stages from this source; the score leaves that part out.</p>}
        </div>
      ) : (
        <div className="card p-4"><p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>No main sleep recorded yet.</p></div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Stat testid="sleep-consistency" label="Consistency" value={sdMin != null ? `±${Math.round(sdMin)} min` : '—'} sub={recent7.length >= 3 ? 'Bed and wake time, last 7 nights' : 'Needs 3 nights'} />
        <Stat testid="sleep-debt" label="7-night debt" value={`${round(debt, 1)} h`} sub={`Against ${model.needH} h a night`} />
      </div>

      <button onClick={() => setShowInputs((v) => !v)} className="card w-full p-4 text-left" data-testid="sleep-planner" aria-expanded={showInputs}>
        <p className="text-base font-black">Aim to be in bed by {plan.bedtime}</p>
        <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>To wake at {plan.wake}. Tap to see how.</p>
        {showInputs && (
          <div className="mt-2 space-y-0.5 text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }} data-testid="planner-inputs">
            <p>Sleep need {minutesWords(plan.inputs.needMin)}{plan.inputs.debtAddMin ? ` + ${plan.inputs.debtAddMin} min for this week’s debt` : ''}{plan.inputs.loadBumpMin ? ` + ${plan.inputs.loadBumpMin} min after a higher-load day` : ''}</p>
            <p>Typical efficiency {Math.round(plan.inputs.efficiency * 100)} % → {minutesWords(plan.inputs.inBedMin)} in bed</p>
            <p>Wake time {plan.wake} ({plan.inputs.wakeFrom === 'setting' ? 'your setting' : plan.inputs.wakeFrom === 'history' ? 'your usual, last 14 nights' : 'default'})</p>
          </div>
        )}
      </button>

      <DurationBars model={model} />
      <TrendChart metric="sleep" title="Time asleep" unit="h" dp={1} series={sleepSeries} events={events} />

      {naps.length > 0 && (
        <div className="card p-4" data-testid="naps">
          <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Naps, last 7 days (not scored)</p>
          {naps.map((n) => (
            <p key={`${n.date}-${n.start}`} className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
              {format(new Date(`${n.date}T00:00:00`), 'EEE d MMM')} · {clock(n.start)} · {minutesWords(n.asleepMin)}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Training

const ZONE_SHADE = ['var(--surface2)', 'var(--text-3)', 'var(--text-2)', 'var(--muted)', 'var(--text)']

function ZoneBar({ zones }) {
  const total = zones.reduce((s, z) => s + z, 0)
  if (!total) return null
  return (
    <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface-sunk)' }} data-testid="zone-bar" title="Minutes in zones 1 to 5">
      {zones.map((z, i) => <span key={i} style={{ width: `${(z / total) * 100}%`, background: ZONE_SHADE[i] }} />)}
    </div>
  )
}

function TrainingView({ model }) {
  const t = todayStr()
  const dow = (new Date(`${t}T00:00:00Z`).getUTCDay() + 6) % 7
  const monday = addDays(t, -dow)
  const week = model.sessions.filter((s) => s.date >= monday && s.date <= t).sort((a, b) => b.start - a.start)
  const lvu = model.loadVsUsual(t)
  const hrr = weeklyMeans(model.sessions, t, (s) => ({ date: s.date, value: s.hrRecovery }))
  const last7 = lastDays(t, 7).map((d) => model.dailyBy.get(d))
  const avg = (k) => round(mean(last7.map((r) => r?.[k]).filter((v) => v != null)), 0)
  const vo2Readings = model.daily.filter((r) => r.vo2max != null).map((r) => ({ date: r.date, value: r.vo2max }))
  const vo2Smooth = smoothVo2(vo2Readings)
  const latestVo2 = vo2Smooth.at(-1)
  const sex = model.characteristics.biologicalSex === 'male' || model.characteristics.biologicalSex === 'female' ? model.characteristics.biologicalSex : null
  const pct = latestVo2 && model.age != null ? vo2Percentile(latestVo2.value, model.age, sex) : null
  const fitAge = latestVo2 ? fitnessAge(latestVo2.value, sex) : null
  const today = model.dailyBy.get(t)
  const proteinAvg = avg('dietProtein')
  const daylightAvg = avg('daylightMin')
  const hrrMax = Math.max(...hrr.map((w) => w.mean || 0), 1)

  return (
    <div className="space-y-3" data-testid="training-view">
      <div className="card p-4">
        <div className="flex items-baseline gap-2">
          <p className="t-caption min-w-0 flex-1" style={{ color: 'var(--text-3)' }}>This week</p>
          <p className="text-sm font-black" data-testid="load-vs-usual">{lvu.label ? `${lvu.label} load than usual` : 'Load vs usual needs 4 weeks'}</p>
        </div>
        {lvu.label && <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>Last 7 days average {round(lvu.acute, 0)} TRIMP a day, against {round(lvu.chronic, 0)} over 28 days.</p>}
        <div className="mt-2 rows">
          {week.length === 0 && <p className="py-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>No sessions yet this week.</p>}
          {week.map((s) => (
            <div key={s.id} className="py-2.5" data-testid="session-row">
              <div className="flex items-baseline gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-bold">{s.title}</p>
                <p className="text-xs font-bold tabular-nums" style={{ color: 'var(--text-3)' }}>{format(new Date(s.start), 'EEE HH:mm')}</p>
              </div>
              <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
                {Math.round(s.durationMin)} min · {s.avgHR != null ? `avg ${s.avgHR} bpm` : 'no heart rate'} · TRIMP {s.trimp}
                {s.hrRecovery != null ? ` · recovery ${s.hrRecovery} bpm` : ''}
              </p>
              <ZoneBar zones={s.zones} />
            </div>
          ))}
        </div>
        <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>Max heart rate {model.maxHR} bpm {model.maxHRFromSetting ? '(your setting)' : '(estimated from age)'}. Zones 1–5 run lightest to darkest.</p>
      </div>

      <div className="card p-4" data-testid="hrr-trend">
        <p className="t-caption" style={{ color: 'var(--text-3)' }}>Heart rate recovery, weekly average</p>
        <div className="mt-2 flex h-16 items-end gap-1">
          {hrr.map((w) => (
            <div key={w.weekStart} className="flex-1 rounded-t-[4px]" title={w.mean != null ? `${w.mean} bpm` : 'none'}
              style={{ height: `${w.mean ? (w.mean / hrrMax) * 100 : 2}%`, background: w.mean ? 'var(--text-2)' : 'var(--surface-sunk)' }} />
          ))}
        </div>
        <p className="mt-1 text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
          The one-minute drop Apple Watch records after a workout. Last 12 weeks{hrr.at(-1)?.mean != null ? `; this week ${hrr.at(-1).mean} bpm` : ''}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat testid="steps-avg" label="Steps, 7-day average" value={avg('steps') != null ? Number(avg('steps')).toLocaleString() : '—'} />
        <Stat testid="energy-avg" label="Active energy, 7-day avg" value={avg('activeEnergy') != null ? `${avg('activeEnergy')} kcal` : '—'} />
        {daylightAvg != null && <Stat testid="daylight-avg" label="Daylight, 7-day avg" value={`${daylightAvg} min`} />}
        {latestVo2 && (
          <Stat testid="vo2-now" label="VO2 max (estimate)" value={`${latestVo2.value}`}
            sub={[pct ? `${pct.bound === 'below' ? 'Below the 10th' : pct.bound === 'above' ? 'Above the 90th' : `${pct.value}th`} percentile for age` : null, fitAge ? `fitness age about ${fitAge}` : null].filter(Boolean).join(' · ') || 'Add date of birth and sex in Apple Health for age norms'} />
        )}
      </div>

      {vo2Smooth.length >= 2 && (
        <TrendChart metric="vo2max" title="VO2 max, smoothed" unit="mL/kg/min" series={vo2Smooth} dp={1} defaultRange="1Y"
          note="Apple estimates VO2 max from outdoor walks and runs; percentile and fitness age use FRIEND registry norms and are estimates" />
      )}

      {(today?.dietProtein != null || proteinAvg != null) && (
        <p className="px-1 text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="protein-line">
          Protein today {today?.dietProtein != null ? `${today.dietProtein} g` : '—'} · 7-day average {proteinAvg != null ? `${proteinAvg} g` : '—'}
        </p>
      )}
    </div>
  )
}
