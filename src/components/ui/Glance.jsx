import { useState } from 'react'
import { Info, ChevronRight } from 'lucide-react'
import Modal from './Modal'
import { chip, statusOf, STATUS_LEGEND, TONE_COLOR, richParts } from '../../lib/glance'

// The shared easy-to-read pieces. Every card leads with one answer line, numbers
// are bold with small grey units, changes are stat rows with a coloured delta
// chip, the long change labels are a dot and one word, caveats sit behind (i)
// and locked items collapse into one progress row. Three text levels only:
// headline (17 to 20, semibold, white), key numbers (large, tabular), supporting
// (14, grey, one line).

/** A sentence with its numbers bold and white and their units small and grey. */
export function Rich({ text, numColor = 'var(--text)' }) {
  if (text == null) return null
  if (typeof text !== 'string') return text
  return (
    <>
      {richParts(text).map((p, i) => (p.t === 'text'
        ? <span key={i}>{p.v}</span>
        : (
          <span key={i} className="whitespace-nowrap">
            <b className="font-semibold tabular-nums" style={{ color: numColor }}>{p.v}</b>
            {p.unit && <span className="text-[0.82em] font-medium" style={{ color: 'var(--text-3)' }}>{p.unit}</span>}
          </span>
        )))}
    </>
  )
}

/** The one short bold answer a card leads with. */
export function AnswerLine({ children, className = '', testid }) {
  return (
    <p className={`text-[17px] font-semibold leading-snug ${className}`} style={{ color: 'var(--text)', maxWidth: '60ch' }} data-testid={testid || 'answer-line'}>
      {typeof children === 'string' ? <Rich text={children} /> : children}
    </p>
  )
}

/** Supporting text: 14, grey, one line. */
export function Support({ children, className = '', clamp = true }) {
  return (
    <p className={`text-sm font-medium leading-snug ${clamp ? 'truncate' : ''} ${className}`} style={{ color: 'var(--text-2)' }}>
      {typeof children === 'string' ? <Rich text={children} numColor="var(--text-2)" /> : children}
    </p>
  )
}

/** A number with its unit smaller and grey. */
export function Num({ value, unit, size = 'md', color = 'var(--text)' }) {
  const cls = size === 'xl' ? 't-metric' : size === 'lg' ? 'text-[26px] font-extrabold tracking-tight' : 'text-[17px] font-semibold'
  return (
    <span className="whitespace-nowrap tabular-nums" data-testid="num">
      <span className={cls} style={{ color }}>{value ?? '–'}</span>
      {unit && <span className="ml-0.5 text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>{unit}</span>}
    </span>
  )
}

/** "▲ 26 ms" coloured by whether that direction is better for this metric. */
export function DeltaChip({ metric, delta, unit = '', dp = 0, tone: forced, text: forcedText }) {
  const c = forcedText ? { text: forcedText, tone: forced || 'same' } : chip(metric, delta, unit, dp)
  if (!c || !c.text) return null
  const tone = forced || c.tone
  const color = TONE_COLOR[tone]
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[13px] font-semibold tabular-nums"
      style={{ color, background: tone === 'same' ? 'var(--surface-sunk)' : `color-mix(in srgb, ${color} 14%, transparent)` }}
      data-testid="delta-chip" data-tone={tone}
    >
      {c.text}
    </span>
  )
}

const DOT = {
  Clear: { fill: 'var(--good)', ring: null },
  Possible: { fill: 'color-mix(in srgb, var(--good) 45%, transparent)', ring: null },
  Normal: { fill: 'var(--text-3)', ring: null },
  Early: { fill: 'transparent', ring: 'var(--text-3)' },
}

/** A small dot and one word: Clear, Possible, Normal, Early. Takes any engine label. */
export function StatusDot({ label, status: given, word = true }) {
  const status = given || statusOf(label)
  const d = DOT[status]
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-semibold" style={{ color: status === 'Clear' ? 'var(--text)' : 'var(--text-2)' }} data-testid="status-dot" data-status={status}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 99, background: d.fill, boxShadow: d.ring ? `inset 0 0 0 1.5px ${d.ring}` : undefined }} />
      {word && status}
    </span>
  )
}

/** The (i) button; its sheet holds the caveats and explanations. */
export function InfoButton({ title = 'About this', children, label, testid }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true) }} className="inline-flex shrink-0 items-center justify-center rounded-full"
        style={{ width: 28, height: 28, color: 'var(--text-3)' }} aria-label={label || `About ${title}`} data-testid={testid || 'info-button'}>
        <Info size={16} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <div className="space-y-3 pb-2 text-sm font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>{children}</div>
      </Modal>
    </>
  )
}

/** The legend for the four status words, once per screen. */
export function StatusLegend({ extra }) {
  return (
    <div className="space-y-2.5" data-testid="status-legend">
      {STATUS_LEGEND.map(([s, words]) => (
        <div key={s} className="flex items-start gap-3">
          <span className="w-20 pt-0.5"><StatusDot status={s} /></span>
          <span>{words}</span>
        </div>
      ))}
      {extra}
    </div>
  )
}

/** Section heading with its icon and an optional (i). */
export function SectionTitle({ icon: Icon, title, info, infoTitle, right, className = '' }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {Icon && <Icon size={18} style={{ color: 'var(--text-2)' }} aria-hidden="true" />}
      <h3 className="min-w-0 flex-1 truncate text-[17px] font-semibold" style={{ color: 'var(--text)' }}>{title}</h3>
      {right}
      {info && <InfoButton title={infoTitle || title}>{info}</InfoButton>}
    </div>
  )
}

/**
 * Label left, value right, delta chip after it. `from` and `to` make "65 → 67".
 * `status` adds the dot and word on the line below the label.
 */
export function StatRow({ label, value, unit, from, to, dp, metric, delta, deltaUnit, deltaDp = 0, chipText, chipTone, status, sub, onClick, testid }) {
  const fmt = (v) => (v == null ? '–' : typeof v === 'number' && dp != null ? String(Number(v.toFixed(dp))) : v)
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium" style={{ color: 'var(--text)' }}>{label}</p>
        {(status || sub) && (
          <div className="mt-0.5 flex items-center gap-2">
            {status && <StatusDot label={status} />}
            {sub && <span className="truncate text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>{sub}</span>}
          </div>
        )}
      </div>
      {(from !== undefined || value != null) && <span className="shrink-0 whitespace-nowrap tabular-nums text-[17px] font-semibold" data-testid="stat-value">
        {from !== undefined
          ? <>{<span style={{ color: 'var(--text-2)' }}>{fmt(from)}</span>}<span className="mx-1" style={{ color: 'var(--text-3)' }}>→</span>{fmt(to)}</>
          : fmt(value)}
        {unit && <span className="ml-0.5 text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>{unit}</span>}
      </span>}
      {(delta != null || chipText) && <DeltaChip metric={metric} delta={delta} unit={deltaUnit} dp={deltaDp} text={chipText} tone={chipTone} />}
      {onClick && <ChevronRight size={16} style={{ color: 'var(--text-3)' }} className="shrink-0" />}
    </>
  )
  const cls = 'flex w-full items-center gap-3 py-3 text-left'
  return onClick
    ? <button type="button" onClick={onClick} className={cls} data-testid={testid || 'stat-row'}>{body}</button>
    : <div className={cls} data-testid={testid || 'stat-row'}>{body}</div>
}

/** One row for everything still locked in a section: words and a thin bar. */
export function ProgressRow({ text, have, need, testid }) {
  const pct = need ? Math.min(1, Math.max(0, have / need)) : 0
  return (
    <div className="py-2" data-testid={testid || 'progress-row'}>
      <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>{text}</p>
      {need > 0 && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunk)' }}>
          <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: 'var(--text-3)' }} />
        </div>
      )}
    </div>
  )
}

/** A card that leads with an answer. Icon and title, the answer, then whatever follows. */
export function GlanceCard({ icon, title, answer, info, infoTitle, right, children, testid, className = '' }) {
  return (
    <section className={`card p-4 ${className}`} data-testid={testid}>
      {(title || icon) && <SectionTitle icon={icon} title={title} info={info} infoTitle={infoTitle} right={right} />}
      {answer && <AnswerLine className={title ? 'mt-2' : ''}>{answer}</AnswerLine>}
      {children && <div className={title || answer ? 'mt-3' : ''}>{children}</div>}
    </section>
  )
}
