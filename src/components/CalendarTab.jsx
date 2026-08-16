import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, CalendarDays, CalendarRange, Sun, Moon, Layers,
  CalendarPlus, Zap, Wind, Syringe as SyringeIcon, Check, Dot,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import { addDaysStr, daysBetween } from '../lib/schedule'
import {
  buildCalendar, weekSummary, adherenceTally, groupEvents, weekStart, monthStart, monthEnd,
  monthGridRange, addMonths, datesBetween, EVENT_META, ADHERENCE_TONE, ADHERENCE_WORDS,
} from '../lib/calendarView'
import { formatDose, formatUnitsLong, round } from '../lib/calc'
import { loadMatrix, LIB_TO_COMPOUND } from '../lib/mixMatrix'
import { buildIcs } from '../lib/calendar'
import { deliveryEvents } from '../lib/restock'
import Modal from './ui/Modal'
import CoachTip from './ui/CoachTip'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// The chemistry matrix is a lazy ~1.9 MB chunk. Until it lands every dose
// counts as its own syringe — the safe over-count — and the UI says so.
function useVerdictOf() {
  const [matrix, setMatrix] = useState(null)
  useEffect(() => {
    let alive = true
    loadMatrix().then((m) => { if (alive) setMatrix(m) }).catch(() => { /* over-count stands */ })
    return () => { alive = false }
  }, [])
  return useMemo(() => {
    if (!matrix) return null
    return (a, b) => matrix.lookup(LIB_TO_COMPOUND[a] || a, LIB_TO_COMPOUND[b] || b)?.verdict || null
  }, [matrix])
}

export function useCalendarRange(from, to) {
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const doseLogs = useStore((s) => s.doseLogs)
  const openVials = useStore((s) => s.openVials)
  const vials = useStore((s) => s.vials)
  const restock = useStore((s) => s.restock)
  const supplements = useStore((s) => s.supplements)
  const supplementLogs = useStore((s) => s.supplementLogs)
  const leadDays = useStore((s) => s.settings.restockLeadDays)
  const verdictOf = useVerdictOf()
  const t = todayStr()

  return useMemo(
    () => buildCalendar({ peptides, titration, doseLogs, openVials, vials, supplements, supplementLogs, restock, todayStr: t, from, to, verdictOf, leadDays }),
    [peptides, titration, doseLogs, openVials, vials, supplements, supplementLogs, restock, t, from, to, verdictOf, leadDays]
  )
}

export default function CalendarTab({ goTo }) {
  const [view, setView] = useState('week')
  const t = todayStr()
  const [anchor, setAnchor] = useState(t)
  const [detail, setDetail] = useState(null)

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
        <div className="flex rounded-xl p-1" style={{ background: 'var(--surface2)' }}>
          {[['week', 'Week', CalendarDays], ['month', 'Month', CalendarRange]].map(([id, label, Icon]) => (
            <button key={id} onClick={() => setView(id)}
              className="relative flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-black">
              {view === id && <motion.span layoutId="cal-view-pill" className="absolute inset-0 rounded-lg"
                style={{ backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))' }} />}
              <span className="relative flex items-center gap-1" style={{ color: view === id ? '#fff' : 'var(--muted)' }}>
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
          className="rounded-xl p-2" style={{ background: 'var(--surface2)' }}>
          <ChevronLeft size={18} />
        </button>
        <p className="flex-1 text-center text-sm font-black">{title}</p>
        <button onClick={() => step(1)} aria-label="Next period"
          className="rounded-xl p-2" style={{ background: 'var(--surface2)' }}>
          <ChevronRight size={18} />
        </button>
        {!atToday && (
          <button onClick={() => setAnchor(t)} className="rounded-xl px-2.5 py-2 text-xs font-black"
            style={{ background: 'var(--lime)', color: '#0c1200' }}>
            Today
          </button>
        )}
      </div>

      {view === 'week'
        ? <WeekView cal={cal} onOpenDay={setDetail} />
        : <MonthView cal={cal} anchor={anchor} onOpenDay={setDetail} />}

      <IcsButton />

      <DayDetail date={detail} day={detail ? cal.byDate[detail] : null} grouped={cal.grouped}
        onClose={() => setDetail(null)} goTo={goTo} />

      <p className="px-1 pb-2 text-[10px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
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
    <div className="space-y-2.5">
      <motion.div layout className="card p-3"
        style={{ backgroundImage: 'linear-gradient(135deg, color-mix(in srgb, var(--indigo) 12%, var(--surface)), var(--surface))' }}>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--indigo)' }}>This week</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold">
          <span className="flex items-center gap-1"><SyringeIcon size={12} style={{ color: 'var(--lime)' }} />
            {sum.shots} shot{sum.shots === 1 ? '' : 's'} · {sum.doses} dose{sum.doses === 1 ? '' : 's'}</span>
          {sum.stepUps > 0 && <span className="flex items-center gap-1" style={{ color: 'var(--violet)' }}><Zap size={12} /> {sum.stepUps} step-up{sum.stepUps === 1 ? '' : 's'}</span>}
          {sum.expiring > 0 && <span style={{ color: 'var(--coral)' }}>🧪 {sum.expiring} vial expiring</span>}
          {sum.restocks > 0 && <span style={{ color: 'var(--coral)' }}>📦 {sum.restocks} restock due</span>}
          {sum.deliveries > 0 && <span style={{ color: 'var(--indigo)' }}>🚚 {sum.deliveries} delivery</span>}
        </div>
        {!cal.grouped && sum.doses > 0 && (
          <p className="mt-1 text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
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
        ? { borderColor: 'var(--lime)', boxShadow: '0 0 0 1.5px var(--lime)' }
        : undefined}>
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-xl leading-none"
          style={d.isToday
            ? { backgroundImage: 'linear-gradient(135deg, var(--lime), var(--lime-deep))', color: '#0c1200' }
            : { background: 'var(--surface2)', color: 'var(--muted)' }}>
          <span className="text-[8px] font-black uppercase">{DOW[(d.weekday + 6) % 7]}</span>
          <span className="text-xs font-black">{format(parseISO(d.date), 'd')}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-black">
            {d.isToday ? 'Today' : format(parseISO(d.date), 'EEEE')}
            {d.scheduled > 0 && (
              <span className="ml-1.5 font-bold" style={{ color: 'var(--muted)' }}>
                · {d.shots} shot{d.shots === 1 ? '' : 's'}
              </span>
            )}
          </span>
          {empty && <span className="block text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>Nothing scheduled</span>}
        </span>
        {d.scheduled > 0 && (
          <span className="chip shrink-0 !py-0.5 text-[10px] font-black"
            style={{ color: ADHERENCE_TONE[d.adherence] }}>
            {d.adherence === 'all' ? <Check size={11} /> : null}
            {d.isPast || d.isToday ? ADHERENCE_WORDS[d.adherence] : `${d.scheduled} due`}
          </span>
        )}
      </div>

      {['AM', 'PM'].map((slot) => (
        d.slots[slot].length > 0 && (
          <div key={slot} className="mt-2 rounded-xl p-2" style={{ background: 'var(--surface2)' }}>
            <p className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-wide"
              style={{ color: slot === 'AM' ? 'var(--amber)' : 'var(--indigo)' }}>
              {slot === 'AM' ? <Sun size={11} /> : <Moon size={11} />} {slot}
            </p>
            <SlotLines day={d} slot={slot} />
          </div>
        )
      ))}

      {d.events.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {groupEvents(d.events).map((e, i) => (
            <p key={i} className="flex items-start gap-1.5 text-[11px] font-bold" style={{ color: EVENT_META[e.kind].tone }}>
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
function SlotLines({ day: d, slot }) {
  const plan = d.plans[slot]
  const nasal = d.slots[slot].filter((e) => e.nasal)
  const byId = Object.fromEntries(d.slots[slot].map((e) => [e.peptideId, e]))

  return (
    <div className="space-y-1">
      {(plan?.groups || []).map((g, i) => {
        const many = g.items.length > 1
        const entries = g.items.map((it) => byId[it.id]).filter(Boolean)
        const allTaken = entries.length > 0 && entries.every((e) => e.taken)
        return (
          <p key={i} className="flex items-start gap-1.5 text-[11px] font-bold leading-snug">
            {many
              ? <Layers size={11} className="mt-0.5 shrink-0" style={{ color: 'var(--lime)' }} />
              : <SyringeIcon size={11} className="mt-0.5 shrink-0" style={{ color: 'var(--muted)' }} />}
            <span className="min-w-0 flex-1">
              {entries.map((e, j) => (
                <span key={e.peptideId}>
                  {j > 0 && <span style={{ color: 'var(--lime)' }}> + </span>}
                  <span style={allTaken ? { color: 'var(--lime)' } : undefined}>{e.name}</span>
                  <span className="font-semibold" style={{ color: 'var(--muted)' }}> {formatDose(e.dose, e.unit)}</span>
                </span>
              ))}
              <span className="ml-1" style={{ color: 'var(--lime)' }}>{formatUnitsLong(g.units)}</span>
              {many && <span className="font-semibold" style={{ color: 'var(--muted)' }}> · one syringe</span>}
            </span>
            {allTaken && <Check size={12} className="mt-0.5 shrink-0" strokeWidth={3} style={{ color: 'var(--lime)' }} />}
          </p>
        )
      })}
      {nasal.map((e) => (
        <p key={e.peptideId} className="flex items-start gap-1.5 text-[11px] font-bold leading-snug">
          <Wind size={11} className="mt-0.5 shrink-0" style={{ color: 'var(--indigo)' }} />
          <span className="min-w-0 flex-1">
            <span style={e.taken ? { color: 'var(--lime)' } : undefined}>{e.name}</span>
            <span className="font-semibold" style={{ color: 'var(--muted)' }}> {formatDose(e.dose, e.unit)} · nasal</span>
          </span>
          {e.taken && <Check size={12} className="mt-0.5 shrink-0" strokeWidth={3} style={{ color: 'var(--lime)' }} />}
        </p>
      ))}
    </div>
  )
}

// ---------- month ----------
function MonthView({ cal, anchor, onOpenDay }) {
  const inMonth = (date) => date.slice(0, 7) === anchor.slice(0, 7)
  const monthDays = cal.days.filter((d) => inMonth(d.date))
  const tally = useMemo(() => adherenceTally(monthDays), [monthDays])

  return (
    <div className="space-y-2.5">
      <div className="card p-2">
        <div className="grid grid-cols-7 gap-1">
          {DOW.map((w) => (
            <p key={w} className="text-center text-[9px] font-black uppercase" style={{ color: 'var(--muted)' }}>{w[0]}</p>
          ))}
          {cal.days.map((d) => (
            <MonthCell key={d.date} day={d} muted={!inMonth(d.date)} onOpen={() => onOpenDay(d.date)} />
          ))}
        </div>
      </div>

      {/* heatmap legend — colours are labelled, never colour alone */}
      <div className="card p-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--violet)' }}>
          Adherence this month{tally.pct != null ? ` · ${tally.pct}% fully done` : ''}
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {['all', 'partial', 'missed', 'pending', 'future'].map((k) => (
            <span key={k} className="flex items-center gap-1.5 text-[11px] font-bold">
              <span className="h-3 w-3 rounded" style={{ background: ADHERENCE_TONE[k] }} />
              {ADHERENCE_WORDS[k]}{k !== 'future' && k !== 'pending' ? ` · ${tally[k]}` : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function MonthCell({ day: d, muted, onOpen }) {
  const tone = ADHERENCE_TONE[d.adherence]
  const hasEvent = d.events.length > 0
  return (
    <button onClick={onOpen} data-testid={`cal-cell-${d.date}`}
      className="relative flex aspect-square flex-col items-center justify-center rounded-lg"
      aria-label={`${format(parseISO(d.date), 'd MMMM')} — ${d.scheduled} scheduled, ${ADHERENCE_WORDS[d.adherence]}`}
      style={{
        background: d.adherence === 'none' ? 'transparent' : `color-mix(in srgb, ${tone} ${d.adherence === 'future' ? 60 : 26}%, transparent)`,
        opacity: muted ? 0.32 : 1,
        border: d.isToday ? '1.5px solid var(--lime)' : '1px solid transparent',
      }}>
      <span className="text-[11px] font-black leading-none">{format(parseISO(d.date), 'd')}</span>
      {d.scheduled > 0 && (
        <span className="mt-0.5 text-[8px] font-black leading-none" style={{ color: tone }}>
          {d.shots}
        </span>
      )}
      {hasEvent && (
        <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full"
          style={{ background: EVENT_META[d.events[0].kind].tone }} />
      )}
    </button>
  )
}

// ---------- day detail ----------
function DayDetail({ date, day, grouped, onClose, goTo }) {
  if (!date) return null
  return (
    <Modal open={!!date} onClose={onClose} title={format(parseISO(date), 'EEEE d MMMM')} wide>
      <div className="space-y-3">
        {day && day.scheduled === 0 && day.events.length === 0 && (
          <p className="py-4 text-center text-sm font-bold" style={{ color: 'var(--muted)' }}>
            Nothing scheduled — a clear day.
          </p>
        )}

        {day && day.scheduled > 0 && (
          <p className="text-xs font-bold" style={{ color: 'var(--muted)' }}>
            {day.shots} shot{day.shots === 1 ? '' : 's'} · {day.scheduled} dose{day.scheduled === 1 ? '' : 's'}
            {(day.isPast || day.isToday) && ` · ${day.done} logged`}
            {day.isFuture && ' · projected'}
          </p>
        )}

        {['AM', 'PM'].map((slot) => (
          day?.slots[slot].length > 0 && (
            <div key={slot} className="rounded-xl p-3" style={{ background: 'var(--surface2)' }}>
              <p className="mb-1.5 flex items-center gap-1 text-[10px] font-black uppercase tracking-wide"
                style={{ color: slot === 'AM' ? 'var(--amber)' : 'var(--indigo)' }}>
                {slot === 'AM' ? <Sun size={11} /> : <Moon size={11} />} {slot}
              </p>
              <SlotLines day={day} slot={slot} />
            </div>
          )
        ))}

        {day?.events.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>On this day</p>
            {day.events.map((e, i) => (
              <p key={i} className="flex items-start gap-1.5 text-xs font-bold" style={{ color: EVENT_META[e.kind].tone }}>
                <span className="shrink-0">{EVENT_META[e.kind].glyph}</span>
                <span>{e.text}{e.dose ? ` — ${formatDose(e.dose, e.unit)}` : ''}</span>
              </p>
            ))}
          </div>
        )}

        {day?.isToday && (
          <button onClick={() => { onClose(); goTo?.('today') }}
            className="btn-primary w-full rounded-xl py-2.5 text-sm font-black">
            Go to today's list to log
          </button>
        )}
        {!grouped && day?.scheduled > 1 && (
          <p className="text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
            Co-draw grouping is still loading, so each dose is counted as its own syringe here.
          </p>
        )}
      </div>
    </Modal>
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
    <div className="space-y-1.5">
      <button onClick={doExport}
        className="btn-violet flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-black">
        <CalendarPlus size={16} /> Add to phone calendar
      </button>
      {msg && <p className="text-[11px] font-bold" style={{ color: msg.ok ? 'var(--lime)' : 'var(--coral)' }}>{msg.text}</p>}
      <p className="text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
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
        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--indigo)' }}>Next 7 days</p>
        <span className="flex items-center gap-0.5 text-[10px] font-bold" style={{ color: 'var(--muted)' }}>
          Calendar <ChevronRight size={12} />
        </span>
      </div>
      <div className="flex gap-1.5">
        {cal.days.map((d) => (
          <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[9px] font-black uppercase" style={{ color: d.isToday ? 'var(--lime)' : 'var(--muted)' }}>
              {DOW[(d.weekday + 6) % 7][0]}
            </span>
            <span className="flex h-9 w-full flex-col items-center justify-center rounded-lg text-[11px] font-black"
              style={{
                background: d.scheduled === 0
                  ? 'var(--surface2)'
                  : `color-mix(in srgb, ${ADHERENCE_TONE[d.adherence]} 26%, transparent)`,
                border: d.isToday ? '1.5px solid var(--lime)' : '1px solid transparent',
                color: d.scheduled === 0 ? 'var(--muted)' : 'var(--text)',
              }}>
              {d.scheduled === 0 ? '–' : d.shots}
              {d.events.length > 0 && (
                <span className="h-1 w-1 rounded-full" style={{ background: EVENT_META[d.events[0].kind].tone }} />
              )}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
        Number of shots each day · tap for the full calendar
      </p>
    </motion.button>
  )
}
