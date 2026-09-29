import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CalendarClock, TrendingUp, Pencil, Plus, Trash2, Info, SkipForward,
  ArrowUpRight, Minus, PauseCircle, Route, CircleDot, HelpCircle, ChevronRight,
  CalendarArrowDown,
} from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import PauseHistory from './PauseHistory'
import Modal from './ui/Modal'
import NumberField from './ui/NumberField'
import { format, parseISO } from 'date-fns'
import { prettyDate, daysBetween, addDaysStr, currentRung } from '../lib/schedule'
import { formatDose, toMg, fromMg } from '../lib/calc'
import { effectiveUsdPerVial, fxRate, money } from '../lib/cost'
import {
  tenureFor, onVsOff, cyclePosition, doseTimeline, cumulativeExposure,
  milestonesFor, reassessPrompt, durationWords, doseTenure,
} from '../lib/tenure'
import { displayName } from '../lib/naming'

/**
 * How long, on what, and what changed.
 *
 * All of this is derived from `startedOn`, the run list and the dose-event log —
 * never from the dose logs alone. Someone who ran a compound for eight months
 * before installing this app has eight months of tenure and two weeks of logs,
 * and the screen has to be able to say both without one contaminating the other.
 * Everything typed in from memory is drawn and labelled as estimated.
 */

const FREQ_LABELS = {
  daily: 'Daily', nightly: 'Nightly', weekly: 'Weekly',
  '2xweek': '2×/week', '3xweek': '3×/week', '5on2off': '5 on / 2 off',
}

const POINT_ICON = {
  prior: HelpCircle,
  start: CircleDot,
  'step-up': ArrowUpRight,
  hold: PauseCircle,
  override: Pencil,
  route: Route,
  stop: Minus,
  gap: CalendarClock,
  skip: SkipForward,
  push: CalendarArrowDown,
}

// Only status carries colour. Everything else is chrome.
const POINT_TONE = {
  'step-up': 'var(--good)',
  stop: 'var(--danger)',
  gap: 'var(--warn)',
  skip: 'var(--warn)',
  push: 'var(--text-2)',
}

function toneFor(kind) {
  return POINT_TONE[kind] || 'var(--text-2)'
}

// ------------------------------------------------------------------ tenure

function Stat({ label, value, sub, tone }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="t-caption" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className="mt-0.5 text-sm font-black tabular-nums leading-tight" style={{ color: tone || 'var(--text)' }}>
        {value}
      </p>
      {sub && (
        <p className="text-xs font-medium tabular-nums leading-tight" style={{ color: 'var(--text-2)' }}>{sub}</p>
      )}
    </div>
  )
}

/**
 * Time on this compound, in the units a person would use out loud.
 *
 * Current run and lifetime are shown side by side rather than reconciled,
 * because "six weeks back on it" and "nine months of my life" are both true and
 * neither is the answer to the other's question.
 */
export function TenureBlock({ peptide, onEdit }) {
  const runs = useStore((s) => s.runs)
  const titration = useStore((s) => s.titration)
  const pauses = useStore((s) => s.pauses)
  const t = todayStr()

  const tenure = useMemo(() => tenureFor(peptide, { runs, pauses, todayStr: t }), [peptide, runs, t, pauses])
  if (!peptide || !tenure) return null

  const cycle = cyclePosition(peptide, t)
  const onOff = onVsOff(peptide, { todayStr: t })
  const miles = milestonesFor(tenure.currentDays)
  const reassess = reassessPrompt(peptide, { tenure, titration, todayStr: t })
  const multi = tenure.runCount > 1

  return (
    <div className="space-y-2" data-testid="tenure-block">
      <div className="card p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="t-caption" style={{ color: 'var(--text-2)' }}>Time on compound</p>
          {onEdit && (
            <button onClick={onEdit} data-testid="tenure-edit"
              className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-black"
              style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              <Pencil size={11} /> Since
            </button>
          )}
        </div>
        <p className="t-metric mt-1" data-testid="tenure-headline">
          {tenure.running
            ? (tenure.currentDays === 0 ? 'Started today' : tenure.currentWords)
            : `${tenure.lifetimeWords} — not running`}
        </p>
        <p className="mt-0.5 text-xs font-semibold tabular-nums" style={{ color: 'var(--text-2)' }}>
          Since {prettyDate(tenure.startedOn)}
          {multi && ` · ${tenure.runCount} separate runs`}
        </p>
        {/* The run kept running through the break — you did not come off it —
            so the days off are said beside the figure rather than taken out of
            it, and the reader can decide which number they wanted. */}
        {tenure.pausedWords && (
          <p className="mt-0.5 text-xs font-semibold tabular-nums" data-testid="tenure-paused"
            style={{ color: 'var(--text-3)' }}>
            {tenure.pausedWords} in that time
          </p>
        )}

        <div className="mt-3 flex gap-3">
          {multi && <Stat label="Lifetime" value={tenure.lifetimeWords} sub={`longest ${tenure.longestRunWords}`} />}
          {cycle?.cycled && (
            <Stat label="Cycle" value={cycle.words}
              sub={cycle.nextChange ? `${cycle.phase === 'on' ? 'rests' : 'back on'} ${prettyDate(cycle.nextChange)}` : null}
              tone={cycle.phase === 'rest' ? 'var(--text-2)' : undefined} />
          )}
          {onOff?.cycled && onOff.words && <Stat label="On vs off" value={onOff.words} />}
          {!multi && !cycle?.cycled && (
            <Stat label="Next marker" value={miles.next ? miles.next.label : 'all passed'}
              sub={miles.next ? `in ${miles.next.inDays} days` : null} />
          )}
        </div>
      </div>

      {miles.today && (
        <p className="flex items-center gap-2 px-1 text-xs font-bold" data-testid="milestone-today"
          style={{ color: 'var(--good)' }}>
          <TrendingUp size={12} /> {miles.today.label} on {peptide.name} today.
        </p>
      )}

      {reassess && (
        <div className="card p-3" data-testid="reassess-prompt">
          <p className="flex items-start gap-2 text-xs font-bold leading-relaxed">
            <Info size={13} className="mt-px shrink-0" style={{ color: 'var(--text-2)' }} />
            <span>{reassess.text}</span>
          </p>
          <p className="mt-1 pl-5 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
            A note about elapsed time, nothing more — this app has no opinion on what you should do next.
          </p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- timeline

// Taller and wider-padded than it was: the dose labels sit on the steps and the
// dates sit under them, and both need room to be read rather than squinted at.
const CH = { w: 320, h: 168, padL: 8, padR: 8, padT: 26, padB: 30 }

/**
 * The dose, over the whole time you have been on it.
 *
 * Only drawn when there is something to draw. A compound whose dose has never
 * moved produces a perfectly flat line, which is a chart in the sense that it
 * has axes and no other sense — it takes a third of the screen to say one
 * sentence. So that case says the sentence instead, and the plot is kept for
 * the compounds where the shape is the point.
 *
 * Where it does draw: a step line, because a dose does not drift, it sits at
 * one number until the day it is changed. Each step carries its own dose and
 * the date it started. Estimated segments are dashed and off-cycle stretches
 * shaded behind, so the two things the eye should discount are the two drawn
 * most faintly. Skips are not on it — they are events in the log below, not
 * levels of a dose, and scattering them along the baseline made the one line
 * that matters harder to follow.
 */
export function DoseTimelineChart({ peptide }) {
  const doseEvents = useStore((s) => s.doseEvents)
  const doseLogs = useStore((s) => s.doseLogs)
  const skips = useStore((s) => s.skips)
  const pushes = useStore((s) => s.pushes)
  const runs = useStore((s) => s.runs)
  const titration = useStore((s) => s.titration)
  const pauses = useStore((s) => s.pauses)
  const t = todayStr()
  const [picked, setPicked] = useState(null)

  const tl = useMemo(
    () => doseTimeline(peptide, { doseEvents, doseLogs, skips, pushes, pauses, runs, titration, todayStr: t }),
    [peptide, doseEvents, doseLogs, skips, pushes, runs, titration, t, pauses]
  )
  const atDose = useMemo(
    () => doseTenure(peptide, { doseEvents, titration, pauses, todayStr: t }),
    [peptide, doseEvents, titration, t, pauses]
  )

  // Distinct dose levels, in the unit the compound is dosed in. One level means
  // one sentence; two or more mean a chart.
  const levels = useMemo(() => {
    const seen = []
    for (const seg of tl.segments) {
      const mg = toMg(seg.dose, seg.unit)
      if (!seen.some((v) => Math.abs(v - mg) < 1e-9)) seen.push(mg)
    }
    return seen
  }, [tl])

  const geom = useMemo(() => {
    if (levels.length < 2) return null
    const dates = [...tl.segments.map((s) => s.from), peptide?.startedOn].filter(Boolean)
    const from = dates.reduce((a, b) => (a < b ? a : b))
    const totalDays = Math.max(1, daysBetween(from, t))
    const maxMg = Math.max(...levels)
    const plot = CH.h - CH.padT - CH.padB
    const x = (d) => CH.padL + (Math.min(Math.max(daysBetween(from, d), 0), totalDays) / totalDays) * (CH.w - CH.padL - CH.padR)
    const y = (mg) => CH.h - CH.padB - Math.min(mg / (maxMg * 1.1), 1) * plot
    return { from, totalDays, maxMg, x, y, base: CH.h - CH.padB }
  }, [levels, tl, peptide, t])

  if (!peptide) return null

  // Nothing recorded at all — not even a starting dose.
  if (!tl.segments.length) {
    return (
      <div className="card p-4" data-testid="dose-timeline-empty">
        <p className="t-caption" style={{ color: 'var(--text-2)' }}>Dose history</p>
        <p className="mt-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Nothing recorded yet. Every step-up, hold and hand-set dose lands here with its date, and you can
          type in what you were on before you started logging.
        </p>
      </div>
    )
  }

  // One dose, throughout. A sentence, not a plot.
  if (!geom) {
    const only = tl.segments[0]
    return (
      <div className="card p-4" data-testid="dose-steady">
        <p className="t-caption" style={{ color: 'var(--text-2)' }}>Dose history</p>
        <p className="t-metric mt-1 tabular-nums">{formatDose(only.dose, only.unit || peptide.ladder?.unit)}</p>
        <p className="mt-1 text-sm font-bold tabular-nums" style={{ color: 'var(--text-2)' }}>
          {atDose?.days ? `${durationWords(atDose.days)} at this dose` : 'set today'}
        </p>
        <p className="mt-0.5 text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
          Since {prettyDate(only.from)} · no dose changes
          {only.estimated ? ' · entered by hand' : ''}
        </p>
      </div>
    )
  }

  const { x, y, base } = geom
  const unit = peptide.ladder?.unit

  return (
    <div className="card p-3" data-testid="dose-timeline">
      <p className="t-caption" style={{ color: 'var(--text-2)' }}>Dose over time</p>

      <svg viewBox={`0 0 ${CH.w} ${CH.h}`} className="mt-2 w-full" role="img"
        aria-label={`Dose history for ${peptide.name}: ${tl.segments.map((sg) => `${sg.dose} ${sg.unit || unit || ''} from ${sg.from}`).join(', ')}`}
        style={{ overflow: 'visible' }}>
        {/* off-cycle stretches, behind everything */}
        {tl.bands.filter((b) => !b.on).map((b) => (
          <rect key={`${b.from}-${b.to}`} x={x(b.from)} y={CH.padT} width={Math.max(1, x(b.to) - x(b.from))}
            height={base - CH.padT} fill="var(--text-3)" opacity="0.12" />
        ))}

        {/* Stretches the protocol was stopped, with the reason on them. Hatched
            rather than merely shaded so they cannot be mistaken for an off-cycle
            band, which is the one thing next to them that looks similar and
            means something else entirely. */}
        <defs>
          <pattern id="pause-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--warn)" opacity="0.10" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--warn)" strokeWidth="1.5" opacity="0.30" />
          </pattern>
        </defs>
        {tl.pauses.map((b) => (
          <g key={`pause-${b.from}-${b.to}`} data-testid="timeline-pause" data-reason={b.reason}>
            <rect x={x(b.from)} y={CH.padT} width={Math.max(2, x(b.to) - x(b.from))}
              height={base - CH.padT} fill="url(#pause-hatch)" />
            <text x={x(b.from) + 2} y={CH.padT + 9} fontSize="8" fontWeight="800" fill="var(--warn)">
              {b.reason}
            </text>
          </g>
        ))}

        {/* one gridline per dose level, labelled with the dose itself — the
            axis values are the doses, which are the only numbers anyone is
            reading off this */}
        {levels.map((mg) => (
          <g key={mg}>
            <line x1={CH.padL} y1={y(mg)} x2={CH.w - CH.padR} y2={y(mg)}
              stroke="var(--border)" strokeWidth="1" strokeDasharray="2 4" />
            <text x={CH.padL} y={y(mg) - 5} fontSize="10" fontWeight="800"
              fill="var(--text-3)" className="tabular-nums">
              {formatDose(fromMg(mg, unit === 'spray' ? 'mg' : unit), unit === 'spray' ? 'mg' : unit)}
            </text>
          </g>
        ))}

        <line x1={CH.padL} y1={base} x2={CH.w - CH.padR} y2={base} stroke="var(--border)" strokeWidth="1" />

        {/* the step line: one flat run per dose, with a riser between */}
        {tl.segments.map((sg, i) => {
          const prev = tl.segments[i - 1]
          const yy = y(toMg(sg.dose, sg.unit))
          return (
            <g key={`${sg.from}-${i}`}>
              {prev && (
                <line x1={x(sg.from)} y1={y(toMg(prev.dose, prev.unit))} x2={x(sg.from)} y2={yy}
                  stroke="var(--text-2)" strokeWidth="1.5" strokeDasharray={sg.estimated ? '3 3' : undefined} />
              )}
              <line x1={x(sg.from)} y1={yy} x2={x(sg.to)} y2={yy}
                stroke={sg.estimated ? 'var(--text-3)' : 'var(--good)'} strokeWidth="3"
                strokeLinecap="round" strokeDasharray={sg.estimated ? '4 3' : undefined} />
            </g>
          )
        })}

        {/* the date each step started, under the step it belongs to */}
        {tl.segments.map((sg, i) => {
          if (i === 0 && tl.segments.length > 3) return null
          const px = x(sg.from)
          const anchor = px < 30 ? 'start' : px > CH.w - 34 ? 'end' : 'middle'
          return (
            <text key={`d-${sg.from}-${i}`} x={px} y={CH.h - 14} fontSize="9" fontWeight="700"
              textAnchor={anchor} fill="var(--text-3)" className="tabular-nums">
              {format(parseISO(sg.from), 'd MMM')}
            </text>
          )
        })}

        {/* Only dose changes are marked. A skip is not a dose level, and
            dotting them along the baseline buried the line that is. */}
        {tl.points.filter((pt) => pt.to != null).map((pt) => {
          const on = picked?.id === pt.id
          const cy = y(toMg(pt.to, pt.unit))
          return (
            <g key={pt.id} onClick={() => setPicked(on ? null : pt)} style={{ cursor: 'pointer' }}>
              <circle cx={x(pt.date)} cy={cy} r="12" fill="transparent" />
              <circle cx={x(pt.date)} cy={cy} r={on ? 5.5 : 4}
                fill={pt.estimated ? 'var(--surface-solid)' : toneFor(pt.kind)}
                stroke={pt.estimated ? 'var(--text-3)' : 'var(--surface-solid)'} strokeWidth="1.5" />
            </g>
          )
        })}

        <text x={CH.w - CH.padR} y={CH.h - 2} fontSize="9" fontWeight="700"
          fill="var(--text-3)" textAnchor="end" className="tabular-nums">
          today
        </text>
      </svg>

      <AnimatePresence initial={false}>
        {picked && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden" data-testid="timeline-detail">
            <PointDetail pt={picked} unit={peptide.ladder?.unit} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* One series needs no legend saying which one it is. What is left is the
          two things drawn differently on purpose. */}
      {(tl.segments.some((sg) => sg.estimated) || tl.bands.some((b) => !b.on)) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {tl.segments.some((sg) => sg.estimated) && <Legend swatch="var(--text-3)" dashed label="estimated" />}
          {tl.bands.some((b) => !b.on) && <Legend swatch="var(--text-3)" faded label="off-cycle" />}
        </div>
      )}

    </div>
  )
}

/**
 * Every recorded event for one compound, newest first.
 *
 * Lives beside the chart rather than inside it, because a compound whose dose
 * has never moved gets no chart and still has step-ups it held, days it was
 * skipped and doses it was pushed — all of which are the record, and none of
 * which stop mattering because the line would have been flat.
 */
export function TimelineEvents({ peptide, onPick, picked }) {
  const doseEvents = useStore((s) => s.doseEvents)
  const doseLogs = useStore((s) => s.doseLogs)
  const skips = useStore((s) => s.skips)
  const pushes = useStore((s) => s.pushes)
  const runs = useStore((s) => s.runs)
  const titration = useStore((s) => s.titration)
  const pauses = useStore((s) => s.pauses)
  const t = todayStr()
  const tl = useMemo(
    () => doseTimeline(peptide, { doseEvents, doseLogs, skips, pushes, pauses, runs, titration, todayStr: t }),
    [peptide, doseEvents, doseLogs, skips, pushes, runs, titration, t, pauses]
  )
  if (!peptide || !tl.points.length) return null
  return (
    <div className="card p-3" data-testid="timeline-points">
      {[...tl.points].reverse().slice(0, 12).map((pt) => {
        const Icon = POINT_ICON[pt.kind] || CircleDot
        return (
          <button key={pt.id} onClick={() => onPick?.(picked?.id === pt.id ? null : pt)}
            data-testid="timeline-point"
            className="flex w-full items-center gap-2 rounded-[12px] px-2 py-1.5 text-left"
            style={{ background: picked?.id === pt.id ? 'var(--surface-sunk)' : 'transparent' }}>
            <Icon size={12} className="shrink-0" style={{ color: toneFor(pt.kind) }} />
            <span className="min-w-0 flex-1 truncate text-xs font-bold">
              {pt.label}
              {pt.to != null && (
                <span className="ml-1.5 font-black tabular-nums" style={{ color: 'var(--text-2)' }}>
                  {formatDose(pt.to, pt.unit || peptide.ladder?.unit)}
                </span>
              )}
              {pt.estimated && (
                <span className="ml-1.5 text-xs font-bold" style={{ color: 'var(--text-3)' }}>estimated</span>
              )}
            </span>
            <span className="shrink-0 text-xs font-semibold tabular-nums" style={{ color: 'var(--text-3)' }}>
              {prettyDate(pt.date)}
            </span>
          </button>
        )
      })}
      {tl.points.length > 12 && (
        <p className="px-2 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
          {tl.points.length - 12} earlier event{tl.points.length - 12 === 1 ? '' : 's'} before these.
        </p>
      )}

      {/* what changed, when, and why where it was recorded — under the row it
          belongs to rather than up at the chart, which may not be drawn */}
      <AnimatePresence initial={false}>
        {picked && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden" data-testid="timeline-detail">
            <PointDetail pt={picked} unit={peptide.ladder?.unit} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Legend({ swatch, label, dashed, faded }) {
  return (
    <span className="flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--text-3)' }}>
      <span className="inline-block h-0.5 w-4 rounded-full"
        style={{
          background: faded
            ? `color-mix(in srgb, ${swatch} 25%, transparent)`
            : dashed
              ? `repeating-linear-gradient(90deg, ${swatch} 0 3px, transparent 3px 6px)`
              : swatch,
          height: faded ? '8px' : undefined,
        }} />
      {label}
    </span>
  )
}

/** What changed, when, and why where it was recorded. */
function PointDetail({ pt, unit }) {
  return (
    <div className="mt-2 rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }}>
      <p className="text-xs font-black">
        {pt.label} · <span className="tabular-nums" style={{ color: 'var(--text-2)' }}>{prettyDate(pt.date)}</span>
      </p>
      {pt.from != null && pt.to != null && (
        <p className="mt-1 text-sm font-black tabular-nums">
          {formatDose(pt.from, pt.unit || unit)} → {formatDose(pt.to, pt.unit || unit)}
        </p>
      )}
      {pt.from == null && pt.to != null && (
        <p className="mt-1 text-sm font-black tabular-nums">{formatDose(pt.to, pt.unit || unit)}</p>
      )}
      {pt.frequency && (
        <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
          {FREQ_LABELS[pt.frequency] || pt.frequency}
        </p>
      )}
      {pt.detail && (
        <p className="mt-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>{pt.detail}</p>
      )}
      {pt.note && !pt.detail && (
        <p className="mt-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>{pt.note}</p>
      )}
      {pt.estimated && (
        <p className="mt-1 text-xs font-bold" style={{ color: 'var(--text-3)' }}>
          Entered by hand from memory — not a record made at the time.
        </p>
      )}
    </div>
  )
}

/**
 * The dose line, four hundred times smaller.
 *
 * For a Protocol row, where the question is only "has this been moving" and
 * there is no room to answer it in words.
 */
export function DoseSparkline({ peptide, width = 56, height = 16 }) {
  const doseEvents = useStore((s) => s.doseEvents)
  const runs = useStore((s) => s.runs)
  const pauses = useStore((s) => s.pauses)
  const t = todayStr()
  const tl = useMemo(
    () => doseTimeline(peptide, { doseEvents, runs, pauses, todayStr: t }),
    [peptide, doseEvents, runs, t, pauses]
  )
  if (!tl.segments.length) return null

  const from = tl.segments[0].from
  const total = Math.max(1, daysBetween(from, t))
  // A fortnight is the least that can look like a trend. Below it the sparkline
  // is a single dot pretending to be a line.
  if (total < 14) return null
  const mgs = tl.segments.map((s) => toMg(s.dose, s.unit))
  const max = Math.max(...mgs, 0.0001)
  const min = Math.min(...mgs)
  const x = (d) => (Math.min(Math.max(daysBetween(from, d), 0), total) / total) * (width - 2) + 1
  // flat means flat, drawn through the middle rather than along the top edge
  const y = max === min ? () => height / 2 : (mg) => height - 2 - (mg / (max * 1.12)) * (height - 4)

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0"
      data-testid="dose-sparkline" aria-hidden>
      {tl.segments.map((s, i) => {
        const prev = tl.segments[i - 1]
        const yy = y(toMg(s.dose, s.unit))
        return (
          <g key={i}>
            {prev && <line x1={x(s.from)} y1={y(toMg(prev.dose, prev.unit))} x2={x(s.from)} y2={yy}
              stroke="var(--text-3)" strokeWidth="1" />}
            <line x1={x(s.from)} y1={yy} x2={x(s.to)} y2={yy}
              stroke={s.estimated ? 'var(--text-3)' : 'var(--good)'} strokeWidth="1.5" strokeLinecap="round"
              strokeDasharray={s.estimated ? '2 2' : undefined} />
          </g>
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------- exposure

/**
 * Everything taken, with the guessed part kept visibly apart.
 *
 * The estimated figure is arithmetic on a memory — a stated dose times a stated
 * frequency across a stated stretch — so it gets its own line and its own word
 * rather than being folded into a single impressive total.
 */
export function ExposureBlock({ peptide }) {
  const doseLogs = useStore((s) => s.doseLogs)
  const vials = useStore((s) => s.vials)
  const settings = useStore((s) => s.settings)
  const runs = useStore((s) => s.runs)
  const pauses = useStore((s) => s.pauses)
  const t = todayStr()

  const e = useMemo(() => cumulativeExposure(peptide, {
    doseLogs, todayStr: t,
    usdPerVial: effectiveUsdPerVial(peptide, vials), fx: fxRate(settings),
  }), [peptide, doseLogs, vials, settings, t])
  const tenure = useMemo(() => tenureFor(peptide, { runs, pauses, todayStr: t }), [peptide, runs, t, pauses])

  if (!peptide || !e) return null
  // totals are carried in mg; a compound dosed in mcg should read in mcg
  const nativeUnit = peptide.ladder?.unit === 'spray' ? 'mg' : (peptide.ladder?.unit || 'mg')
  const show = (mg) => formatDose(fromMg(mg, nativeUnit), nativeUnit)

  return (
    <div className="card p-3" data-testid="exposure-block">
      <p className="t-caption" style={{ color: 'var(--text-2)' }}>All time</p>

      <div className="mt-2 flex gap-3">
        <Stat label="Total taken" value={show(e.totalMg)}
          sub={e.hasEstimate ? `${show(e.loggedMg)} logged · ${show(e.estimatedMg)} estimated` : 'all logged'} />
        <Stat label={e.sprays > e.injections ? 'Sprays' : 'Injections'}
          value={String(e.sprays > e.injections ? e.sprays : e.injections)}
          sub={e.hasEstimate ? `+ ~${e.estimatedDoses} before logging` : `${e.doses} logged dose${e.doses === 1 ? '' : 's'}`} />
      </div>

      <div className="mt-3 flex gap-3">
        <Stat label="Average dose" value={e.avgDoseMg != null ? show(e.avgDoseMg) : '—'} />
        <Stat label="Longest run" value={tenure?.longestRunWords || '—'} />
        <Stat label="Spent" value={e.spend != null ? money(e.spend) : 'no price'}
          sub={e.spend != null ? 'on logged doses' : null} />
      </div>

      {e.hasEstimate && (
        <p className="mt-2 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
          The estimated part is your typed-in history multiplied out by its stated dose and frequency. It is
          not evidence of anything and it never touches adherence or stock.
        </p>
      )}
    </div>
  )
}

// ------------------------------------------------------------ the editor

/**
 * When I actually started, and what I was on before logging.
 *
 * The one place tenure is edited. Backdating here moves nothing else: no logs
 * are written, no vial moves, adherence does not budge — the sheet says so,
 * because a number that quietly improved after a date change would be worse
 * than no number.
 */
export function TenureEditor({ peptide, open, onClose }) {
  const setStartedOn = useStore((s) => s.setStartedOn)
  const setShortName = useStore((s) => s.setShortName)
  const addPriorDose = useStore((s) => s.addPriorDose)
  const removePriorDose = useStore((s) => s.removePriorDose)
  const showToast = useStore((s) => s.showToast)
  const t = todayStr()

  const [date, setDate] = useState(peptide?.startedOn || t)
  const [short, setShort] = useState(peptide?.shortName || '')
  const [adding, setAdding] = useState(false)
  const [entry, setEntry] = useState(null)

  if (!open || !peptide) return null
  // A stretch "before logging" has to start before the start date, or it
  // describes a period that is already covered by the logs. The form opens on a
  // date three months before whatever the start date currently says, and cannot
  // be pushed past it.
  const latestPrior = addDaysStr(date, -1)
  const openAdd = () => {
    setEntry({
      fromDate: addDaysStr(date, -90),
      dose: peptide.ladder?.floor ?? 0,
      frequency: peptide.frequency || 'daily',
    })
    setAdding(true)
  }
  const prior = [...(peptide.priorDoseHistory || [])].sort((a, b) => a.fromDate.localeCompare(b.fromDate))

  const save = () => {
    if (date && date !== peptide.startedOn) setStartedOn(peptide.id, date)
    if (short.trim() !== (peptide.shortName || '')) setShortName(peptide.id, short)
    showToast('Saved — nothing else moved')
    onClose()
  }

  const addEntry = () => {
    if (!entry?.fromDate || entry.fromDate > latestPrior) return
    addPriorDose(peptide.id, { ...entry, unit: peptide.ladder?.unit })
    setAdding(false)
    setEntry(null)
  }

  return (
    <Modal open onClose={onClose} title={`${peptide.name} — since when`}>
      <div className="space-y-3" data-testid="tenure-editor">
        <label className="block">
          <span className="t-caption mb-1 block" style={{ color: 'var(--text-2)' }}>
            I have been on this since
          </span>
          <input type="date" className="input" value={date} max={t} aria-label="Started on"
            data-testid="started-on" onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Set this as far back as it really goes. It changes how long you have been on the compound and
          nothing else — no doses are added, no vial moves, and your adherence figure does not shift,
          because it only ever counts what you actually recorded.
        </p>

        <label className="block">
          <span className="t-caption mb-1 block" style={{ color: 'var(--text-2)' }}>
            Short name (optional)
          </span>
          <input className="input" value={short} placeholder={peptide.name} aria-label="Short name"
            data-testid="short-name" onChange={(e) => setShort(e.target.value)} />
        </label>
        <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Used in lists, where a long blend name would be cut off mid-word.
        </p>

        {/* what was happening before there was a log to look at */}
        <div className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }}>
          <p className="t-caption" style={{ color: 'var(--text-2)' }}>Before I started logging</p>
          <div className="mt-2 space-y-1" data-testid="prior-history">
            {prior.length === 0 && (
              <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
                Nothing entered. Add a stretch if you know roughly what you were on and how often.
              </p>
            )}
            {prior.map((e) => (
              <div key={e.id} className="flex items-center gap-2" data-testid="prior-row">
                <span className="min-w-0 flex-1 truncate text-xs font-bold tabular-nums">
                  {formatDose(e.dose, e.unit)} · {FREQ_LABELS[e.frequency] || e.frequency}
                  <span className="ml-1.5 font-semibold" style={{ color: 'var(--text-2)' }}>
                    from {prettyDate(e.fromDate)}
                  </span>
                </span>
                <button onClick={() => removePriorDose(peptide.id, e.id)} data-testid="prior-remove"
                  aria-label={`Remove the stretch from ${e.fromDate}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                  style={{ background: 'var(--surface)', color: 'var(--danger)' }}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>

          {adding && entry ? (
            <div className="mt-2 space-y-2" data-testid="prior-form">
              <label className="block">
                <span className="t-caption mb-1 block" style={{ color: 'var(--text-2)' }}>From</span>
                <input type="date" className="input" value={entry.fromDate} max={latestPrior}
                  aria-label="Stretch start" data-testid="prior-from"
                  onChange={(ev) => ev.target.value && setEntry((s) => ({ ...s, fromDate: ev.target.value }))} />
              </label>
              <label className="block">
                <span className="t-caption mb-1 block" style={{ color: 'var(--text-2)' }}>
                  Dose ({peptide.ladder?.unit || 'mcg'})
                </span>
                <NumberField value={entry.dose} min={0} aria-label="Prior dose"
                  onChange={(v) => setEntry((s) => ({ ...s, dose: v ?? 0 }))} />
              </label>
              <label className="block">
                <span className="t-caption mb-1 block" style={{ color: 'var(--text-2)' }}>How often</span>
                <select className="input" value={entry.frequency} aria-label="Prior frequency"
                  onChange={(ev) => setEntry((s) => ({ ...s, frequency: ev.target.value }))}>
                  {Object.entries(FREQ_LABELS).map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2">
                <button onClick={() => { setAdding(false); setEntry(null) }}
                  className="flex-1 rounded-full py-2 text-xs font-black"
                  style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>Cancel</button>
                <button onClick={addEntry} data-testid="prior-save" disabled={entry.fromDate > latestPrior}
                  className="btn-primary flex-1 rounded-full py-2 text-xs font-black disabled:opacity-40">Add it</button>
              </div>
            </div>
          ) : (
            <button onClick={openAdd} data-testid="prior-add"
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-full py-2 text-xs font-black"
              style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
              <Plus size={13} /> Add a stretch
            </button>
          )}

          <p className="mt-2 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
            These show on the timeline as the earliest segment, dashed and labelled estimated. They are
            never counted as logged doses.
          </p>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-full py-3 text-xs font-black"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>Cancel</button>
          <button onClick={save} data-testid="tenure-save"
            className="btn-primary flex-1 rounded-full py-3 text-xs font-black">Save</button>
        </div>
      </div>
    </Modal>
  )
}

// -------------------------------------------------------- one compact line

/**
 * "6 weeks · 500 mcg · cycle 2, day 3 of 14 off" — one line for a list row.
 */
export function TenureLine({ peptide }) {
  const runs = useStore((s) => s.runs)
  const titration = useStore((s) => s.titration)
  const pauses = useStore((s) => s.pauses)
  const t = todayStr()
  const tenure = tenureFor(peptide, { runs, pauses, todayStr: t })
  if (!tenure) return null
  const cycle = cyclePosition(peptide, t)
  const rung = currentRung(peptide, titration[peptide.id])
  const bits = [
    tenure.running
      ? (tenure.currentDays === 0 ? 'started today' : `${tenure.currentWords} on`)
      : `stopped · ${tenure.lifetimeWords} lifetime`,
    formatDose(rung.dose, peptide.ladder?.unit),
    cycle?.cycled ? cycle.words : null,
  ].filter(Boolean)
  return (
    <p className="truncate text-xs font-semibold tabular-nums leading-tight" data-testid="tenure-line"
      style={{ color: 'var(--text-2)' }}>
      {bits.join(' · ')}
    </p>
  )
}

export { durationWords }

// ---------------------------------------------------- the tenure table

const TABLE_SORTS = [
  { id: 'longest', label: 'Longest on' },
  { id: 'newest', label: 'Recently started' },
  { id: 'atdose', label: 'Longest at dose' },
]

/**
 * What have I been on, for how long, at what dose, and how has it moved.
 *
 * Deliberately a table and not a stack of cards. Every row is the same height
 * with the same fields in the same places, because the question this answers is
 * a comparison between compounds, and a comparison needs a column to run down.
 */
export function TenureTable({ onOpen }) {
  const peptides = useStore((s) => s.peptides)
  const runs = useStore((s) => s.runs)
  const titration = useStore((s) => s.titration)
  const doseEvents = useStore((s) => s.doseEvents)
  const pauses = useStore((s) => s.pauses)
  const t = todayStr()
  const [sort, setSort] = useState('longest')

  const rows = useMemo(() => {
    const list = peptides.map((p) => ({
      p,
      tenure: tenureFor(p, { runs, pauses, todayStr: t }),
      cycle: cyclePosition(p, t),
      atDose: doseTenure(p, { doseEvents, titration, pauses, todayStr: t }),
    })).filter((r) => r.tenure)
    const on = (r) => r.tenure.currentDays ?? 0
    const at = (r) => r.atDose?.days ?? 0
    const byName = (a, b) => displayName(a.p).localeCompare(displayName(b.p))
    if (sort === 'newest') return list.sort((a, b) => on(a) - on(b) || byName(a, b))
    if (sort === 'atdose') return list.sort((a, b) => at(b) - at(a) || byName(a, b))
    return list.sort((a, b) => on(b) - on(a) || byName(a, b))
  }, [peptides, runs, titration, doseEvents, t, sort, pauses])

  if (!rows.length) {
    return (
      <div className="card p-5 text-center" data-testid="tenure-table-empty">
        <p className="text-sm font-bold">Nothing in my protocol yet.</p>
        <p className="mt-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Time on compound, current dose and dose history all appear here once there is something to
          measure them against.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2" data-testid="tenure-table">
      <div className="flex items-center justify-between gap-2">
        <p className="t-caption" style={{ color: 'var(--text-2)' }}>What I'm on</p>
        <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--text-3)' }}>
          {rows.length} compound{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-0.5" data-testid="tenure-sort">
        {TABLE_SORTS.map((s) => (
          <button key={s.id} onClick={() => setSort(s.id)} data-testid={`tsort-${s.id}`}
            className="flex min-h-[40px] shrink-0 items-center rounded-full px-3.5 text-xs font-black"
            style={sort === s.id
              ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
              : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="card rows overflow-hidden">
        {rows.map((r) => <TenureRow key={r.p.id} row={r} onOpen={() => onOpen?.(r.p.id)} />)}
      </div>

      <p className="px-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
        Time on compound is your own stated start date and may reach back before any of this was being
        logged. Tap a row for its dose timeline and everything taken.
      </p>
    </div>
  )
}

/** One field of a row: what it is on the left, what it says on the right. */
function Field({ label, children, strong }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="t-caption shrink-0" style={{ color: 'var(--text-3)' }}>{label}</span>
      <span className={`min-w-0 truncate text-right tabular-nums ${strong ? 't-metric-sm' : 'text-xs font-bold'}`}
        style={{ color: strong ? 'var(--text)' : 'var(--text-2)' }}>
        {children}
      </span>
    </div>
  )
}

/**
 * One compound, one row, the same fields in the same places every time.
 *
 * Every field is rendered whether or not it has something to say — a compound
 * with no cycle still gets a Cycle line reading "not cycled" — so the rows line
 * up and a column can be read straight down. That is the whole reason this is a
 * table and not twelve little cards.
 */
function TenureRow({ row, onOpen }) {
  const { p, tenure, cycle, atDose } = row
  return (
    <button onClick={onOpen} data-testid="tenure-row"
      className="flex w-full items-start gap-3 p-3 text-left">
      <div className="min-w-0 flex-1 space-y-1">
        {/* a short name is short enough to print whole */}
        <p className="text-sm font-bold leading-tight">{displayName(p)}</p>

        <Field label="Time on" strong>
          <span data-testid="row-time-on">
            {tenure.running
              ? (tenure.currentDays === 0 ? 'Started today' : tenure.currentWords)
              : `Stopped · ${tenure.lifetimeWords}`}
          </span>
        </Field>

        <Field label="Dose">{formatDose(atDose?.dose, atDose?.unit || p.ladder?.unit)}</Field>

        <Field label="At this dose">
          <span data-testid="row-at-dose">
            {atDose?.days == null
              ? '—'
              : atDose.days === 0 ? 'set today' : durationWords(atDose.days)}
          </span>
        </Field>

        <Field label="Dose history">
          <span className="flex items-center justify-end gap-1.5" data-testid="row-progression">
            <DoseSparkline peptide={p} width={44} height={13} />
            <span className="min-w-0 truncate">{atDose?.progression}</span>
          </span>
        </Field>

        <Field label="Cycle">{cycle?.cycled && cycle.short ? cycle.short : 'not cycled'}</Field>

        <Field label="Started">
          {prettyDate(tenure.startedOn)}
          {tenure.runCount > 1 ? ` · ${tenure.runCount} runs` : ''}
        </Field>
      </div>
      <ChevronRight size={16} className="mt-1 shrink-0" style={{ color: 'var(--text-2)' }} />
    </button>
  )
}

/**
 * Everything about one compound's dose, opened from its row.
 *
 * The step-up list is spelled out in sentences rather than left as points on a
 * chart, because "four weeks at 0.5 mg before this" is the part people actually
 * want and it is not something a line can say.
 */
/** Every break that touched this compound, wherever its history is read. */
function CompoundPauses({ peptideId }) {
  const pauses = useStore((s) => s.pauses)
  const mine = pauses.filter((p) => !p.peptideIds || p.peptideIds.includes(peptideId))
  if (!mine.length) return null
  return (
    <div className="space-y-2" data-testid="compound-pauses">
      <p className="px-1 t-caption" style={{ color: 'var(--text-2)' }}>Breaks</p>
      <PauseHistory peptideId={peptideId} compact />
    </div>
  )
}

export function CompoundDetail({ peptideId, open, onClose }) {
  const peptides = useStore((s) => s.peptides)
  const doseEvents = useStore((s) => s.doseEvents)
  const titration = useStore((s) => s.titration)
  const skips = useStore((s) => s.skips)
  const pauses = useStore((s) => s.pauses)
  const t = todayStr()
  const [picked, setPicked] = useState(null)
  const peptide = peptides.find((p) => p.id === peptideId)
  if (!open || !peptide) return null

  const atDose = doseTenure(peptide, { doseEvents, titration, pauses, todayStr: t })
  const mySkips = (skips || []).filter((s) => s.peptideId === peptide.id)

  // Each step-up, with how long the dose before it had been held.
  const stepUps = (atDose?.changes || [])
    .filter((e) => e.kind === 'step-up' || e.kind === 'override')
    .map((e, i, all) => {
      const prev = i > 0 ? all[i - 1] : (atDose.changes.find((c) => c.kind === 'start') || null)
      const held = prev ? daysBetween(prev.date, e.date) : null
      return { ...e, heldWords: held != null && held > 0 ? durationWords(held) : null }
    })
    .reverse()

  return (
    <Modal open onClose={onClose} title={displayName(peptide)} wide>
      <div className="space-y-3" data-testid="compound-detail">
        <TenureBlock peptide={peptide} />
        <DoseTimelineChart peptide={peptide} />
        {/* the record stands whether or not the dose ever moved enough to plot */}
        <TimelineEvents peptide={peptide} picked={picked} onPick={setPicked} />
        {/* Breaks, here as well as on the compound sheet: History is the other
            way into this compound, and a stretch it was not being taken belongs
            wherever its dose history is read. */}
        <CompoundPauses peptideId={peptide.id} />
        <ExposureBlock peptide={peptide} />

        {stepUps.length > 0 && (
          <div className="card p-3" data-testid="stepup-list">
            <p className="t-caption" style={{ color: 'var(--text-2)' }}>Every dose change</p>
            <div className="mt-2 space-y-2">
              {stepUps.map((e) => (
                <p key={e.id} className="text-xs font-medium leading-relaxed" data-testid="stepup-line"
                  style={{ color: 'var(--text-2)' }}>
                  <span className="font-black tabular-nums" style={{ color: 'var(--text)' }}>
                    {prettyDate(e.date)}:
                  </span>{' '}
                  <span className="font-bold tabular-nums" style={{ color: 'var(--text)' }}>
                    {e.from != null ? `${formatDose(e.from, e.unit)} → ` : ''}{formatDose(e.to, e.unit)}
                  </span>
                  {e.heldWords && ` · ${e.heldWords} at the dose before this`}
                </p>
              ))}
            </div>
          </div>
        )}

        {mySkips.length > 0 && (
          <div className="card p-3" data-testid="detail-skips">
            <p className="t-caption" style={{ color: 'var(--text-2)' }}>Skipped · {mySkips.length}</p>
            <div className="mt-2 space-y-1">
              {mySkips.slice(-8).reverse().map((k) => (
                <p key={`${k.date}-${k.peptideId}`} className="flex items-center gap-2 text-xs font-medium tabular-nums"
                  style={{ color: 'var(--text-2)' }}>
                  <SkipForward size={11} className="shrink-0" style={{ color: 'var(--warn)' }} />
                  {prettyDate(k.date)}{k.reason ? ` · ${k.reason}` : ''}
                </p>
              ))}
            </div>
            <p className="mt-2 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
              A decision, not a lapse — nothing came out of stock for these.
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}
