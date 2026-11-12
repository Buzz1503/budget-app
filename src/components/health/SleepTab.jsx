import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, Info, Activity, Moon, HeartPulse, TrendingUp, Gauge, Layers } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import { CountIn, FillRing, Stagger, StaggerItem } from '../ui/Motion'
import { addDays, dateRange } from '../../health/tz'
import { nightsEnding, clockFromNoon } from '../../health/engine/sleep'
import { SLEEP_VIEW } from '../../health/engine/config'
import {
  scoreBand, scoreBreakdown, stageStats, vitalVsUsual, clockOf, durationWords,
} from '../../health/engine/sleepView'
import useHealthModel, { tz } from './useHealthModel'
import { NotConnected, EmptyState } from './BodyHealthView'
import { HEALTH_BANDS } from './bands'
import { NightCalendar } from './SleepCharts'
import EveningSheet from '../sleep/EveningSheet'
import MorningCheck from '../sleep/MorningCheck'
import NightCard from './NightCard'
import AnalysisScreen from './SleepAnalysis'
import RestlessnessScreen from './RestlessnessScreen'
import ApneaScreen from './ApneaScreen'
import NightmaresScreen from './NightmaresScreen'
import useSleepLab from './useSleepLab'
import useHeart from './useHeart'
import { HeartSummaryText } from './HeartSummary'
import SleepSetupCard from './SleepSetup'
import { useNativeFeed } from '../../native/feed'
import { OTHER_SOURCE_LABEL } from '../../sleep/sources'
import { DeltaChip, InfoButton } from '../ui/Glance'
import { spikeRule } from '../../sleep/restless'
import {
  VsNormal, StagesCard, ShapedCard, Last14, DebtCard, TonightCard, LabTeaser, TrendsScreen, MetricScreen, CheckNumbers, RowLink, Back,
  useBedDiff, verdictFor,
} from './SleepMain'

const clock = (ms) => clockOf(clockFromNoon(ms, tz))
const dayWords = (d, t) => (d === t ? 'Last night' : d === addDays(t, -1) ? 'The night before' : `Night to ${format(parseISO(d), 'EEE d MMM')}`)

/** A section heading: icon, title, an optional (i) and an action on the right. */
function SectionTitle({ children, icon: Icon, info, infoTitle, action }) {
  return (
    <div className="flex items-center gap-2 px-1">
      {Icon && <Icon size={18} style={{ color: 'var(--text-2)' }} aria-hidden="true" />}
      <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold">{children}</h2>
      {action}
      {info && <InfoButton title={infoTitle || (typeof children === 'string' ? children : 'About this')}>{info}</InfoButton>}
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
  // 'analysis' | 'restless' | 'apnea' | 'nightmares' | 'detail' | 'trends' | 'metric:<key>'
  const [view, setView] = useState(null)
  const [evening, setEvening] = useState(false)
  const lab = useSleepLab()
  const heart = useHeart()
  // the evening prompt's Log button
  const openEvening = useNativeFeed((s) => s.openEvening)
  useEffect(() => {
    if (!openEvening) return
    setEvening(true)
    useNativeFeed.setState({ openEvening: false })
  }, [openEvening])
  const night = date ? model.nightBy.get(date) : null
  const bed = useBedDiff(model, night)
  // a new screen opens at its top
  useEffect(() => { try { window.scrollTo(0, 0) } catch { /* no window */ } }, [view])
  const back = () => setView(null)
  if (view === 'analysis') return <AnalysisScreen lab={lab} onBack={back} />
  if (view === 'restless') return <RestlessnessScreen lab={lab} onBack={back} />
  if (view === 'apnea') return <ApneaScreen lab={lab} onBack={back} />
  if (view === 'nightmares') return <NightmaresScreen lab={lab} onBack={back} />
  if (view === 'trends') return <TrendsScreen model={model} onBack={back} />
  if (view?.startsWith('metric:')) return <MetricScreen model={model} heart={heart} metricKey={view.slice(7)} onBack={back} />
  if (!dates.length || !night) {
    return <div className="card p-4"><p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>No main sleep recorded yet.</p></div>
  }
  if (view === 'detail') return <NightDetail model={model} lab={lab} night={night} date={date} onBack={back} />
  const i = dates.indexOf(date)
  const prev = i > 0 ? dates[i - 1] : null
  const next = i < dates.length - 1 ? dates[i + 1] : null

  return (
    <Stagger className="space-y-6" data-testid="sleep-view">
      <StaggerItem className="space-y-2">
        <Hero model={model} night={night} date={date} t={t} prev={prev} next={next} setDate={setDate} openCalendar={() => setCalendar(true)} bed={bed} heart={heart} />
        <RowLink title="Trends" sub="7, 30 and 90 nights: time asleep, deep, REM, heart rate, HRV, consistency, score" onClick={() => setView('trends')} testid="open-trends" icon={TrendingUp} />
      </StaggerItem>
      <StaggerItem><MorningCheck /></StaggerItem>
      <StaggerItem><VsNormal model={model} heart={heart} date={date} onOpen={(k) => setView(`metric:${k}`)} /></StaggerItem>
      <StaggerItem><StagesCard model={model} night={night} date={date} onDetail={() => setView('detail')} /></StaggerItem>
      <StaggerItem><ShapedCard lab={lab} date={date} /></StaggerItem>
      <StaggerItem><Last14 model={model} t={t} /></StaggerItem>
      <StaggerItem><DebtCard model={model} t={t} /></StaggerItem>
      <StaggerItem><TonightCard model={model} lab={lab} onLogEvening={() => setEvening(true)} /></StaggerItem>
      <StaggerItem><LabTeaser lab={lab} onOpen={() => setView('analysis')} onOpenView={setView} /></StaggerItem>
      <EveningSheet open={evening} onClose={() => setEvening(false)} />
      <Modal open={calendar} onClose={() => setCalendar(false)} title="Nights">
        <NightCalendar selected={date} today={t} hasNight={(d) => model.nightBy.has(d)} scoreOf={(d) => model.sleepScore(d)?.score}
          onPick={(d) => { setDate(d); setCalendar(false) }} />
      </Modal>
    </Stagger>
  )
}

/**
 * The night in detail: the gesture chart with every lane and what happened,
 * the numbers checked, the score's parts, stages, vitals and naps. Everything
 * the main tab leaves out is here.
 */
function NightDetail({ model, lab, night, date, onBack }) {
  const t = todayStr()
  return (
    <div className="space-y-6" data-testid="night-detail">
      <Back title={dayWords(date, t)} onBack={onBack} />
      <section className="space-y-2">
        <SectionTitle icon={Activity} info={<p>Stages, heart rate, HRV, blood oxygen and breathing rate from Apple Health on one clock. Drag sideways to read every lane at one moment, pinch to zoom, double tap to see the whole night. The expand button opens full screen.</p>}>Through the night</SectionTitle>
        <div className="card p-4">
          <NightCard night={night} overnight={night.overnight} tz={tz} events={lab.extras.get(date)?.events || []} />
          <NightFactorsLine feature={lab.featureBy.get(date)} />
          <p className="mt-3 text-[13px] font-medium" style={{ color: 'var(--text-3)' }} data-testid="detail-spike-rule">{spikeRule(night.overnight?.hr, night.start)}</p>
        </div>
      </section>
      <CheckNumbers model={model} />
      <section className="space-y-2">
        <SectionTitle icon={Gauge} info={<p>The sleep score is four parts, each out of 100. Tap a part for what went into it.</p>}>Score breakdown</SectionTitle>
        <Breakdown model={model} night={night} date={date} />
      </section>
      <section className="space-y-2"><Stages model={model} night={night} date={date} /></section>
      <section className="space-y-2">
        <SectionTitle icon={HeartPulse} info={<p>This night against your usual, the median of the 28 nights before. Green chips moved the better way for that measure, amber the other way, grey means about the same or no better side (respiratory rate, wrist temperature).</p>}>Overnight vitals</SectionTitle>
        <Vitals model={model} night={night} date={date} />
      </section>
      <Naps model={model} t={t} />
    </div>
  )
}

/** "2 drinks, last 9:40 pm · Temazepam 10 mg 9:15 pm · Magnesium 0.4 g" */
function NightFactorsLine({ feature }) {
  if (!feature?.line?.length) return null
  return <p className="mt-2 text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }} data-testid="night-factors">{feature.line.join(' · ')}</p>
}

// -------------------------------------------------------------------- hero

/** "1 h 41 m short of your 8 h." / "Over your 8 h by 20 m." / "Right on your 8 h." */
export function sleepAnswer(asleepMin, needH) {
  const diff = Math.round(asleepMin - needH * 60)
  if (Math.abs(diff) < 15) return `Right on your ${needH} h.`
  return diff < 0 ? `${durationWords(-diff)} short of your ${needH} h.` : `${durationWords(diff)} over your ${needH} h.`
}

function Hero({ model, night, date, t, prev, next, setDate, openCalendar, bed, heart }) {
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
          <FillRing value={perf?.score ?? 0} size={104} stroke={9} color={band ? HEALTH_BANDS[band].tone : 'var(--text-3)'} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-3xl font-black tabular-nums leading-none" data-testid="sleep-score">{perf ? <CountIn value={perf.score} /> : '–'}</p>
            <p className="mt-1 text-[11px] font-bold" style={{ color: 'var(--text-3)' }}>{band ? HEALTH_BANDS[band].label : 'Score'}</p>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[19px] font-semibold leading-snug" data-testid="sleep-verdict">{verdictFor(model, night, bed)}</p>
        </div>
      </div>
      <p className="mt-4 text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }} data-testid="sleep-times">
        In bed {clock(night.start)} to {clock(night.end)} · asleep {durationWords(night.asleepMin)}
      </p>
      {night.fallback ? (
        <p className="mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}
          data-testid="other-source" title={`From ${night.sourceName || 'another source'}: kept out of your baselines and the Sleep Lab`}>
          {OTHER_SOURCE_LABEL} · {night.sourceName || 'unknown'}
        </p>
      ) : (
        <p className="mt-0.5 text-[13px] font-medium" style={{ color: 'var(--text-3)' }} data-testid="sleep-source">From {night.sourceName || 'Apple Health'}</p>
      )}
      {!night.hasStages && <p className="mt-1 text-sm font-medium" style={{ color: 'var(--text-2)' }} data-testid="no-stages">No stages from {night.sourceName || 'this source'}, so the score and stage comparisons leave this night out.</p>}
      {!night.fallback && heart?.hearts.has(date) && <HeartSummaryText heart={heart} date={date} className="mt-3 border-t pt-3" />}
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
  const [open, setOpen] = useState(null)
  const perf = model.sleepScore(date)
  if (!perf) return null
  return (
    <section className="card rows p-0" data-testid="score-breakdown">
      {scoreBreakdown(night, perf, model.needH).map((p) => (
        <button key={p.key} onClick={() => setOpen(open === p.key ? null : p.key)} className="block w-full px-4 py-3 text-left" data-testid={`part-${p.key}`} aria-expanded={open === p.key}>
          <div className="flex items-center gap-3">
            <p className="w-[104px] shrink-0 text-[15px] font-medium">{p.label}</p>
            <div className="min-w-0 flex-1"><Bar value={p.value} /></div>
            <p className="w-9 text-right text-[17px] font-semibold tabular-nums">{p.value ?? '–'}</p>
          </div>
          {open === p.key && <p className="mt-2 text-sm font-medium" style={{ color: 'var(--text-2)' }}>{p.text}</p>}
        </button>
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
      <SectionTitle icon={Layers}
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
            {s.avgPct != null && (
              <p className="mt-1 text-[13px] font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>Your usual {s.avgPct}%</p>
            )}
          </div>
        ))}
      </section>
      <Modal open={info} onClose={() => setInfo(false)} title="About sleep stages">
        <div className="space-y-2 text-sm font-medium" style={{ color: 'var(--text-2)' }} data-testid="stages-info-sheet">
          <p>Apple Watch estimates stages from movement and heart rate. They are estimates, more useful as a trend over many nights than for any one night.</p>
          <p>The faint band on Deep and REM is a typical adult range as a share of time asleep. It is context, not a target, and ranges vary from person to person.</p>
          <p>The thin line is your own average over the last 30 nights with stages.</p>
          <p>Each bar is the share of time asleep; awake is the share of time in bed.</p>
        </div>
      </Modal>
    </>
  )
}

// ------------------------------------------------------------------ vitals

const VITAL_METRIC = { hrMin: 'lowestHR', hrAvg: 'avgHR', hrv: 'hrv', resp: 'respiratory', temp: 'wristTemp', spo2: 'spo2' }

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
        // wrist temperature is shown as its difference from usual, the way the watch reports it
        const shown = r.key === 'temp'
          ? (r.delta != null ? `${r.delta > 0 ? '+' : r.delta < 0 ? '−' : ''}${Math.abs(r.delta).toFixed(1)}` : r.value != null ? r.value.toFixed(1) : '–')
          : r.value != null ? r.value.toFixed(r.dp) : '–'
        const sub = r.value == null ? 'Not recorded' : r.usual == null ? r.words.replace(/\.$/, '') : r.key === 'temp' ? 'Against your usual' : `Usual ${r.usual.toFixed(r.dp)}`
        return (
          <div key={r.key} className="flex items-center gap-3 px-4 py-3" data-testid={`vital-${r.key}`}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">{r.label}</p>
              <p className="truncate text-[13px] font-medium tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="vital-words">{sub}</p>
            </div>
            <p className="shrink-0 text-right text-[17px] font-semibold tabular-nums">{shown}<span className="ml-0.5 text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>{r.unit}</span></p>
            {r.key !== 'temp' && r.delta != null && <DeltaChip metric={r.direction === 'same' ? null : VITAL_METRIC[r.key]} delta={r.direction === 'same' ? 0 : r.delta} dp={r.dp} />}
          </div>
        )
      })}
    </section>
  )
}

// -------------------------------------------------------------------- naps

function Naps({ model, t }) {
  const naps = dateRange(addDays(t, -13), t).flatMap((d) => (model.nightBy.get(d)?.naps || []).map((n) => ({ ...n, date: d })))
  return (
    <section className="card p-4" data-testid="naps">
      <div className="flex items-center gap-2">
        <Moon size={18} style={{ color: 'var(--text-2)' }} aria-hidden="true" />
        <p className="flex-1 text-[17px] font-semibold">Naps</p>
        <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>{naps.length ? `${naps.length} in 14 days` : 'None in 14 days'}</p>
      </div>
      {naps.map((n) => (
        <p key={`${n.date}-${n.start}`} className="mt-2 text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
          {format(parseISO(n.date), 'EEE d MMM')} · {clock(n.start)} · {durationWords(n.asleepMin)}
        </p>
      ))}
    </section>
  )
}
