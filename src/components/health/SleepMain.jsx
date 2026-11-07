import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Minus, Layers, Sparkles, CalendarRange, BedDouble, Moon, FlaskConical } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../../store/useStore'
import TrendChart from '../charts/TrendChart'
import useChartEvents from '../charts/useChartEvents'
import { AnswerLine, InfoButton } from '../ui/Glance'
import { addDays, dateRange } from '../../health/tz'
import { planBedtime } from '../../health/engine/planner'
import { nightsEnding, clockFromNoon, consistencySd } from '../../health/engine/sleep'
import { stageStats, clockOf, windDownAt } from '../../health/engine/sleepView'
import { SLEEP_VIEW } from '../../health/engine/config'
import { factorName, OUTCOME_BY_KEY } from '../../sleep/analysis/dataset'
import {
  vsNormal, asleepVsNeed, trendDiff, trendTone, verdict, bedtimeVsUsual, needBars, windowStats, debtView, labLine, shapedChips, trendAnswer, hm, NOT_ENOUGH,
} from '../../sleep/tabView'
import { stageCheck, hm as hmCheck } from '../../sleep/stageCheck'
import { RangeRow, StagesBar, NeedBarsChart, WindowChart } from './SleepV2Charts'
import useSleepAnalysis from './useSleepAnalysis'
import { tz } from './useHealthModel'

const soft = { color: 'var(--text-2)' }
const muted = { color: 'var(--text-3)' }
const short = (d) => format(parseISO(d), 'd MMM')
const counts = (model) => (d) => { const n = model.nightBy.get(d); return !!n && !n.fallback }
/** "6h 37m": no spaces, so it never breaks across lines in a narrow column */
export const compactHm = (min) => { const m = Math.round(min); return `${Math.floor(m / 60)}h\u00a0${String(m % 60).padStart(2, '0')}` }
const noCi = (s) => String(s || '').replace(/\s*\(95% CI[^)]*\)\s*$/, '')

export function Section({ icon: Icon, title, info, children, testid, action }) {
  return (
    <section className="space-y-2" data-testid={testid}>
      <div className="flex items-center gap-2 px-1">
        {Icon && <Icon size={18} style={soft} aria-hidden="true" />}
        <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold">{title}</h2>
        {action}
        {info && <InfoButton title={title}>{info}</InfoButton>}
      </div>
      {children}
    </section>
  )
}

export function RowLink({ title, sub, onClick, testid, icon: Icon }) {
  return (
    <button type="button" onClick={onClick} className="card flex w-full items-center gap-3 px-4 py-3 text-left" data-testid={testid}>
      {Icon && <Icon size={18} style={soft} aria-hidden="true" />}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{title}</span>
        {sub && <span className="block truncate text-[13px] font-medium" style={soft}>{sub}</span>}
      </span>
      <ChevronRight size={16} style={muted} />
    </button>
  )
}

/** Each night's bedtime and wake as minutes from noon (chosen source only). */
function liteNights(model, from, to) {
  return dateRange(from, to).map((d) => model.nightBy.get(d)).filter((n) => n && !n.fallback).map((n) => {
    const bed = clockFromNoon(n.start, tz)
    return { date: n.date, asleepMin: n.asleepMin, bedFromNoon: bed, wakeFromNoon: bed + (n.end - n.start) / 60000 }
  })
}

/** The verdict's bedtime part: against the median of the 14 nights before. */
export function useBedDiff(model, night) {
  return useMemo(() => {
    if (!night) return { usual: null, diff: null }
    const before = liteNights(model, addDays(night.date, -14), addDays(night.date, -1)).map((n) => n.bedFromNoon)
    return bedtimeVsUsual(clockFromNoon(night.start, tz), before)
  }, [model, night])
}

export function verdictFor(model, night, bed) {
  // durations keep together on one line: "7 h 52 m"
  return verdictText(model, night, bed).replace(/(\d+) h (\d+) m/g, '$1\u00a0h\u00a0$2\u00a0m').replace(/(\d+) min/g, '$1\u00a0min')
}
function verdictText(model, night, bed) {
  return verdict({ asleepMin: night.asleepMin, needH: model.needH, score: model.sleepScore(night.date)?.score ?? null, bedDiffMin: bed.diff })
}

// ----------------------------------------------------- last night vs normal

/** The series for each metric, by wake date. */
export function useMetricSeries(model) {
  return useMemo(() => {
    const m = { asleep: new Map(), deep: new Map(), rem: new Map(), awake: new Map(), hr: new Map(), hrv: new Map(), resp: new Map(), spo2: new Map(), temp: new Map() }
    for (const n of model.nightBy.values()) {
      m.asleep.set(n.date, Math.round(n.asleepMin))
      if (n.hasStages) { m.deep.set(n.date, Math.round(n.deepMin)); m.rem.set(n.date, Math.round(n.remMin)); m.awake.set(n.date, Math.round(n.awakeMin)) }
      if (n.sleepingHR?.avg) m.hr.set(n.date, n.sleepingHR.avg)
      const sp = (n.overnight?.spo2 || []).map((p) => p[1])
      if (sp.length) m.spo2.set(n.date, Math.min(...sp))
    }
    for (const r of model.daily) {
      if (r.hrvOvernight != null) m.hrv.set(r.date, Math.round(r.hrvOvernight))
      if (r.respRate != null) m.resp.set(r.date, Math.round(r.respRate * 10) / 10)
      if (r.wristTemp != null) m.temp.set(r.date, Math.round(r.wristTemp * 100) / 100)
    }
    return m
  }, [model])
}

export const METRICS = [
  { key: 'asleep', label: 'Time asleep', unit: 'min', dp: 0, dir: 'up', chipUnit: 'min', fmt: (v) => compactHm(v), chart: { unit: 'h', scale: 1 / 60, dp: 1, metric: 'sleep' } },
  { key: 'deep', label: 'Deep', unit: 'min', dp: 0, dir: 'up', chipUnit: 'min', chart: { metric: 'deepSleep' } },
  { key: 'rem', label: 'REM', unit: 'min', dp: 0, dir: 'up', chipUnit: 'min', chart: { metric: 'remSleep' } },
  { key: 'awake', label: 'Awake time', unit: 'min', dp: 0, dir: 'down', chipUnit: 'min', chart: { metric: 'awake' } },
  { key: 'hr', label: 'Sleeping HR', unit: 'bpm', dp: 0, dir: 'down', chipUnit: '', chart: { metric: 'sleepHR' } },
  { key: 'hrv', label: 'HRV overnight', unit: 'ms', dp: 0, dir: 'up', chipUnit: '', chart: { metric: 'hrv', chartType: 'sleepHrv' } },
  { key: 'resp', label: 'Breathing rate', unit: '/min', dp: 1, dir: null, chipUnit: '', chart: { metric: 'respiratory' } },
  { key: 'spo2', label: 'SpO2 low', unit: '%', dp: 0, dir: 'up', chipUnit: '', chart: { metric: 'spo2' } },
  { key: 'temp', label: 'Wrist temp', unit: '°C', dp: 2, dir: null, chipUnit: '°', fmt: (v) => Number(v).toFixed(1), chart: { metric: 'wristTemp', dp: 2 } },
]

export function VsNormal({ model, date, onOpen }) {
  const series = useMetricSeries(model)
  const rows = useMemo(() => {
    const out = vsNormal(METRICS.map((m) => ({ ...m, series: series[m.key] })), date, counts(model))
    // time asleep is judged against your need, the other rows against your normal
    return out.map((r) => (r.key !== 'asleep' || r.value == null ? r : { ...r, ...asleepVsNeed(r.value, model.needH) }))
  }, [series, date, model])
  const shown = rows.filter((r) => r.value != null || r.n > 0)
  const better = rows.filter((r) => r.tone === 'better').length
  const worse = rows.filter((r) => r.tone === 'worse').length
  const answer = !shown.some((r) => r.lo != null) ? 'Your normal fills in after 7 nights.'
    : better === 0 && worse === 0 ? 'Every measure inside your normal range.'
      : `${better ? `${better} better than usual` : ''}${better && worse ? ', ' : ''}${worse ? `${worse} worse than usual` : ''}, the rest inside your normal.`
  return (
    <Section icon={Sparkles} title="Last night vs your normal" testid="vs-normal"
      info={<><p>The soft band is your normal: the middle 80% of the 28 nights before (10th to 90th percentile), from your chosen sleep source.</p><p>The dot is last night: green when it is outside your normal the better way, amber the other way, grey inside it or for measures with no better side (breathing rate, wrist temperature). The chip is the change from your median. Tap a row for its last 30 nights.</p></>}>
      <div className="card px-4 py-2">
        <AnswerLine className="py-1" testid="vs-normal-answer">{answer}</AnswerLine>
        <div className="rows">
          {shown.map((r) => {
            const m = METRICS.find((x) => x.key === r.key)
            return <RangeRow key={r.key} row={r} format={m.fmt} chipUnit={m.chipUnit} chipText={r.chipText} onOpen={() => onOpen(r.key)}
              extra={r.key === 'asleep' ? { value: model.needH * 60, label: `Your ${model.needH} h need` } : null} />
          })}
        </div>
      </div>
    </Section>
  )
}

// ------------------------------------------------------------------ stages

export function StagesCard({ model, night, date, onDetail }) {
  const recent = useMemo(() => nightsEnding(model.nightBy, date, SLEEP_VIEW.averageNights).filter((n) => !n.fallback), [model, date])
  const stats = stageStats(night, recent)
  return (
    <Section icon={Layers} title="Stages" testid="stages-card"
      info={<p>Apple Watch estimates stages from movement and heart rate: more useful as a trend than for one night. The marker under each is your usual share over the last 30 nights with stages. Every minute is counted once, even where Health holds overlapping records.</p>}>
      <div className="card p-4">
        {night.hasStages ? <StagesBar stats={stats} /> : <p className="text-sm font-medium" style={soft}>No stages from {night.sourceName || 'this source'} for this night.</p>}
      </div>
      <RowLink title="See the night in detail" sub="Stages, heart rate, HRV, SpO2 and breathing on one clock, and what happened" onClick={onDetail} testid="open-detail" icon={Moon} />
    </Section>
  )
}

// ------------------------------------------------------ what shaped it

const MIN_LATE_USE = 15

export function ShapedCard({ lab, date }) {
  const saunaSessions = useStore((s) => s.saunaSessions)
  const { result } = useSleepAnalysis(lab)
  const feature = lab.featureBy.get(date)
  const input = lab.inputs.get(date)
  const evening = addDays(date, -1)
  const chips = useMemo(() => {
    const extra = []
    const night = lab.model.nightBy.get(date)
    if (night) {
      const before = liteNights(lab.model, addDays(date, -14), addDays(date, -1)).map((n) => n.bedFromNoon)
      const b = bedtimeVsUsual(clockFromNoon(night.start, tz), before)
      if (b.diff != null) extra.push({ key: 'bedtime', label: `Bedtime ${clockOf(clockFromNoon(night.start, tz))}`, detail: Math.abs(b.diff) <= 30 ? 'About your usual' : `${Math.abs(b.diff)} min ${b.diff > 0 ? 'later' : 'earlier'} than usual` })
    }
    if (input?.lateUseMin >= MIN_LATE_USE) extra.push({ key: 'habit:screen-bed', label: 'Late screen use', detail: `${input.lateUseMin} min after bedtime` })
    if (input?.audio?.minutesInBed >= 5) extra.push({ key: 'sleepAudio', label: 'Headphone audio', detail: `${Math.round(input.audio.minutesInBed)} min in bed` })
    const list = shapedChips(feature, (k) => factorName(k, lab.names), extra)
    return list.map((c) => {
      if (c.key !== 'sauna') return c
      const ss = (saunaSessions || []).filter((x) => x.date === evening)
      return { ...c, detail: ss.length ? ss.map((x) => `${x.start || ''}${x.start ? ', ' : ''}${x.lengthMin} min`).join(' and ') : c.detail }
    })
  }, [feature, input, lab, date, evening, saunaSessions])
  const comparisons = result?.factors?.comparisons || []
  return (
    <Section icon={CalendarRange} title="What shaped last night" testid="shaped"
      info={<p>Everything logged or detected for that day and evening. Under each, what the Sleep Lab found across your nights, once there are 7 nights with it and 7 without. These are associations, not causes.</p>}>
      <div className="card px-4 py-2">
        {!chips.length && <p className="py-2 text-sm font-medium" style={soft} data-testid="shaped-none">Nothing logged for that evening. Log your evening to see what goes with your nights.</p>}
        <div className="rows">
          {chips.map((c) => {
            const lab2 = c.key === 'bedtime' ? null : labLine(c.key, c.label.replace(/ dose$/, ''), comparisons, OUTCOME_BY_KEY)
            return (
              <div key={c.key} className="py-2.5" data-testid={`shaped-${c.key}`}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="rounded-full px-2.5 py-1 text-[13px] font-semibold" style={{ background: 'var(--surface-sunk)' }}>{c.label}</span>
                  {c.detail && <span className="text-[13px] font-medium tabular-nums" style={soft}>{c.detail}</span>}
                </div>
                {lab2 && <p className="mt-1 text-[13px] font-medium" style={lab2.enough ? soft : muted} data-testid="shaped-lab">{lab2.text === NOT_ENOUGH ? `${NOT_ENOUGH}.` : `${lab2.text}.`}</p>}
              </div>
            )
          })}
        </div>
      </div>
    </Section>
  )
}

// ------------------------------------------------------- last 14 nights

export function Last14({ model, t }) {
  const nights = useMemo(() => liteNights(model, addDays(t, -13), t), [model, t])
  const need = needBars(nights, model.needH)
  const win = windowStats(nights)
  return (
    <Section icon={CalendarRange} title="Last 14 nights" testid="last14">
      <div className="card p-4"><NeedBarsChart bars={need.bars} needH={model.needH} answer={need.answer} /></div>
      <div className="card p-4"><WindowChart nights={nights} answer={win.answer} /></div>
    </Section>
  )
}

// ----------------------------------------------------------------- debt

export function DebtCard({ model, t }) {
  const v = debtView(model.debtH(t), model.debtH(addDays(t, -1)), model.needH)
  const Arrow = v.trend === 'up' ? ArrowUp : v.trend === 'down' ? ArrowDown : Minus
  return (
    <Section icon={BedDouble} title="Sleep debt" testid="debt"
      info={<p>Hours short of your {model.needH} h need, added up over the last 7 nights. Nights over your need do not pay it back here, and a night with no record is left out. The arrow compares with yesterday.</p>}>
      <div className="card p-4">
        <div className="flex items-baseline gap-2">
          <p className="text-[40px] font-extrabold leading-none tabular-nums" data-testid="debt-value">{v.value}<span className="ml-1 text-[15px] font-semibold" style={muted}>h</span></p>
          <span className="flex items-center gap-1 text-[13px] font-semibold" style={{ color: v.trend === 'up' ? 'var(--amber)' : v.trend === 'down' ? 'var(--accent)' : 'var(--text-3)' }} data-testid="debt-trend" data-trend={v.trend}>
            <Arrow size={14} />{v.trend === 'up' ? 'up since yesterday' : v.trend === 'down' ? 'down since yesterday' : 'same as yesterday'}
          </span>
        </div>
        <p className="mt-2 text-sm font-medium" style={soft} data-testid="debt-text">{v.text}</p>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------- tonight

/** Factor keys for what is logged today (tonight's night). */
function todayKeys(state, t) {
  const keys = new Set()
  for (const [id, on] of Object.entries(state.habitLogs?.[t] || {})) if (on === true) keys.add(`habit:${id}`)
  if ((state.eveningDetails?.[t]?.drinks || 0) > 0) keys.add('habit:alcohol')
  for (const l of state.asNeededLogs || []) if (String(l.at || '').slice(0, 10) === t) keys.add(`asNeeded:${l.itemId}`)
  for (const l of state.supplementLogs || []) if (l.date === t) keys.add(`supp:${l.supplementId || l.id}`)
  for (const l of state.doseLogs || []) if (l.date === t) keys.add(`dose:${l.peptideId}`)
  if ((state.saunaSessions || []).some((x) => x.date === t)) keys.add('sauna')
  return keys
}

export function TonightCard({ model, lab, onLogEvening }) {
  const t = todayStr()
  const settings = useStore((s) => s.healthSettings)
  const habitLogs = useStore((s) => s.habitLogs)
  const eveningDetails = useStore((s) => s.eveningDetails)
  const asNeededLogs = useStore((s) => s.asNeededLogs)
  const supplementLogs = useStore((s) => s.supplementLogs)
  const doseLogs = useStore((s) => s.doseLogs)
  const saunaSessions = useStore((s) => s.saunaSessions)
  const state = { habitLogs, eveningDetails, asNeededLogs, supplementLogs, doseLogs, saunaSessions }
  const { result } = useSleepAnalysis(lab)
  const plan = planBedtime({
    recent: nightsEnding(model.nightBy, t, 14), debtH: model.debtH(t), needH: model.needH,
    yesterdayLoad: model.loadVsUsual(addDays(t, -1)).label, wakeTarget: settings.wakeTarget, tz,
  })
  const keys = todayKeys(state, t)
  const worse = (result?.hurts || []).find((r) => keys.has(r.factor))
  return (
    <Section icon={Moon} title="Tonight" testid="tonight"
      info={<p>The planner adds this week's debt and a higher-load day to your need, allows for your usual time awake in bed, and counts back from your wake time.</p>}>
      <div className="card p-4">
        <p className="text-[17px] font-semibold tabular-nums" data-testid="tonight-bedtime">In bed by {plan.bedtime} to wake at {plan.wake}</p>
        <p className="mt-1 text-sm font-medium tabular-nums" style={soft}>Start winding down at {windDownAt(plan.bedtime)}. {hm(plan.inputs.needMin)} of sleep{plan.inputs.debtAddMin ? `, with ${plan.inputs.debtAddMin} min for this week's debt` : ''}.</p>
        {worse && (
          <p className="mt-2 text-sm font-medium" style={{ color: 'var(--amber)' }} data-testid="tonight-worse">
            {factorName(worse.factor, lab.names)} is logged today. On your nights with it, {OUTCOME_BY_KEY[worse.outcome]?.label.toLowerCase()} {noCi(worse.short)}, {worse.n} nights.
          </p>
        )}
        <button type="button" onClick={onLogEvening} className="mt-3 flex min-h-[40px] w-full items-center justify-center rounded-full text-sm font-bold" style={{ background: 'var(--surface-sunk)' }} data-testid="log-habits">
          Log this evening
        </button>
      </div>
    </Section>
  )
}

// -------------------------------------------------------------- lab teaser

export function LabTeaser({ lab, onOpen, onOpenView }) {
  const { result } = useSleepAnalysis(lab)
  const helps = (result?.helps || []).slice(0, 2)
  const hurts = (result?.hurts || []).slice(0, 2)
  const card = (r, good) => (
    <button key={`${r.factor}${r.outcome}`} type="button" onClick={onOpen} className="card min-w-0 p-3 text-left" data-testid={good ? 'teaser-better' : 'teaser-worse'}>
      <p className="truncate text-[15px] font-semibold">{factorName(r.factor, lab.names)}</p>
      <p className="mt-0.5 text-[13px] font-medium" style={{ color: good ? 'var(--accent)' : 'var(--amber)' }}>{OUTCOME_BY_KEY[r.outcome]?.label} {noCi(r.short)}</p>
      <p className="text-[13px] font-medium tabular-nums" style={muted}>{r.n} nights</p>
    </button>
  )
  return (
    <Section icon={FlaskConical} title="Sleep Lab" testid="lab-teaser"
      info={<p>Patterns across your own nights. Only differences whose interval stays clear of zero are shown here. Associations, not causes.</p>}>
      {helps.length || hurts.length ? (
        <>
          {helps.length > 0 && <p className="px-1 text-[13px] font-semibold" style={muted}>Goes with better sleep</p>}
          {helps.length > 0 && <div className="grid grid-cols-2 gap-2">{helps.map((r) => card(r, true))}</div>}
          {hurts.length > 0 && <p className="px-1 text-[13px] font-semibold" style={muted}>Goes with worse sleep</p>}
          {hurts.length > 0 && <div className="grid grid-cols-2 gap-2">{hurts.map((r) => card(r, false))}</div>}
        </>
      ) : (
        <p className="card p-4 text-sm font-medium" style={soft} data-testid="teaser-empty">No clear patterns yet. They appear once a factor has 7 nights with it and 7 without.</p>
      )}
      <div className="card rows p-0">
        {[['analysis', 'Open Sleep Lab', 'Everything that goes with better and worse nights'], ['apnea', 'Apnea screen', 'Breathing signals overnight'], ['nightmares', 'Nightmares', 'Estimated from heart rate'], ['restless', 'Restless nights', 'Wake-ups and heart rate spikes']].map(([id, title, sub]) => (
          <button key={id} type="button" onClick={() => onOpenView(id)} className="flex w-full items-center gap-3 px-4 py-3 text-left" data-testid={`lab-open-${id}`}>
            <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{title}</span><span className="block truncate text-[13px] font-medium" style={soft}>{sub}</span></span>
            <ChevronRight size={16} style={muted} />
          </button>
        ))}
      </div>
    </Section>
  )
}

// ------------------------------------------------------------- back header

export function Back({ title, onBack }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={onBack} className="flex items-center gap-1 rounded-full px-2 py-1.5 text-sm font-bold" style={soft} data-testid="sleep-back"><ChevronLeft size={16} /> Sleep</button>
      <h2 className="min-w-0 flex-1 truncate text-right text-[17px] font-semibold">{title}</h2>
    </div>
  )
}

// ---------------------------------------------------------- metric chart

/** A row of Last night vs your normal, over its last 30 nights. */
export function MetricScreen({ model, metricKey, onBack }) {
  const series = useMetricSeries(model)
  const events = useChartEvents()
  const t = todayStr()
  const m = METRICS.find((x) => x.key === metricKey)
  const scale = m.chart.scale || 1
  const pts = [...series[metricKey].entries()].filter(([d]) => counts(model)(d)).map(([date, value]) => ({ date, value: value * scale })).sort((a, b) => a.date.localeCompare(b.date))
  const unit = m.chart.unit || m.unit
  const dp = m.chart.dp ?? m.dp
  return (
    <div className="space-y-3" data-testid="metric-screen">
      <Back title={m.label} onBack={onBack} />
      <TrendChart metric={m.chart.metric} chartType={m.chart.chartType || m.chart.metric} title={m.label} unit={unit} dp={dp} series={pts} events={events}
        window={{ from: addDays(t, -29), to: t }} answer={trendAnswer(m.label, pts, unit, dp, 30, t)} answerTone={trendTone(trendDiff(pts, 30, t, dp), m.dir)} better={m.dir || undefined}
        second={metricKey === 'asleep' ? { label: `Your ${model.needH} h need`, dots: false, series: dateRange(addDays(t, -29), t).map((date) => ({ date, value: model.needH })) } : null} />
    </div>
  )
}

// ---------------------------------------------------------------- trends

const RANGES = [7, 30, 90]

/** Sleep › Trends: 7, 30 and 90 nights for the measures that matter, each with its answer line. */
export function TrendsScreen({ model, onBack }) {
  const [days, setDays] = useState(30)
  const events = useChartEvents()
  const series = useMetricSeries(model)
  const t = todayStr()
  const ok = counts(model)
  const pts = (map, scale = 1) => [...map.entries()].filter(([d]) => ok(d)).map(([date, value]) => ({ date, value: value * scale })).sort((a, b) => a.date.localeCompare(b.date))
  const s = useMemo(() => {
    const nights = [...model.nightBy.values()].filter((n) => !n.fallback).sort((a, b) => a.date.localeCompare(b.date))
    return {
      score: nights.map((n) => ({ date: n.date, value: model.sleepScore(n.date)?.score })).filter((p) => p.value != null),
      // consistency: how much bed and wake times varied over the 7 nights ending each night
      spread: nights.map((n) => ({ date: n.date, value: consistencySd(nightsEnding(model.nightBy, n.date, 7).filter((x) => !x.fallback), tz) })).filter((p) => p.value != null).map((p) => ({ ...p, value: Math.round(p.value) })),
    }
  }, [model])
  const win = { from: addDays(t, -(days - 1)), to: t }
  const charts = [
    { key: 'asleep', title: 'Time asleep', metric: 'sleep', unit: 'h', dp: 1, data: pts(series.asleep, 1 / 60), better: 'up', need: true },
    { key: 'deep', title: 'Deep sleep', metric: 'deepSleep', unit: 'min', dp: 0, data: pts(series.deep), better: 'up' },
    { key: 'rem', title: 'REM sleep', metric: 'remSleep', unit: 'min', dp: 0, data: pts(series.rem), better: 'up' },
    { key: 'hr', title: 'Sleeping heart rate', metric: 'sleepHR', unit: 'bpm', dp: 0, data: pts(series.hr), better: 'down' },
    { key: 'hrv', title: 'Overnight HRV', metric: 'hrv', chartType: 'sleepHrv', unit: 'ms', dp: 0, data: pts(series.hrv), better: 'up' },
    { key: 'spread', title: 'Bedtime spread', metric: 'bedtimeSpread', unit: 'min', dp: 0, data: s.spread, better: 'down', question: 'Is my bedtime getting steadier?' },
    { key: 'score', title: 'Sleep score', metric: 'sleepScore', unit: '', dp: 0, data: s.score, better: 'up' },
  ]
  return (
    <div className="space-y-3" data-testid="sleep-trends-screen">
      <Back title="Trends" onBack={onBack} />
      <div className="flex gap-1 rounded-full p-1" style={{ background: 'var(--surface-sunk)' }} role="tablist">
        {RANGES.map((n) => (
          <button key={n} role="tab" aria-selected={days === n} onClick={() => setDays(n)} data-testid={`trends-${n}`}
            className="min-h-[34px] flex-1 rounded-full text-xs font-bold tabular-nums" style={days === n ? { background: 'var(--surface2)', color: 'var(--text)' } : muted}>{n} nights</button>
        ))}
      </div>
      {charts.map((c) => (
        <TrendChart key={`${c.key}-${days}`} metric={c.metric} chartType={c.chartType || c.metric} title={c.title} unit={c.unit} dp={c.dp} series={c.data} events={events}
          window={win} better={c.better} question={c.question} testid={`trend-${c.key}`}
          answer={trendAnswer(c.title, c.data, c.unit, c.dp, days, t)}
          answerTone={trendTone(trendDiff(c.data, days, t, c.dp), c.better)}
          second={c.need ? { label: `Your ${model.needH} h need`, dots: false, series: dateRange(win.from, win.to).map((date) => ({ date, value: model.needH })) } : null} />
      ))}
    </div>
  )
}

// -------------------------------------------------------- check the numbers

export function CheckNumbers({ model }) {
  const rows = useMemo(() => stageCheck([...model.nightBy.values()], 7), [model])
  if (!rows.length) return null
  const fixed = rows.filter((r) => r.fixed).length
  return (
    <section className="card p-4" data-testid="check-numbers">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[17px] font-semibold">Check the numbers</p>
        <InfoButton title="Check the numbers">
          <p>Each night's stages are counted from one timeline, so minutes that Health holds twice (two records for the same stretch, or a night written again) count once. Before is each stage added up on its own, as earlier versions did.</p>
          <p>To compare, open the Health app, Browse, Sleep, Show More Sleep Data, and pick the same source.</p>
        </InfoButton>
      </div>
      <p className="mt-1 text-sm font-medium" style={soft}>{fixed ? `${fixed} of the last ${rows.length} nights had overlapping records, now counted once.` : `No overlapping records in the last ${rows.length} nights.`}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[13px] font-medium tabular-nums" data-testid="check-table">
          <thead><tr style={muted}><th className="py-1 text-left font-semibold">Night</th><th className="text-right font-semibold">REM</th><th className="text-right font-semibold">Core</th><th className="text-right font-semibold">Deep</th><th className="text-right font-semibold">Awake</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} data-testid="check-row" data-fixed={r.fixed ? 'true' : 'false'}>
                <td className="py-1" style={soft}>{short(r.date)}</td>
                {['rem', 'core', 'deep', 'awake'].map((k) => (
                  <td key={k} className="text-right">
                    {r.before && r.before[k] !== r.after[k] ? <><span style={muted}><s>{hmCheck(r.before[k])}</s></span><br /></> : null}
                    {hmCheck(r.after[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

