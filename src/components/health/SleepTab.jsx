import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, Info, ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import { CountIn, FillRing, Stagger, StaggerItem } from '../ui/Motion'
import TrendChart from '../charts/TrendChart'
import useChartEvents from '../charts/useChartEvents'
import { addDays, dateRange } from '../../health/tz'
import { planBedtime } from '../../health/engine/planner'
import { nightsEnding, consistencySd, clockFromNoon } from '../../health/engine/sleep'
import { wobble as wobbleOf } from '../../health/engine/phases'
import { COMPARE, SLEEP_VIEW } from '../../health/engine/config'
import { mean, round } from '../../health/engine/stats'
import {
  scoreBand, scoreBreakdown, stageStats, vitalVsUsual, weekdayWeekend, midpointFromNoon, chronogram, clockOf,
  windDownAt, debtNights, durationWords, sleepFactors, lateWorkoutDay, higherLoadDay,
} from '../../health/engine/sleepView'
import useHealthModel, { tz, useCompounds } from './useHealthModel'
import { dayFlags } from '../../sauna/saunaEffects'
import { minutesOf } from '../../sauna/sauna'
import { NotConnected, EmptyState } from './BodyHealthView'
import { HEALTH_BANDS } from './bands'
import { Hypnogram, Chronogram, DebtBars, NightCalendar } from './SleepCharts'
import { HabitChips } from './Journal'

const clock = (ms) => clockOf(clockFromNoon(ms, tz))
const dayWords = (d, t) => (d === t ? 'Last night' : d === addDays(t, -1) ? 'The night before' : `Night to ${format(parseISO(d), 'EEE d MMM')}`)

function SectionTitle({ children, sub, action }) {
  return (
    <div className="flex items-end gap-2 px-1">
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-black">{children}</h2>
        {sub && <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>{sub}</p>}
      </div>
      {action}
    </div>
  )
}

/** The Sleep tab: one night at a time, then how sleep is trending and what goes with it. */
export default function SleepTab({ goTo }) {
  const connected = useStore((s) => s.healthSettings.connected)
  const model = useHealthModel()
  return (
    <div className="space-y-3" data-testid="sleep-tab">
      <h1 className="text-2xl font-black tracking-tight">Sleep</h1>
      {!connected ? <NotConnected goTo={goTo} /> : !model.hasData ? <EmptyState /> : <SleepScreen model={model} />}
    </div>
  )
}

function SleepScreen({ model }) {
  const t = todayStr()
  const dates = useMemo(() => [...model.nightBy.keys()].sort(), [model])
  const [date, setDate] = useState(() => (model.nightBy.has(t) ? t : dates.at(-1)))
  const [calendar, setCalendar] = useState(false)
  if (!dates.length || !date) {
    return <div className="card p-4"><p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>No main sleep recorded yet.</p></div>
  }
  const night = model.nightBy.get(date)
  const i = dates.indexOf(date)
  const prev = i > 0 ? dates[i - 1] : null
  const next = i < dates.length - 1 ? dates[i + 1] : null

  return (
    <Stagger className="space-y-6" data-testid="sleep-view">
      <StaggerItem>
        <Hero model={model} night={night} date={date} t={t} prev={prev} next={next} setDate={setDate} openCalendar={() => setCalendar(true)} />
      </StaggerItem>
      <StaggerItem className="space-y-2">
        <SectionTitle sub="Awake at the top, deep sleep at the bottom">Through the night</SectionTitle>
        <section className="card p-4"><Hypnogram night={night} tz={tz} /></section>
      </StaggerItem>
      <StaggerItem className="space-y-2">
        <SectionTitle sub="Each part out of 100">Score breakdown</SectionTitle>
        <Breakdown model={model} night={night} date={date} />
      </StaggerItem>
      <StaggerItem className="space-y-2"><Stages model={model} night={night} date={date} /></StaggerItem>
      <StaggerItem className="space-y-2">
        <SectionTitle sub="This night against your usual, the 28 nights before">Overnight vitals</SectionTitle>
        <Vitals model={model} night={night} date={date} />
      </StaggerItem>
      <StaggerItem className="space-y-2"><Timing model={model} t={t} /></StaggerItem>
      <StaggerItem className="space-y-2"><DebtAndPlan model={model} t={t} /></StaggerItem>
      <StaggerItem className="space-y-2"><Factors model={model} t={t} /></StaggerItem>
      <StaggerItem className="space-y-2">
        <SectionTitle sub="Tap Overlay to add compound lanes">Trends</SectionTitle>
        <Trends model={model} />
      </StaggerItem>
      <StaggerItem><Naps model={model} t={t} /></StaggerItem>
      <Modal open={calendar} onClose={() => setCalendar(false)} title="Nights">
        <NightCalendar selected={date} today={t} hasNight={(d) => model.nightBy.has(d)} scoreOf={(d) => model.sleepScore(d)?.score}
          onPick={(d) => { setDate(d); setCalendar(false) }} />
      </Modal>
    </Stagger>
  )
}

// -------------------------------------------------------------------- hero

function Hero({ model, night, date, t, prev, next, setDate, openCalendar }) {
  const perf = model.sleepScore(date)
  const band = scoreBand(perf?.score)
  return (
    <section className="card p-5" data-testid="last-night">
      <div className="flex items-center gap-2">
        <button onClick={() => prev && setDate(prev)} disabled={!prev} aria-label="Previous night" data-testid="sleep-prev"
          className="rounded-full p-2 disabled:opacity-30" style={{ background: 'var(--surface-sunk)' }}><ChevronLeft size={16} /></button>
        <button onClick={openCalendar} className="flex-1 text-center text-sm font-black" data-testid="sleep-date">{dayWords(date, t)}</button>
        <button onClick={() => next && setDate(next)} disabled={!next} aria-label="Next night" data-testid="sleep-next"
          className="rounded-full p-2 disabled:opacity-30" style={{ background: 'var(--surface-sunk)' }}><ChevronRight size={16} /></button>
      </div>
      <div className="mt-5 flex items-center gap-5">
        <div className="relative shrink-0" data-testid="sleep-score-ring" data-band={band || ''}>
          <FillRing value={perf?.score ?? 0} size={112} stroke={9} color={band ? HEALTH_BANDS[band].tone : 'var(--text-3)'} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-3xl font-black tabular-nums leading-none" data-testid="sleep-score">{perf ? <CountIn value={perf.score} /> : '–'}</p>
            <p className="mt-1 text-[11px] font-bold" style={{ color: 'var(--text-3)' }}>{band ? HEALTH_BANDS[band].label : 'Score'}</p>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-3xl font-black tabular-nums leading-tight" data-testid="asleep-duration">{durationWords(night.asleepMin)}</p>
          <p className="text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>of your {model.needH} h</p>
          <p className="mt-3 text-sm font-bold tabular-nums" data-testid="sleep-times">{clock(night.start)} to {clock(night.end)}</p>
          <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>{night.sourceName || 'Apple Health'}</p>
        </div>
      </div>
      {!night.hasStages && <p className="mt-4 text-xs font-medium" style={{ color: 'var(--text-3)' }}>No sleep stages from this source; the score leaves that part out.</p>}
    </section>
  )
}

// --------------------------------------------------------------- breakdown

function Bar({ value, max = 100, testid }) {
  const reduce = useReducedMotion()
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value / max)) * 100
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface-sunk)' }} data-testid={testid}>
      <motion.div className="h-full rounded-full" style={{ background: 'var(--text-2)' }}
        initial={reduce ? false : { width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: reduce ? 0 : 0.6, ease: 'easeOut' }} />
    </div>
  )
}

function Breakdown({ model, night, date }) {
  const perf = model.sleepScore(date)
  if (!perf) return null
  return (
    <section className="card rows p-0" data-testid="score-breakdown">
      {scoreBreakdown(night, perf, model.needH).map((p) => (
        <div key={p.key} className="px-4 py-3" data-testid={`part-${p.key}`}>
          <div className="flex items-baseline gap-2">
            <p className="flex-1 text-sm font-bold">{p.label}</p>
            <p className="text-sm font-black tabular-nums">{p.value ?? '–'}</p>
          </div>
          <div className="mt-2"><Bar value={p.value} /></div>
          <p className="mt-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>{p.text}</p>
        </div>
      ))}
    </section>
  )
}

// ------------------------------------------------------------------ stages

const STAGE_SCALE = 60 // the bars run to 60 % of time asleep

function Stages({ model, night, date }) {
  const [info, setInfo] = useState(false)
  const recent = useMemo(() => nightsEnding(model.nightBy, date, SLEEP_VIEW.averageNights), [model, date])
  const stats = stageStats(night, recent)
  const x = (p) => `${Math.min(100, (p / STAGE_SCALE) * 100)}%`
  return (
    <>
      <SectionTitle sub="Share of time asleep; awake is share of time in bed"
        action={<button onClick={() => setInfo(true)} aria-label="About sleep stages" className="p-1" style={{ color: 'var(--text-3)' }} data-testid="stages-info"><Info size={16} /></button>}>
        Stages
      </SectionTitle>
      <section className="card space-y-4 p-4" data-testid="sleep-stages">
        {!night.hasStages && <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>This source gives no stages.</p>}
        {night.hasStages && stats.map((s) => (
          <div key={s.key} data-testid={`stage-${s.key}`}>
            <div className="flex items-baseline gap-2">
              <p className="flex-1 text-sm font-bold">{s.label}</p>
              <p className="text-sm font-black tabular-nums">{durationWords(s.min)}</p>
              <p className="w-10 text-right text-xs font-bold tabular-nums" style={{ color: 'var(--text-3)' }}>{s.pct}%</p>
            </div>
            <div className="relative mt-2 h-2 w-full rounded-full" style={{ background: 'var(--surface-sunk)' }}>
              <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: x(s.pct), background: 'var(--series-sleep)', opacity: 0.85 }} />
              {s.typical && (
                <span className="absolute -inset-y-0.5 rounded-[4px]" style={{ left: x(s.typical[0]), width: `calc(${x(s.typical[1])} - ${x(s.typical[0])})`, background: 'var(--text)', opacity: 0.16 }} data-testid="stage-typical" />
              )}
              {s.avgPct != null && <span className="absolute -inset-y-1 w-0.5 rounded-full" style={{ left: x(s.avgPct), background: 'var(--text)' }} data-testid="stage-avg" />}
            </div>
            <p className="mt-1 text-[11px] font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
              {s.avgPct != null ? `30-night average ${s.avgPct}%` : ''}{s.typical ? `${s.avgPct != null ? ' · ' : ''}typical adult range ${s.typical[0]} to ${s.typical[1]}%` : ''}
            </p>
          </div>
        ))}
      </section>
      <Modal open={info} onClose={() => setInfo(false)} title="About sleep stages">
        <div className="space-y-2 text-sm font-medium" style={{ color: 'var(--text-2)' }} data-testid="stages-info-sheet">
          <p>Apple Watch estimates stages from movement and heart rate. They are estimates, more useful as a trend over many nights than for any one night.</p>
          <p>The faint band on Deep and REM is a typical adult range as a share of time asleep. It is context, not a target, and ranges vary from person to person.</p>
          <p>The thin line is your own average over the last 30 nights with stages.</p>
        </div>
      </Modal>
    </>
  )
}

// ------------------------------------------------------------------ vitals

const ARROW = { up: ArrowUp, down: ArrowDown, same: Minus }

function Vitals({ model, night, date }) {
  const maps = useMemo(() => {
    const m = { hrMin: new Map(), hrAvg: new Map(), hrv: new Map(), resp: new Map(), temp: new Map(), spo2: new Map() }
    for (const n of model.nightBy.values()) {
      if (n.sleepingHR) { m.hrMin.set(n.date, n.sleepingHR.min); m.hrAvg.set(n.date, n.sleepingHR.avg) }
    }
    for (const r of model.daily) {
      if (r.hrvOvernight != null) m.hrv.set(r.date, r.hrvOvernight)
      if (r.respRate != null) m.resp.set(r.date, r.respRate)
      if (r.wristTemp != null) m.temp.set(r.date, r.wristTemp)
      if (r.spo2 != null) m.spo2.set(r.date, r.spo2)
    }
    return m
  }, [model])
  const specs = [
    { key: 'hrMin', label: 'Lowest heart rate', unit: 'bpm', dp: 0 },
    { key: 'hrAvg', label: 'Average heart rate', unit: 'bpm', dp: 0 },
    { key: 'hrv', label: 'HRV', unit: 'ms', dp: 0 },
    { key: 'resp', label: 'Respiratory rate', unit: '/min', dp: 1 },
    { key: 'temp', label: 'Wrist temperature', unit: '°C', dp: 1 },
    { key: 'spo2', label: 'Blood oxygen', unit: '%', dp: 0 },
  ]
  const rows = specs.map((s) => vitalVsUsual(s, maps[s.key], date)).filter((r) => r.key !== 'spo2' || r.value != null)
  // a night cached before stage segments existed has no sleeping heart rate yet
  const pending = night.sleepingHR === undefined
  return (
    <section className="card rows p-0" data-testid="sleep-vitals">
      {pending && <p className="px-4 py-3 text-xs font-medium" style={{ color: 'var(--text-3)' }}>Sleeping heart rate fills in after the next sync.</p>}
      {rows.map((r) => {
        const Icon = r.direction ? ARROW[r.direction] : null
        // wrist temperature is shown as its difference from usual, the way the watch reports it
        const shown = r.key === 'temp'
          ? (r.delta != null ? `${r.delta > 0 ? '+' : r.delta < 0 ? '−' : ''}${Math.abs(r.delta).toFixed(1)}` : r.value != null ? r.value.toFixed(1) : '–')
          : r.value != null ? r.value.toFixed(r.dp) : '–'
        return (
          <div key={r.key} className="flex items-center gap-3 px-4 py-3" data-testid={`vital-${r.key}`}>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{r.label}</p>
              <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }} data-testid="vital-words">{r.words}</p>
            </div>
            {Icon && <Icon size={14} style={{ color: 'var(--text-3)' }} aria-hidden="true" />}
            <p className="w-20 text-right text-base font-black tabular-nums">{shown}<span className="ml-1 text-[11px] font-bold" style={{ color: 'var(--text-3)' }}>{r.unit}</span></p>
          </div>
        )
      })}
    </section>
  )
}

// ------------------------------------------------------------------ timing

function usePlan(model, t) {
  const settings = useStore((s) => s.healthSettings)
  return planBedtime({
    recent: nightsEnding(model.nightBy, t, 14), debtH: model.debtH(t), needH: model.needH,
    yesterdayLoad: model.loadVsUsual(addDays(t, -1)).label, wakeTarget: settings.wakeTarget, tz,
  })
}

function Timing({ model, t }) {
  const [count, setCount] = useState(14)
  const plan = usePlan(model, t)
  const rows = chronogram(model.nightBy, t, count, tz)
  const nights = nightsEnding(model.nightBy, t, count)
  const sd = consistencySd(nightsEnding(model.nightBy, t, 7), tz)
  const mid = nights.length ? mean(nights.map((n) => midpointFromNoon(n, tz))) : null
  const split = weekdayWeekend(nights, tz)
  return (
    <>
      <SectionTitle sub="Each bar runs from bedtime to waking"
        action={(
          <div className="flex gap-1" data-testid="timing-range">
            {[14, 30].map((n) => (
              <button key={n} onClick={() => setCount(n)} aria-pressed={count === n} data-testid={`timing-${n}`}
                className="rounded-full px-2.5 py-1 text-xs font-bold tabular-nums"
                style={count === n ? { background: 'var(--surface2)', color: 'var(--text)' } : { background: 'var(--surface-sunk)', color: 'var(--text-3)' }}>{n} nights</button>
            ))}
          </div>
        )}>
        Timing
      </SectionTitle>
      <section className="card p-4" data-testid="sleep-timing">
        <Chronogram rows={rows} target={plan.bedtime} bandMin={SLEEP_VIEW.bedtimeBandMin} />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div data-testid="sleep-consistency">
            <p className="t-caption" style={{ color: 'var(--text-3)' }}>Consistency</p>
            <p className="text-lg font-black tabular-nums">{sd != null ? `±${Math.round(sd)} min` : '–'}</p>
            <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>{sd != null ? 'Bed and wake, last 7 nights' : 'Needs 3 nights'}</p>
          </div>
          <div data-testid="sleep-midpoint">
            <p className="t-caption" style={{ color: 'var(--text-3)' }}>Average midpoint</p>
            <p className="text-lg font-black tabular-nums">{mid != null ? clockOf(mid) : '–'}</p>
            <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Halfway between bed and waking</p>
          </div>
        </div>
        <p className="mt-3 text-sm font-medium" style={{ color: 'var(--text-2)' }} data-testid="weekend-split">
          {split.text || 'Weekday and weekend timing needs 2 nights of each.'}
        </p>
      </section>
    </>
  )
}

// ------------------------------------------------------------ debt and plan

function DebtAndPlan({ model, t }) {
  const [open, setOpen] = useState(false)
  const plan = usePlan(model, t)
  const debt = model.debtH(t)
  const bars = debtNights(model.nightBy, t, model.needH)
  return (
    <>
      <SectionTitle sub={`Hours short of your ${model.needH} h over the last 7 nights`}>Debt and tonight</SectionTitle>
      <section className="card p-4" data-testid="sleep-debt">
        <p className="text-2xl font-black tabular-nums">{round(debt, 1)} h<span className="ml-2 text-sm font-bold" style={{ color: 'var(--text-3)' }}>7-night debt</span></p>
        <div className="mt-2"><DebtBars nights={bars} needH={model.needH} /></div>
        <p className="text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>A night with no record is left out, not counted as short.</p>
      </section>
      <button onClick={() => setOpen((v) => !v)} className="card w-full p-4 text-left" data-testid="sleep-planner" aria-expanded={open}>
        <p className="text-base font-black tabular-nums">Aim to be in bed by {plan.bedtime}</p>
        <p className="mt-1 text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }} data-testid="wind-down">Start winding down at {windDownAt(plan.bedtime)}</p>
        <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>To wake at {plan.wake}. Tap to see how.</p>
        {open && (
          <div className="mt-3 space-y-0.5 text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }} data-testid="planner-inputs">
            <p>Sleep need {durationWords(plan.inputs.needMin)}{plan.inputs.debtAddMin ? ` + ${plan.inputs.debtAddMin} min for this week’s debt` : ''}{plan.inputs.loadBumpMin ? ` + ${plan.inputs.loadBumpMin} min after a higher-load day` : ''}</p>
            <p>Typical efficiency {Math.round(plan.inputs.efficiency * 100)}%, so {durationWords(plan.inputs.inBedMin)} in bed</p>
            <p>Wake time {plan.wake} ({plan.inputs.wakeFrom === 'setting' ? 'your setting' : plan.inputs.wakeFrom === 'history' ? 'your usual, last 14 nights' : 'default'})</p>
          </div>
        )}
      </button>
    </>
  )
}

// ------------------------------------------------- what affects your sleep

function Factors({ model, t }) {
  const habits = useStore((s) => s.habits)
  const [habitsOpen, setHabitsOpen] = useState(false)
  const saunaSessions = useStore((s) => s.saunaSessions)
  const habitLogs = useStore((s) => s.habitLogs)
  const doseLogs = useStore((s) => s.doseLogs)
  const compounds = useCompounds()
  const rows = useMemo(() => {
    const days = dateRange(addDays(t, -365), addDays(t, -1))
    const next = (d) => addDays(d, 1)
    const sauna = dayFlags(saunaSessions,
      (wake) => { const n = model.nightBy.get(wake); return n ? { start: n.start, score: null, deepMin: null, sleepingHR: null } : null },
      (date, hhmm) => tz.startOfDay(date) + minutesOf(hhmm) * 60000)
    const factors = [
      { key: 'late', label: 'Late workouts', phrase: 'days with a workout ending within 3 h of bedtime', inGroup: lateWorkoutDay(model.sessions, model.nightBy) },
      { key: 'load', label: 'Higher-load training days', phrase: 'higher-load training days', inGroup: (d) => higherLoadDay(model.load, d) },
      // sauna: any session, a longer one (over 30 min), and one ending within 3 h of bedtime
      { key: 'sauna', label: 'Sauna', phrase: 'days with a sauna', inGroup: sauna.has },
      { key: 'saunaLong', label: 'Sauna over 30 min', phrase: 'days with a sauna over 30 min', inGroup: (d) => sauna.minutes(d) > 30 },
      { key: 'saunaLate', label: 'Late sauna', phrase: 'days with a sauna ending within 3 h of bedtime', inGroup: sauna.late },
      ...compounds.filter((c) => doseLogs.some((l) => l.peptideId === c.id)).map((c) => {
        const dosed = new Set(doseLogs.filter((l) => l.peptideId === c.id).map((l) => l.date))
        const onIt = (d) => (c.runs || []).some((r) => r.startedOn <= d && (!r.endedOn || r.endedOn >= d))
        return { key: `dose:${c.id}`, label: `${c.name} dose days`, phrase: `days with a ${c.name} dose`, inGroup: (d) => (dosed.has(d) ? true : onIt(d) ? false : null) }
      }),
      ...habits.map((h) => ({
        key: `habit:${h.id}`, label: h.name, phrase: `days with ${h.name}`,
        inGroup: (d) => { const log = habitLogs[d]; return log && Object.keys(log).length ? log[h.id] === true : null },
      })),
    ]
    const scorePts = [...model.nightBy.keys()].map((d) => ({ date: d, value: model.sleepScore(d)?.score })).filter((p) => p.value != null)
    const deepPts = [...model.nightBy.values()].filter((n) => n.hasStages).map((n) => ({ date: n.date, value: n.deepMin }))
    const hrvPts = [...model.series.hrv.entries()].map(([date, value]) => ({ date, value }))
    const outcomes = [
      { key: 'sleepScore', label: 'Sleep score', unit: '', dp: 0, wobble: wobbleOf(scorePts, 'sleepScore', t).value, fn: (d) => model.sleepScore(next(d))?.score ?? null },
      { key: 'deepSleep', label: 'Deep sleep', unit: 'min', dp: 0, wobble: wobbleOf(deepPts, 'deepSleep', t).value, fn: (d) => { const n = model.nightBy.get(next(d)); return n?.hasStages ? n.deepMin : null } },
      { key: 'hrv', label: 'Next-morning HRV', unit: 'ms', dp: 0, wobble: wobbleOf(hrvPts, 'hrv', t).value, fn: (d) => model.series.hrv.get(next(d)) ?? null },
    ]
    return sleepFactors({ days, factors, outcomes })
  }, [model, t, habits, habitLogs, doseLogs, compounds, saunaSessions])
  return (
    <>
      <SectionTitle sub={`Nights after each, against nights without. Needs ${SLEEP_VIEW.minPerGroup} nights in each group.`}>What goes with your sleep</SectionTitle>
      <section className="card rows p-0" data-testid="sleep-factors">
        {/* the habits journal's entry point (with the calendar day sheet) */}
        <button onClick={() => setHabitsOpen(true)} className="flex w-full items-center gap-2 px-4 py-3 text-left" data-testid="log-habits">
          <span className="min-w-0 flex-1 text-sm font-black">Log today's habits</span>
          <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
        </button>
        {rows.map((r) => (
          <div key={r.key} className="px-4 py-3" data-testid="sleep-factor" data-enough={r.enough ? '1' : '0'}>
            <div className="flex items-baseline gap-2">
              <p className="min-w-0 flex-1 text-sm font-bold">{r.label}</p>
              {r.gate && <p className="text-xs font-bold tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="factor-gate">{r.gate}</p>}
            </div>
            {r.enough && r.results.filter((x) => x.text).map((x) => (
              <div key={x.key} className="mt-2">
                <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>{x.text}</p>
                <p className="text-[11px] font-bold tabular-nums" style={{ color: 'var(--text-3)' }}>{x.verdict} · {x.nWith} nights with, {x.nWithout} without</p>
              </div>
            ))}
          </div>
        ))}
      </section>
      <p className="px-1 text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>
        Higher or lower on days with, not because of. {COMPARE.caveat}
      </p>
      <HabitsSheet open={habitsOpen} onClose={() => setHabitsOpen(false)} t={t} />
    </>
  )
}

/** Yes or no for each habit, today or any past day. */
function HabitsSheet({ open, onClose, t }) {
  const [date, setDate] = useState(t)
  return (
    <Modal open={open} onClose={onClose} title="Habits">
      <div className="space-y-3" data-testid="habits-sheet">
        <div className="flex items-center gap-2">
          <button onClick={() => setDate(addDays(date, -1))} aria-label="Previous day" className="rounded-full p-2" style={{ background: 'var(--surface-sunk)' }} data-testid="habits-prev"><ChevronLeft size={16} /></button>
          <p className="flex-1 text-center text-sm font-black" data-testid="habits-date">{date === t ? 'Today' : date === addDays(t, -1) ? 'Yesterday' : format(parseISO(date), 'EEE d MMM')}</p>
          <button onClick={() => date < t && setDate(addDays(date, 1))} disabled={date >= t} aria-label="Next day" className="rounded-full p-2 disabled:opacity-30" style={{ background: 'var(--surface-sunk)' }}><ChevronRight size={16} /></button>
        </div>
        <HabitChips date={date} />
        <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Tap what you did. Once anything is answered, the rest count as no. Edit habits in More › Health.</p>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ trends

function Trends({ model }) {
  const events = useChartEvents()
  const s = useMemo(() => {
    const nights = [...model.nightBy.values()].sort((a, b) => a.date.localeCompare(b.date))
    const staged = nights.filter((n) => n.hasStages)
    return {
      sleep: nights.map((n) => ({ date: n.date, value: n.asleepMin / 60 })),
      score: nights.map((n) => ({ date: n.date, value: model.sleepScore(n.date)?.score })).filter((p) => p.value != null),
      deep: staged.map((n) => ({ date: n.date, value: n.deepMin })),
      rem: staged.map((n) => ({ date: n.date, value: n.remMin })),
      hr: nights.filter((n) => n.sleepingHR).map((n) => ({ date: n.date, value: n.sleepingHR.min })),
      hrv: model.daily.filter((r) => r.hrvOvernight != null).map((r) => ({ date: r.date, value: r.hrvOvernight })),
      bed: nights.map((n) => ({ date: n.date, value: clockFromNoon(n.start, tz) })),
    }
  }, [model])
  return (
    <div className="space-y-3" data-testid="sleep-trends">
      <TrendChart metric="sleep" title="Time asleep" unit="h" dp={1} series={s.sleep} events={events} testid="sleep-duration-chart" />
      <TrendChart metric="sleepScore" title="Sleep score" dp={0} series={s.score} events={events} />
      <TrendChart metric="deepSleep" title="Deep sleep" unit="min" dp={0} series={s.deep} events={events} />
      <TrendChart metric="remSleep" title="REM sleep" unit="min" dp={0} series={s.rem} events={events} />
      <TrendChart metric="sleepHR" title="Lowest heart rate asleep" unit="bpm" dp={0} series={s.hr} events={events} />
      <TrendChart metric="hrv" chartType="sleepHrv" title="Overnight HRV" unit="ms" dp={0} series={s.hrv} events={events} />
      <TrendChart metric="bedtime" title="Bedtime" dp={0} series={s.bed} events={events} format={clockOf} changeUnit="min" />
    </div>
  )
}

// -------------------------------------------------------------------- naps

function Naps({ model, t }) {
  const naps = dateRange(addDays(t, -13), t).flatMap((d) => (model.nightBy.get(d)?.naps || []).map((n) => ({ ...n, date: d })))
  return (
    <section className="card p-4" data-testid="naps">
      <p className="text-base font-black">Naps</p>
      <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Last 14 days. Shown, not scored.</p>
      {naps.length === 0 ? (
        <p className="mt-2 text-sm font-medium" style={{ color: 'var(--text-2)' }}>No naps recorded.</p>
      ) : naps.map((n) => (
        <p key={`${n.date}-${n.start}`} className="mt-2 text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
          {format(parseISO(n.date), 'EEE d MMM')} · {clock(n.start)} · {durationWords(n.asleepMin)}
        </p>
      ))}
    </section>
  )
}
