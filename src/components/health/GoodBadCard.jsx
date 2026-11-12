import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Scale, Flag } from 'lucide-react'
import useStore from '../../store/useStore'
import { AnswerLine, InfoButton, StatusDot } from '../ui/Glance'
import { goodVsBad, goodBadAnswer, GOOD_BAD } from '../../sleep/goodBad'
import { factorName } from '../../sleep/analysis/dataset'
import { OUTLIER_WORDS, excludedNote } from '../../sleep/outliers'

const soft = { color: 'var(--text-2)' }
const muted = { color: 'var(--text-3)' }
const day = (d) => format(parseISO(d), 'EEE d MMM')

// factors that are outcomes in disguise, or bookkeeping, are not compared
const SKIP = /^(lateUseMin|audioAfterSleepMin)$/

const UNITS = { outsideAvgC: 'C', outsideMinC: 'C', bedOffMin: 'min', wakeOffMin: 'min', respDev: '/min', wristTempDev: 'C', workoutEndHour: 'h' }
const unitOf = (key) => UNITS[key] || (key.startsWith('injHours:') ? 'h' : key.startsWith('doseLevel:') ? '' : key.startsWith('daysSince:') ? 'days' : '')

/** "a workout finishing after 5 pm", "Retatrutide injection days 1 to 2" */
function phraseOf(key, names) {
  const n = factorName(key, names)
  return /^(A|An) /.test(n) ? n.charAt(0).toLowerCase() + n.slice(1) : n
}

function valueWords(f, side) {
  const v = side === 'good' ? f.good : f.bad
  if (f.kind === 'binary') return `${Math.round(v * 100)}%`
  const u = unitOf(f.key)
  return `${Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v)}${u ? ` ${u}` : ''}`
}

/** Two bars: how often (or how much) on good nights against bad nights. */
function TwoBars({ f }) {
  const max = f.kind === 'binary' ? 1 : Math.max(Math.abs(f.good), Math.abs(f.bad), 1e-9)
  const bar = (v, color, label, testid) => (
    <div className="flex items-center gap-2">
      <span className="w-[34px] shrink-0 text-[12px] font-semibold" style={muted}>{label}</span>
      <span className="relative h-2.5 min-w-0 flex-1 rounded-full" style={{ background: 'var(--surface-sunk)' }}>
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(2, (Math.abs(v) / max) * 100)}%`, background: color }} data-testid={testid} />
      </span>
      <span className="w-[58px] shrink-0 text-right text-[12px] font-semibold tabular-nums">{valueWords(f, label === 'Good' ? 'good' : 'bad')}</span>
    </div>
  )
  return (
    <div className="mt-1.5 space-y-1">
      {bar(f.good, 'var(--good)', 'Good', 'gb-bar-good')}
      {bar(f.bad, 'var(--warn)', 'Bad', 'gb-bar-bad')}
    </div>
  )
}

function FactorRow({ f, names }) {
  return (
    <div className="py-3" data-testid="gb-factor" data-key={f.key} data-label={f.label || ''}>
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[15px] font-semibold">{factorName(f.key, names)}</p>
        {f.label && <StatusDot label={f.label} />}
      </div>
      <TwoBars f={f} />
      <p className="mt-1 text-[12px] font-medium tabular-nums" style={muted}>
        {f.kind === 'binary' ? `${Math.round(f.diff * 100)} points` : `${f.diff > 0 ? '+' : ''}${f.diff.toFixed(1)}${unitOf(f.key) ? ` ${unitOf(f.key)}` : ''}`} on bad nights (95% range {f.kind === 'binary' ? `${Math.round(f.lo * 100)} to ${Math.round(f.hi * 100)}` : `${f.lo.toFixed(1)} to ${f.hi.toFixed(1)}`}), {f.nGood} good and {f.nBad} bad nights
      </p>
    </div>
  )
}

/** Insights › Sleep Lab, top card: what differs between nights with 0 or 1 wake-ups and nights with 2 or more. */
export function GoodBadCard({ lab }) {
  const excluded = useStore((s) => s.excludedNights)
  const [all, setAll] = useState(false)
  const r = useMemo(() => goodVsBad(
    lab.rows.map((row) => ({ date: row.date, wakeUps: row.outcomes.wakeUps ?? null, binary: row.binary, continuous: row.continuous })),
    (k) => SKIP.test(k),
  ), [lab.rows])
  const phrase = (k) => phraseOf(k, lab.names)
  // the five biggest differences, whatever their label; the rest behind All factors
  const top = r.factors.slice(0, GOOD_BAD.top)
  const note = excludedNote(excluded)
  return (
    <section className="space-y-2" data-testid="good-bad">
      <div className="flex items-center gap-2 px-1">
        <Scale size={18} style={soft} aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold">Good nights vs bad nights</h2>
        <InfoButton title="Good nights vs bad nights">
          <p>A good night has 0 or 1 wake-ups, a bad night 2 or more. Each factor shows how often it came before good nights and before bad ones, or its average.</p>
          <p>Lots of things are compared at once, so Clear is only given when a difference is big enough that it is unlikely to be luck (it has to pass a false discovery check at 10%, with at least 10 nights on each side). Possible means the difference shows on its own but does not pass that check. Early means fewer than 10 nights on one side.</p>
          <p>These are associations in your own nights, not causes.</p>
        </InfoButton>
      </div>
      <p className="px-1 text-[13px] font-medium tabular-nums" style={muted} data-testid="gb-counts">{r.nGood} good · {r.nBad} bad nights{note ? ` · ${note}` : ''}</p>
      <div className="card px-4 py-1">
        <AnswerLine className="py-2" testid="gb-answer">{goodBadAnswer(r, phrase)}</AnswerLine>
        <div className="rows">{top.map((f) => <FactorRow key={f.key} f={f} names={lab.names} />)}</div>
      </div>
      {r.factors.length > top.length && (
        <button onClick={() => setAll((v) => !v)} className="w-full rounded-full py-2.5 text-xs font-bold" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="gb-all">
          {all ? 'Hide all factors' : `All factors (${r.factors.length})`}
        </button>
      )}
      {all && <div className="card rows px-4 py-1" data-testid="gb-all-list">{r.factors.map((f) => <FactorRow key={f.key} f={f} names={lab.names} />)}</div>}
    </section>
  )
}

/** A flagged night: one chip with the reason and an Exclude toggle. */
export function OutlierChip({ lab, date }) {
  const o = lab.outlierBy?.get(date)
  const exclude = useStore((s) => s.excludeNight)
  const restore = useStore((s) => s.restoreNight)
  if (!o) return null
  const words = o.reasons.map((r) => OUTLIER_WORDS[r]).join(', ') || 'Excluded'
  return (
    <div className="mt-2 flex items-center gap-2" data-testid="outlier-chip">
      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
        <Flag size={12} aria-hidden="true" /> <span className="truncate">{words}</span>
      </span>
      <button onClick={() => (o.excluded ? restore(date) : exclude(date, o.reasons[0] || 'chosen'))} aria-pressed={o.excluded}
        className="shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-bold" data-testid="outlier-toggle"
        style={o.excluded ? { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' } : { color: 'var(--text-3)', border: '1px solid var(--border)' }}>
        {o.excluded ? 'Excluded' : 'Exclude'}
      </button>
    </div>
  )
}

/** Insights › Sleep Lab: flagged nights with Exclude, and the excluded nights with Restore. */
export function OutlierNights({ lab }) {
  const excluded = useStore((s) => s.excludedNights)
  const exclude = useStore((s) => s.excludeNight)
  const restore = useStore((s) => s.restoreNight)
  const flagged = (lab.outliers || []).filter((o) => o.reasons.length && !excluded?.[o.date]).sort((a, b) => b.date.localeCompare(a.date))
  const out = Object.entries(excluded || {}).sort((a, b) => b[0].localeCompare(a[0]))
  const [more, setMore] = useState(false)
  if (!flagged.length && !out.length) return null
  const shown = more ? flagged : flagged.slice(0, 5)
  return (
    <section className="space-y-2" data-testid="outlier-nights">
      <div className="flex items-center gap-2 px-1">
        <Flag size={18} style={soft} aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold">Nights that may not be typical</h2>
        <InfoButton title="Nights that may not be typical">
          <p>Flagged automatically: possibly unwell (wrist temperature 0.5 C or more over your usual, breathing rate 2 or more over your usual, or Unwell logged), under 4 hours asleep, a bedtime 3 hours or more from your usual, no heart rate from your sleep source, or a night away from home.</p>
          <p>Exclude leaves a night out of your baselines, Sleep Lab, good and bad nights and the dose comparisons. Nothing is deleted, and Restore puts it back.</p>
        </InfoButton>
      </div>
      {flagged.length > 0 && (
        <div className="card rows px-4 py-1">
          {shown.map((o) => (
            <div key={o.date} className="flex items-center gap-3 py-2.5" data-testid="outlier-row">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{day(o.date)}</span>
                <span className="block text-[13px] font-medium" style={soft}>{o.reasons.map((r) => OUTLIER_WORDS[r]).join(', ')}</span>
              </span>
              <button onClick={() => exclude(o.date, o.reasons[0])} className="shrink-0 rounded-full px-3 py-1 text-xs font-bold" style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }} data-testid="outlier-exclude">Exclude</button>
            </div>
          ))}
          {flagged.length > 5 && <button onClick={() => setMore((v) => !v)} className="w-full py-2.5 text-xs font-bold" style={soft}>{more ? 'Show fewer' : `Show all ${flagged.length}`}</button>}
        </div>
      )}
      {out.length > 0 && (
        <div className="card rows px-4 py-1" data-testid="excluded-nights">
          <p className="py-2 text-[13px] font-semibold" style={muted}>Excluded nights ({out.length})</p>
          {out.map(([d, v]) => (
            <div key={d} className="flex items-center gap-3 py-2.5" data-testid="excluded-row">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{day(d)}</span>
                <span className="block text-[13px] font-medium" style={soft}>{OUTLIER_WORDS[v?.reason] || 'Chosen by you'}</span>
              </span>
              <button onClick={() => restore(d)} className="shrink-0 rounded-full px-3 py-1 text-xs font-bold" style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }} data-testid="excluded-restore">Restore</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
