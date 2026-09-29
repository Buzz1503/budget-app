import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, CalendarDays, CalendarRange, Sun, Moon, Layers,
  CalendarPlus, Zap, Wind, Syringe as SyringeIcon, Check, AlertCircle, SkipForward,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import { addDaysStr } from '../lib/schedule'
import {
  weekSummary, groupEvents, weekStart, monthStart,
  monthGridRange, addMonths, EVENT_META, ADHERENCE_TONE, ADHERENCE_WORDS,
} from '../lib/calendarView'
import { useCalendarRange } from '../lib/useCalendarRange'
import { entryState } from '../lib/backfill'
import { formatDose, formatUnitsLong } from '../lib/calc'
import { buildIcs } from '../lib/calendar'
import { deliveryEvents } from '../lib/restock'
import CoachTip from './ui/CoachTip'
import BackfillSheet from './BackfillSheet'
import MonthGrid from './MonthGrid'
import DaySheet from './DaySheet'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function CalendarTab({ goTo }) {
  const [view, setView] = useState('week')
  const t = todayStr()
  const [anchor, setAnchor] = useState(t)
  const [detail, setDetail] = useState(null)
  const [backfill, setBackfill] = useState(null)

  const range = view === 'week'
    ? { from: weekStart(anchor), to: addDaysStr(weekStart(anchor), 6) }
    : monthGridRange(anchor)

  const cal = useCalendarRange(range.from, range.to)
  const step = (n) => setAnchor(view === 'week' ? addDaysStr(anchor, n * 7) : addMonths(anchor, n))
  const atToday = view === 'week'
    ? weekStart(anchor) === weekStart(t)
    : monthStart(anchor) === monthStart(t)

  const title = view === 'week'
    ? `${format(parseISO(range.from), 'd MMM')} – ${format(parseISO(range.to), 'd MMM')}`
    : format(parseISO(monthStart(anchor)), 'MMMM yyyy')

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-black tracking-tight">Calendar</h1>
        <div className="flex rounded-full p-1" style={{ background: 'var(--surface-sunk)' }}>
          {[['week', 'Week', CalendarDays], ['month', 'Month', CalendarRange]].map(([id, label, Icon]) => (
            <button key={id} onClick={() => setView(id)}
              className="relative flex items-center gap-1 rounded-full px-3 py-2 text-xs font-black">
              {view === id && <motion.span layoutId="cal-view-pill" className="absolute inset-0 rounded-full"
                style={{ background: 'var(--accent)' }} />}
              <span className="relative flex items-center gap-1" style={{ color: view === id ? 'var(--accent-fg)' : 'var(--text-2)' }}>
                <Icon size={13} /> {label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <CoachTip id="calendar-intro" tone="indigo">
        Past days show what you actually logged. Future days show the dose you'll be on
        <span className="font-black"> if you confirm each step-up</span> — projected, not promised.
      </CoachTip>

      {/* period nav */}
      <div className="flex items-center gap-2">
        <button onClick={() => step(-1)} aria-label="Previous period"
          className="rounded-full p-2" style={{ background: 'var(--surface-sunk)' }}>
          <ChevronLeft size={18} />
        </button>
        <p className="flex-1 text-center text-sm font-black">{title}</p>
        <button onClick={() => step(1)} aria-label="Next period"
          className="rounded-full p-2" style={{ background: 'var(--surface-sunk)' }}>
          <ChevronRight size={18} />
        </button>
        {!atToday && (
          <button onClick={() => setAnchor(t)} className="rounded-full px-3 py-2 text-xs font-black"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
            Today
          </button>
        )}
      </div>

      {/* Swipe as well as the arrows — a month grid on a phone is a thing you
          flick through, and reaching for a 36px chevron each time is not. */}
      <motion.div
        key={view === 'week' ? weekStart(anchor) : monthStart(anchor)}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.12}
        onDragEnd={(e, info) => {
          if (info.offset.x < -60) step(1)
          else if (info.offset.x > 60) step(-1)
        }}
        initial={{ opacity: 0.6 }} animate={{ opacity: 1 }}
        data-testid="calendar-pane">
        {view === 'week'
          ? <WeekView cal={cal} onOpenDay={setDetail} />
          : <MonthGrid cal={cal} anchor={anchor} todayStr={t} onOpenDay={setDetail} />}
      </motion.div>

      <IcsButton />

      <DaySheet open={!!detail} date={detail} onClose={() => setDetail(null)} goTo={goTo}
        onBackfill={(d) => { setDetail(null); setBackfill(d) }} />

      <BackfillSheet open={!!backfill} date={backfill} onClose={() => setBackfill(null)} />

      <p className="px-1 pb-2 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
        Personal tracking tool — not medical advice. Projected doses assume you confirm each step-up;
        nothing advances on its own.
      </p>
    </div>
  )
}

// ---------- week ----------
function WeekView({ cal, onOpenDay }) {
  const sum = useMemo(() => weekSummary(cal.days), [cal.days])

  return (
    <div className="space-y-3">
      <motion.div layout className="card p-3"
        style={{ background: 'var(--surface-sunk)' }}>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>This week</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold">
          <span className="flex items-center gap-1"><SyringeIcon size={12} style={{ color: 'var(--good)' }} />
            {sum.shots} shot{sum.shots === 1 ? '' : 's'} · {sum.doses} dose{sum.doses === 1 ? '' : 's'}</span>
          {sum.stepUps > 0 && <span className="flex items-center gap-1" style={{ color: 'var(--text)' }}><Zap size={12} /> {sum.stepUps} step-up{sum.stepUps === 1 ? '' : 's'}</span>}
          {sum.expiring > 0 && <span style={{ color: 'var(--danger)' }}>🧪 {sum.expiring} vial expiring</span>}
          {sum.restocks > 0 && <span style={{ color: 'var(--danger)' }}>📦 {sum.restocks} restock due</span>}
          {sum.deliveries > 0 && <span style={{ color: 'var(--text-2)' }}>🚚 {sum.deliveries} delivery</span>}
        </div>
        {!cal.grouped && sum.doses > 0 && (
          <p className="mt-1 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
            Checking which shots can share a syringe…
          </p>
        )}
      </motion.div>

      {cal.days.map((d, i) => <DayRow key={d.date} day={d} index={i} onOpen={() => onOpenDay(d.date)} />)}
    </div>
  )
}

function DayRow({ day: d, index, onOpen }) {
  const empty = d.scheduled === 0 && d.events.length === 0

  return (
    <motion.button layout onClick={onOpen}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.02 }}
      className="card w-full p-3 text-left"
      data-testid={`cal-day-${d.date}`}
      style={d.isToday
        ? { borderColor: 'var(--good)', boxShadow: '0 0 0 1.5px var(--good)' }
        : undefined}>
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-[14px] leading-none"
          style={d.isToday
            ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
            : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
          <span className="text-[8px] font-black uppercase">{DOW[(d.weekday + 6) % 7]}</span>
          <span className="text-xs font-black">{format(parseISO(d.date), 'd')}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-black">
            {d.isToday ? 'Today' : format(parseISO(d.date), 'EEEE')}
            {d.scheduled > 0 && (
              <span className="ml-2 font-bold" style={{ color: 'var(--text-2)' }}>
                · {d.shots} shot{d.shots === 1 ? '' : 's'}
              </span>
            )}
          </span>
          {empty && <span className="block text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Nothing scheduled</span>}
        </span>
        {d.scheduled > 0 && (
          <span className="chip shrink-0 !py-1 text-xs font-black"
            style={{ color: ADHERENCE_TONE[d.adherence] }}>
            {d.adherence === 'all' ? <Check size={11} /> : null}
            {d.isPast || d.isToday ? ADHERENCE_WORDS[d.adherence] : `${d.scheduled} due`}
          </span>
        )}
      </div>

      {['AM', 'PM'].map((slot) => (
        d.slots[slot].length > 0 && (
          <div key={slot} className="mt-2 rounded-[14px] p-2" style={{ background: 'var(--surface-sunk)' }}>
            <p className="mb-1 flex items-center gap-1 text-xs font-black uppercase tracking-wide"
              style={{ color: 'var(--text-2)' }}>
              {slot === 'AM' ? <Sun size={11} /> : <Moon size={11} />} {slot}
            </p>
            <SlotLines day={d} slot={slot} />
          </div>
        )
      ))}

      {d.events.length > 0 && (
        <div className="mt-2 space-y-1">
          {groupEvents(d.events).map((e, i) => (
            <p key={i} className="flex items-start gap-2 text-xs font-bold" style={{ color: EVENT_META[e.kind].tone }}>
              <span className="shrink-0">{EVENT_META[e.kind].glyph}</span>
              <span className="min-w-0">{e.text}</span>
            </p>
          ))}
        </div>
      )}
    </motion.button>
  )
}

// One line per syringe: a co-draw group reads as one line, because it is one shot.
// Logged, skipped and missed each get their own mark and their own word. On a
// day that has been and gone, "nothing here" and "deliberately cleared" are not
// the same fact, and a line that shows neither leaves both invisible.
function StateMark({ state }) {
  if (state === 'logged') return <Check size={12} className="mt-1 shrink-0" strokeWidth={3} style={{ color: 'var(--good)' }} aria-label="Logged" />
  if (state === 'skipped') return <SkipForward size={12} className="mt-1 shrink-0" style={{ color: 'var(--warn)' }} aria-label="Skipped" />
  if (state === 'missed') return <AlertCircle size={12} className="mt-1 shrink-0" strokeWidth={3} style={{ color: 'var(--danger)' }} aria-label="Missed" />
  return null
}

function stateTone(state) {
  if (state === 'logged') return 'var(--good)'
  if (state === 'skipped') return 'var(--warn)'
  if (state === 'missed') return 'var(--danger)'
  return undefined
}

function SlotLines({ day: d, slot }) {
  const plan = d.plans[slot]
  const nasal = d.slots[slot].filter((e) => e.nasal)
  const byId = Object.fromEntries(d.slots[slot].map((e) => [e.peptideId, e]))

  return (
    <div className="space-y-1">
      {(plan?.groups || []).map((g, i) => {
        const many = g.items.length > 1
        const entries = g.items.map((it) => byId[it.id]).filter(Boolean)
        const states = entries.map((e) => entryState(e, d))
        // a mixed group reports the worst of what it contains, never an average
        const state = states.includes('missed') ? 'missed'
          : states.every((s) => s === 'logged') ? 'logged'
            : states.includes('skipped') ? 'skipped' : states[0]
        return (
          <p key={i} className="flex items-start gap-2 text-xs font-bold leading-snug">
            {many
              ? <Layers size={11} className="mt-1 shrink-0" style={{ color: 'var(--good)' }} />
              : <SyringeIcon size={11} className="mt-1 shrink-0" style={{ color: 'var(--text-2)' }} />}
            <span className="min-w-0 flex-1">
              {entries.map((e, j) => (
                <span key={e.peptideId}>
                  {j > 0 && <span style={{ color: 'var(--good)' }}> + </span>}
                  <span style={{ color: stateTone(entryState(e, d)) }}>{e.name}</span>
                  <span className="font-semibold" style={{ color: 'var(--text-2)' }}> {formatDose(e.dose, e.unit)}</span>
                </span>
              ))}
              <span className="ml-1" style={{ color: 'var(--good)' }}>{formatUnitsLong(g.units)}</span>
              {many && <span className="font-semibold" style={{ color: 'var(--text-2)' }}> · one syringe</span>}
              {state === 'missed' && <span className="font-black" style={{ color: 'var(--danger)' }}> · missed</span>}
              {state === 'skipped' && <span className="font-black" style={{ color: 'var(--warn)' }}> · skipped</span>}
            </span>
            <StateMark state={state} />
          </p>
        )
      })}
      {nasal.map((e) => {
        const state = entryState(e, d)
        return (
          <p key={e.peptideId} className="flex items-start gap-2 text-xs font-bold leading-snug">
            <Wind size={11} className="mt-1 shrink-0" style={{ color: 'var(--text-2)' }} />
            <span className="min-w-0 flex-1">
              <span style={{ color: stateTone(state) }}>{e.name}</span>
              <span className="font-semibold" style={{ color: 'var(--text-2)' }}> {formatDose(e.dose, e.unit)} · nasal</span>
              {state === 'missed' && <span className="font-black" style={{ color: 'var(--danger)' }}> · missed</span>}
              {state === 'skipped' && <span className="font-black" style={{ color: 'var(--warn)' }}> · skipped</span>}
            </span>
            <StateMark state={state} />
          </p>
        )
      })}
    </div>
  )
}

// ---------- .ics ----------
function IcsButton() {
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const restock = useStore((s) => s.restock)
  const [msg, setMsg] = useState(null)

  const doExport = () => {
    try {
      const deliveries = deliveryEvents(restock, peptides)
      const { ics, eventCount } = buildIcs(peptides, titration, { from: new Date(), includeDose: true, deliveries })
      if (eventCount === 0) {
        setMsg({ ok: false, text: 'Nothing to export yet — set a protocol first.' })
        return
      }
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `peptide-schedule-${todayStr()}.ics`
      a.click()
      URL.revokeObjectURL(url)
      setMsg({ ok: true, text: `${eventCount} recurring events exported — open the file to add them.` })
    } catch (e) {
      setMsg({ ok: false, text: `Export failed: ${e.message}` })
    }
  }

  return (
    <div className="space-y-2">
      <button onClick={doExport}
        className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-black">
        <CalendarPlus size={16} /> Add to phone calendar
      </button>
      {msg && <p className="text-xs font-bold" style={{ color: msg.ok ? 'var(--good)' : 'var(--danger)' }}>{msg.text}</p>}
      <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
        A snapshot — re-export after you change your protocol, because events already in your
        phone's calendar won't update themselves.
      </p>
    </div>
  )
}

// ---------- compact strip for Home ----------
export function NextSevenDays({ goTo }) {
  const t = todayStr()
  const cal = useCalendarRange(t, addDaysStr(t, 6))
  if (cal.days.every((d) => d.scheduled === 0)) return null

  return (
    <motion.button layout onClick={() => goTo?.('calendar')}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="card w-full p-3 text-left" data-testid="next-7-days">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Next 7 days</p>
        <span className="flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--text-2)' }}>
          Calendar <ChevronRight size={12} />
        </span>
      </div>
      <div className="flex gap-2">
        {cal.days.map((d) => (
          <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-xs font-black uppercase" style={{ color: d.isToday ? 'var(--good)' : 'var(--text-2)' }}>
              {DOW[(d.weekday + 6) % 7][0]}
            </span>
            <span className="flex h-9 w-full flex-col items-center justify-center rounded-[10px] text-xs font-black"
              style={{
                background: d.scheduled === 0
                  ? 'var(--surface-sunk)'
                  : `color-mix(in srgb, ${ADHERENCE_TONE[d.adherence]} 26%, transparent)`,
                border: d.isToday ? '1.5px solid var(--good)' : '1px solid transparent',
                color: d.scheduled === 0 ? 'var(--text-2)' : 'var(--text)',
              }}>
              {d.scheduled === 0 ? '–' : d.shots}
              {d.events.length > 0 && (
                <span className="h-1 w-1 rounded-full" style={{ background: EVENT_META[d.events[0].kind].tone }} />
              )}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
        Number of shots each day · tap for the full calendar
      </p>
    </motion.button>
  )
}
