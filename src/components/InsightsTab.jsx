import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles, TrendingUp, TrendingDown, Info, Lock, ChevronDown, ChevronRight, X,
  CalendarRange, ArrowRight, Syringe, Ruler, AlertCircle,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import { buildInsights, topInsight, INSIGHTS_CAVEAT } from '../lib/insights'
import { buildRecap, weekBounds, shouldSurfaceRecap, RECAP_CAVEAT } from '../lib/recap'

const TONE = {
  good: { color: 'var(--lime)', Icon: TrendingUp },
  watch: { color: 'var(--amber)', Icon: AlertCircle },
  neutral: { color: 'var(--indigo)', Icon: Info },
}

const COMING_ICON = {
  'step-up': TrendingUp, 'cycle-on': CalendarRange, 'cycle-off': CalendarRange, restock: Syringe,
}

/** Everything the screens here need, assembled once. */
export function useInsightCtx() {
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const doseLogs = useStore((s) => s.doseLogs)
  const symptomLogs = useStore((s) => s.symptomLogs)
  const measurements = useStore((s) => s.measurements)
  const vials = useStore((s) => s.vials)
  const openVials = useStore((s) => s.openVials)
  const t = todayStr()
  return useMemo(
    () => ({ peptides, titration, doseLogs, symptomLogs, measurements, vials, openVials, todayStr: t }),
    [peptides, titration, doseLogs, symptomLogs, measurements, vials, openVials, t]
  )
}

export function InsightCard({ card, i = 0 }) {
  const tone = TONE[card.tone] || TONE.neutral
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.05, 0.3) }}
      className="card p-4" data-testid="insight-card">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `color-mix(in srgb, ${tone.color} 18%, transparent)`, color: tone.color }}>
          <tone.Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black leading-snug">{card.title}</p>
          <p className="mt-1 text-[12px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
            {card.body}
          </p>
          <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            {card.evidence}
          </p>
        </div>
      </div>
    </motion.div>
  )
}

export default function InsightsTab() {
  const ctx = useInsightCtx()
  const { readiness, cards } = useMemo(() => buildInsights(ctx), [ctx])
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? cards : cards.slice(0, 6)

  return (
    <div className="space-y-3" data-testid="insights-view">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
          <Sparkles size={22} style={{ color: 'var(--violet)' }} /> Insights
        </h1>
        <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          Patterns in your own logs
        </p>
      </div>

      {/* the framing sits above the findings, not below them */}
      <div className="card p-3" data-testid="insights-caveat"
        style={{ background: 'color-mix(in srgb, var(--indigo) 10%, var(--surface))' }}>
        <p className="flex gap-2 text-[11px] font-semibold leading-relaxed" style={{ color: 'var(--muted)' }}>
          <Info size={14} className="mt-px shrink-0" style={{ color: 'var(--indigo)' }} />
          {INSIGHTS_CAVEAT}
        </p>
      </div>

      {cards.length === 0 && (
        <div className="card p-5 text-center" data-testid="insights-locked">
          <Lock size={20} className="mx-auto mb-2" style={{ color: 'var(--muted)' }} />
          <p className="text-sm font-black">Not enough logged yet</p>
          <p className="mt-1 text-[12px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
            Insights only appear once there's enough of your own data behind them. An empty
            screen means "not enough yet", never "nothing is happening".
          </p>
          {readiness.missing.length > 0 && (
            <ul className="mt-3 space-y-1 text-left">
              {readiness.missing.map((m) => (
                <li key={m} className="flex items-start gap-1.5 text-[11px] font-bold">
                  <span style={{ color: 'var(--violet)' }}>·</span> {m}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {shown.map((c, i) => <InsightCard key={c.id} card={c} i={i} />)}

      {cards.length > 6 && !showAll && (
        <button onClick={() => setShowAll(true)}
          className="flex w-full items-center justify-center gap-1 rounded-xl py-2.5 text-xs font-black"
          style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>
          <ChevronDown size={14} /> {cards.length - 6} more
        </button>
      )}

      {cards.length > 0 && (
        <p className="px-1 pb-1 text-[10px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
          Observations only — no compound here has been shown to work, or not work, for you.
          That question needs more than a phone app.
        </p>
      )}
    </div>
  )
}

// ------------------------------------------------------------------- recap

export function RecapTab() {
  const ctx = useInsightCtx()
  const w = weekBounds(ctx.todayStr)
  // Once the week has turned, the completed week is the one worth reading.
  const [period, setPeriod] = useState(w.dayOfWeek <= 1 ? 'last' : 'week')
  const recap = useMemo(() => buildRecap(ctx, { period }), [ctx, period])
  const { adherence, body, symptoms, coming, range } = recap

  return (
    <div className="space-y-3" data-testid="recap-view">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
          <CalendarRange size={22} style={{ color: 'var(--lime)' }} /> Your week
        </h1>
        <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          {format(parseISO(range.from), 'd MMM')} – {format(parseISO(range.to), 'd MMM')}
        </p>
      </div>

      <div className="flex gap-1.5">
        {[{ id: 'week', label: 'This week' }, { id: 'last', label: 'Last week' }].map((o) => (
          <button key={o.id} onClick={() => setPeriod(o.id)}
            className="flex-1 rounded-lg py-1.5 text-xs font-black"
            style={period === o.id
              ? { backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff' }
              : { background: 'var(--surface2)', color: 'var(--muted)' }}>
            {o.label}
          </button>
        ))}
      </div>

      {recap.empty && (
        <div className="card p-5 text-center text-sm font-medium" style={{ color: 'var(--muted)' }}>
          Nothing logged in this period yet.
        </div>
      )}

      {adherence && (
        <div className="card p-4" data-testid="recap-adherence">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-bold">Doses taken</p>
            <span className="text-2xl font-black tabular-nums"
              style={{ color: adherence.pct >= 80 ? 'var(--lime)' : adherence.pct >= 50 ? 'var(--amber)' : 'var(--coral)' }}>
              {adherence.pct}%
            </span>
          </div>
          <p className="text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
            {adherence.taken} of {adherence.scheduled} scheduled
            {adherence.delta != null && adherence.delta !== 0 && (
              <> · {adherence.delta > 0 ? '+' : ''}{adherence.delta} points on the week before</>
            )}
          </p>
          {adherence.missed.length > 0 && (
            <p className="mt-2 text-[11px] font-bold" style={{ color: 'var(--amber)' }}>
              Short: {adherence.missed.map((m) => `${m.name} (${m.short})`).join(' · ')}
            </p>
          )}
        </div>
      )}

      {body.length > 0 && (
        <div className="card p-4" data-testid="recap-body">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
            <Ruler size={14} style={{ color: 'var(--violet)' }} /> Body
          </p>
          <div className="space-y-1.5">
            {body.map((b) => (
              <div key={b.key} className="flex items-center justify-between text-[12px] font-bold">
                <span>{b.label}</span>
                <span className="tabular-nums" style={{ color: b.better ? 'var(--lime)' : 'var(--amber)' }}>
                  {b.diff > 0 ? '+' : ''}{b.diff}{b.unit} → {b.value}{b.unit}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
            Measured against your last reading before this period.
          </p>
        </div>
      )}

      {symptoms.checkins > 0 && (
        <div className="card p-4" data-testid="recap-symptoms">
          <p className="mb-2 text-sm font-bold">Symptoms · {symptoms.checkins} check-in{symptoms.checkins === 1 ? '' : 's'}</p>
          {symptoms.moved.length > 0 ? (
            <div className="space-y-1.5">
              {symptoms.moved.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2 text-[12px] font-bold">
                  <span className="min-w-0 flex-1 truncate">{m.label}</span>
                  <span className="flex shrink-0 items-center gap-1 tabular-nums"
                    style={{ color: m.better ? 'var(--lime)' : 'var(--amber)' }}>
                    {m.up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {m.days}d <span style={{ color: 'var(--muted)' }}>from {m.prevDays}d</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] font-medium" style={{ color: 'var(--muted)' }}>
              {symptoms.top.length
                ? `Most logged: ${symptoms.top.map((t) => `${t.label} (${t.days}d)`).join(' · ')}`
                : 'No symptoms tagged this period.'}
            </p>
          )}
        </div>
      )}

      {coming.length > 0 && (
        <div className="card p-4" data-testid="recap-coming">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
            <ArrowRight size={14} style={{ color: 'var(--lime)' }} /> Coming up
          </p>
          <div className="space-y-2">
            {coming.map((c) => {
              const Icon = COMING_ICON[c.kind] || CalendarRange
              return (
                <div key={c.id} className="flex items-center gap-2.5">
                  <Icon size={14} className="shrink-0" style={{ color: c.kind === 'restock' ? 'var(--amber)' : 'var(--indigo)' }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-bold">{c.label}</p>
                    <p className="text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>{c.detail}</p>
                  </div>
                  <span className="shrink-0 text-[10px] font-black tabular-nums" style={{ color: 'var(--muted)' }}>
                    {c.inDays === 0 ? 'today' : `${c.inDays}d`}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <p className="px-1 pb-1 text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
        {RECAP_CAVEAT}
      </p>
    </div>
  )
}

// --------------------------------------------------------------- Home cards

/**
 * One line on Home, and only when the data has actually produced something.
 * A card that is always there stops being read, so this one is often absent.
 */
export function HomeInsightCard({ goTo }) {
  const ctx = useInsightCtx()
  const card = useMemo(() => topInsight(ctx), [ctx])
  if (!card) return null
  const tone = TONE[card.tone] || TONE.neutral

  return (
    <motion.button layout whileTap={{ scale: 0.98 }} onClick={() => goTo('insights')}
      className="card flex w-full items-center gap-3 p-3.5 text-left" data-testid="home-insight">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
        style={{ background: `color-mix(in srgb, ${tone.color} 18%, transparent)`, color: tone.color }}>
        <Sparkles size={17} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--violet)' }}>
          From your logs
        </p>
        <p className="truncate text-[13px] font-black leading-snug">{card.title}</p>
      </div>
      <ChevronRight size={16} className="shrink-0" style={{ color: 'var(--muted)' }} />
    </motion.button>
  )
}

/** "Your week" — appears at the turn of the week or just after a cycle flips. */
export function HomeRecapCard({ goTo }) {
  const ctx = useInsightCtx()
  const recapSeen = useStore((s) => s.recapSeen)
  const markRecapSeen = useStore((s) => s.markRecapSeen)
  const surfaced = useMemo(() => shouldSurfaceRecap(ctx, recapSeen), [ctx, recapSeen])
  if (!surfaced) return null
  const { recap, reason } = surfaced
  const body = recap.body[0]

  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="card overflow-hidden p-4" data-testid="home-recap"
      style={{ backgroundImage: 'linear-gradient(135deg, color-mix(in srgb, var(--lime) 12%, var(--surface)), var(--surface))' }}>
      <div className="flex items-start gap-2">
        <CalendarRange size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--lime)' }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black">Your week</p>
          <p className="text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
            {reason === 'cycle' ? `${surfaced.recap.boundary.name} just changed cycle` : recap.headline}
          </p>
        </div>
        <button onClick={() => markRecapSeen(surfaced.periodId)} aria-label="Dismiss weekly recap"
          className="shrink-0 rounded-full p-1" style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>
          <X size={13} />
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold">
        {recap.adherence && (
          <span>{recap.adherence.pct}%<span className="font-medium" style={{ color: 'var(--muted)' }}> doses</span></span>
        )}
        {recap.symptoms.checkins > 0 && (
          <span>{recap.symptoms.checkins}<span className="font-medium" style={{ color: 'var(--muted)' }}> check-ins</span></span>
        )}
        {body && (
          <span>{body.diff > 0 ? '+' : ''}{body.diff}{body.unit}
            <span className="font-medium" style={{ color: 'var(--muted)' }}> {body.label.toLowerCase()}</span></span>
        )}
        {recap.coming.length > 0 && (
          <span>{recap.coming.length}<span className="font-medium" style={{ color: 'var(--muted)' }}> coming up</span></span>
        )}
      </div>

      <button onClick={() => goTo('recap')}
        className="mt-3 flex w-full items-center justify-center gap-1 rounded-xl py-2 text-xs font-black"
        style={{ background: 'var(--surface2)' }}>
        See the week <ChevronRight size={13} />
      </button>
    </motion.div>
  )
}
