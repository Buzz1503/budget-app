import { useEffect, useMemo, useState } from 'react'
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
import { COMPARE, SLEEP_VIEW } from '../../health/engine/config'
import { mean, round } from '../../health/engine/stats'
import {
  scoreBand, scoreBreakdown, stageStats, vitalVsUsual, weekdayWeekend, midpointFromNoon, chronogram, clockOf,
  windDownAt, debtNights, durationWords,
} from '../../health/engine/sleepView'
import useHealthModel, { tz } from './useHealthModel'
import { NotConnected, EmptyState } from './BodyHealthView'
import { HEALTH_BANDS } from './bands'
import { Hypnogram, Chronogram, DebtBars, NightCalendar } from './SleepCharts'
import EveningSheet from '../sleep/EveningSheet'
import MorningCheck from '../sleep/MorningCheck'
import NightStrips from './NightStrips'
import AnalysisScreen from './SleepAnalysis'
import RestlessnessScreen from './RestlessnessScreen'
import ApneaScreen from './ApneaScreen'
import NightmaresScreen from './NightmaresScreen'
import SoundsScreen, { SoundsRow, useNightSounds, useSoundsLive } from './SoundsScreen'
import useSleepLab from './useSleepLab'
import SleepSetupCard from './SleepSetup'
import { useNativeFeed } from '../../native/feed'
import { recordingMissing, soundsMissed, SOUNDS_MISSED_LINE } from '../../sleep/prompts'
import { soundsStatus } from '../../native/sleepRuntime'
import { soundsLine, minutesWords } from '../../sleep/soundsView'

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
  const [view, setView] = useState(null) // 'analysis' | 'restless' | 'apnea' | 'nightmares' | 'sounds'
  const lab = useSleepLab()
  const restlessOn = useStore((s) => s.sleepSettings.restlessness !== false)
  const nightExtras = useStore((s) => s.nightExtras)
  const firstRecorded = useMemo(() => Object.keys(nightExtras).filter((d) => nightExtras[d]?.restless).sort()[0] || null, [nightExtras])
  const soundsNotice = useSoundsNotice(t, nightExtras)
  const soundsOn = useStore((s) => !!s.sleepSettings.sleepSounds)
  const live = useSoundsLive(soundsOn)
  const shown = useNightSounds(model, date || dates.at(-1))
  const today = useNightSounds(model, t)
  const isLatest = date === dates.at(-1)
  const lineFor = (n, label, isLast, liveNow) => soundsLine({ enabled: soundsOn, running: !!live?.running, startedAt: live?.startedAt ?? null, sounds: n, label, isLast, live: liveNow, clock })
  if (view === 'analysis') return <AnalysisScreen lab={lab} onBack={() => setView(null)} />
  if (view === 'restless') return <RestlessnessScreen lab={lab} onBack={() => setView(null)} />
  if (view === 'apnea') return <ApneaScreen lab={lab} onBack={() => setView(null)} />
  if (view === 'nightmares') return <NightmaresScreen lab={lab} onBack={() => setView(null)} />
  if (view === 'sounds') return <SoundsScreen lab={lab} date={date} label={dayWords(date, t)} isLast={date === t} onBack={() => setView(null)} />
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
        <MorningCheck notice={soundsNotice}
          soundsSummary={soundsOn && !soundsNotice ? lineFor(today.n, 'Last night', true, true) : null} onOpenSounds={() => { setDate(t); setView('sounds') }} />
      </StaggerItem>
      <StaggerItem><SleepSetupCard model={model} /></StaggerItem>
      <StaggerItem>
        <Hero model={model} night={night} date={date} t={t} prev={prev} next={next} setDate={setDate} openCalendar={() => setCalendar(true)} sounds={shown.n} />
      </StaggerItem>
      <StaggerItem className="space-y-2">
        <SectionTitle sub="Awake at the top, deep sleep at the bottom">Through the night</SectionTitle>
        <section className="card p-4">
          <Hypnogram night={night} tz={tz} />
          <NightStrips night={night} overnight={night.overnight} restless={lab.extras.get(date)?.restless}
            soundSessions={nightExtras[date]?.sounds}
            noRecording={recordingMissing({ enabled: restlessOn, date, firstRecorded, hasSleep: true, hasRecording: !!lab.extras.get(date)?.restless })}
            events={(lab.extras.get(date)?.events || []).map((e) => ({ t: e.t, level: lab.extras.get(date)?.rating === 'Likely' ? 'likely' : 'possible', label: `Heart rate +${e.surge} bpm` }))} />
          <NightFactorsLine feature={lab.featureBy.get(date)} />
        </section>
        <SoundsRow line={lineFor(shown.n, dayWords(date, t), date === t, isLatest)} onOpen={() => setView('sounds')} />
      </StaggerItem>
      <StaggerItem className="space-y-2">
        <SectionTitle sub="Your own nights, compared">Sleep Lab</SectionTitle>
        <LabLinks onOpen={setView} />
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
      <StaggerItem className="space-y-2"><Factors /></StaggerItem>
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

/** "Sleep sounds didn't run last night": on, not running now, and nothing came in for this morning. */
function useSoundsNotice(t, nightExtras) {
  const ss = useStore((s) => s.sleepSettings)
  const [running, setRunning] = useState(null)
  useEffect(() => {
    let live = true
    if (ss.sleepSounds) soundsStatus().then((r) => { if (live) setRunning(!!r?.running) })
    return () => { live = false }
  }, [ss.sleepSounds])
  const firstNight = useMemo(() => Object.keys(nightExtras).filter((d) => nightExtras[d]?.sounds?.length).sort()[0] || null, [nightExtras])
  if (running == null) return null
  const missed = soundsMissed({ enabled: !!ss.sleepSounds, onSince: ss.soundsOnSince || firstNight, today: t, running, recordedTonight: !!nightExtras[t]?.sounds?.length })
  return missed ? SOUNDS_MISSED_LINE : null
}

/** "2 drinks, last 9:40 pm · Temazepam 10 mg 9:15 pm · Magnesium 0.4 g" */
function NightFactorsLine({ feature }) {
  if (!feature?.line?.length) return null
  return <p className="mt-2 text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }} data-testid="night-factors">{feature.line.join(' · ')}</p>
}

const LAB_LINKS = [
  ['analysis', 'Analysis', 'What helps and what hurts your sleep'],
  ['apnea', 'Apnea screen', 'STOP-BANG and overnight breathing signals'],
  ['nightmares', 'Nightmares', 'Estimated from heart rate surges, checked against your answers'],
  ['restless', 'Restlessness', 'Movement through the night, from the Watch'],
]

function LabLinks({ onOpen }) {
  return (
    <section className="card rows p-0" data-testid="lab-links">
      {LAB_LINKS.map(([id, title, sub]) => (
        <button key={id} onClick={() => onOpen(id)} className="flex w-full items-center gap-2 px-4 py-3 text-left" data-testid={`lab-open-${id}`}>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-black">{title}</span>
            <span className="block text-xs font-medium" style={{ color: 'var(--text-3)' }}>{sub}</span>
          </span>
          <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
        </button>
      ))}
    </section>
  )
}

// -------------------------------------------------------------------- hero

function Hero({ model, night, date, t, prev, next, setDate, openCalendar, sounds }) {
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
          {sounds && (
            <p className="mt-1 text-xs font-bold tabular-nums" style={{ color: 'var(--text-2)' }} data-testid="hero-snoring">
              {sounds.snoringMin > 0 ? `Snoring ${minutesWords(sounds.snoringMin)}` : 'No snoring heard'}
            </p>
          )}
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

/** The evening sheet's entry point; the comparisons themselves are in Sleep › Analysis. */
function Factors() {
  const [open, setOpen] = useState(false)
  // the evening prompt's Log button
  const openEvening = useNativeFeed((s) => s.openEvening)
  useEffect(() => {
    if (!openEvening) return
    setOpen(true)
    useNativeFeed.setState({ openEvening: false })
  }, [openEvening])
  return (
    <>
      <SectionTitle sub="Drinks, meals and the rest of the evening. All optional.">This evening</SectionTitle>
      <section className="card rows p-0" data-testid="sleep-factors">
        <button onClick={() => setOpen(true)} className="flex w-full items-center gap-2 px-4 py-3 text-left" data-testid="log-habits">
          <span className="min-w-0 flex-1 text-sm font-black">Log this evening</span>
          <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
        </button>
      </section>
      <EveningSheet open={open} onClose={() => setOpen(false)} />
    </>
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
