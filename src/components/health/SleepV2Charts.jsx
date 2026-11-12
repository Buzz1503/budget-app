import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { clockOf } from '../../health/engine/sleepView'
import { DeltaChip } from '../ui/Glance'
import { hm } from '../../sleep/tabView'

const W = 340
const TONE = { better: 'var(--accent)', worse: 'var(--amber)', same: 'var(--text-2)' }
const soft = { color: 'var(--text-2)' }
const muted = { color: 'var(--text-3)' }
const short = (d) => format(parseISO(d), 'd MMM')

/** "+12" / "−0.4" with the metric's unit for the chip */
const signed = (v, dp, unit) => (v == null ? null : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}${unit ? (unit === '°' ? unit : ` ${unit}`) : ''}`)

/**
 * One metric against your normal: the soft band is the middle 80% of the 28
 * nights before, the dot is last night (green the better way, amber the
 * other, grey inside the band). Value and change from your median on the right.
 */
export function RangeRow({ row, format: fmt, chipUnit, chipText, onOpen, extra }) {
  const has = row.value != null
  const band = row.lo != null && row.hi != null
  const vals = [row.value, row.lo, row.hi, extra?.value].filter((v) => v != null)
  const lo = vals.length ? Math.min(...vals) : 0
  const hi = vals.length ? Math.max(...vals) : 1
  const pad = (hi - lo) * 0.25 || Math.abs(hi) * 0.05 || 1
  const x = (v) => `${((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100}%`
  const show = (v) => (fmt ? fmt(v) : Number(v).toFixed(row.dp))
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 py-2.5 text-left" data-testid={`normal-${row.key}`} data-tone={row.tone}>
      <span className="w-[120px] shrink-0">
        <span className="block truncate text-[15px] font-medium">{row.label}</span>
        <span className="block truncate text-[13px] font-medium tabular-nums" style={muted}>
          {band ? (() => { const r = `${show(row.lo)} to ${show(row.hi)}`; return row.basis === 'reference' ? `Good: ${r}` : r.length > 13 ? r : `${r} usual` })() : row.n ? `Needs 7 nights, ${row.n} so far` : 'Not recorded yet'}
        </span>
      </span>
      <span className="relative h-5 min-w-0 flex-1" aria-hidden="true">
        <span className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full" style={{ background: 'var(--surface-sunk)' }} />
        {band && <span className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full" style={{ left: x(row.lo), width: `calc(${x(row.hi)} - ${x(row.lo)})`, background: 'var(--text)', opacity: 0.14 }} data-testid="normal-band" />}
        {extra?.value != null && <span className="absolute top-1/2 h-4 w-[2px] -translate-y-1/2" style={{ left: x(extra.value), background: 'var(--text-3)' }} title={extra.label} data-testid="normal-marker" />}
        {has && <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: x(row.value), background: TONE[row.tone], boxShadow: '0 0 0 2px var(--surface-solid)' }} data-testid="normal-dot" />}
      </span>
      <span className="w-[54px] shrink-0 whitespace-nowrap text-right text-[15px] font-semibold tabular-nums">{has ? show(row.value) : '–'}</span>
      <span className="w-[64px] shrink-0 text-right">
        {chipText ? <DeltaChip text={chipText} tone={row.tone} /> : row.delta != null && Math.abs(row.delta) > 0 && <DeltaChip text={signed(row.delta, row.dp, chipUnit)} tone={row.tone} />}
      </span>
    </button>
  )
}

const STAGE_FILL = { awake: 'var(--stage-awake)', rem: 'var(--stage-rem)', core: 'var(--stage-core)', deep: 'var(--stage-deep)' }
const STAGE_ORDER = ['awake', 'rem', 'core', 'deep']

/** The night's stages as one bar, minutes and share under each, with a marker for your usual share. */
export function StagesBar({ stats }) {
  const by = Object.fromEntries(stats.map((s) => [s.key, s]))
  const total = STAGE_ORDER.reduce((t, k) => t + (by[k]?.min || 0), 0) || 1
  let acc = 0
  const left = {}
  for (const k of STAGE_ORDER) { left[k] = acc; acc += ((by[k]?.min || 0) / total) * 100 }
  // usual share of the whole night, from each stage's usual share
  const usualTotal = STAGE_ORDER.reduce((t, k) => t + (by[k]?.avgPct ?? 0), 0)
  return (
    <div data-testid="stages-bar">
      <div className="relative flex h-5 w-full overflow-hidden rounded-full" role="img" aria-label="Sleep stages as one bar">
        {STAGE_ORDER.map((k) => (
          <span key={k} style={{ width: `${((by[k]?.min || 0) / total) * 100}%`, background: STAGE_FILL[k] }} data-testid={`stages-bar-${k}`} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {STAGE_ORDER.map((k) => {
          const s = by[k]
          if (!s) return <span key={k} />
          const pctNight = Math.round((s.min / total) * 100)
          const usual = usualTotal && s.avgPct != null ? Math.round((s.avgPct / usualTotal) * 100) : null
          return (
            <div key={k} data-testid={`stage-cell-${k}`}>
              <p className="flex items-center gap-1.5 text-[13px] font-semibold" style={soft}><span className="h-2 w-2 rounded-full" style={{ background: STAGE_FILL[k] }} />{s.label}</p>
              <p className="text-[15px] font-semibold tabular-nums">{s.min < 60 ? `${s.min} m` : hm(s.min)}</p>
              <p className="text-[13px] font-medium tabular-nums" style={muted}>{pctNight}%{usual != null ? `, usual ${usual}%` : ''}</p>
              {usual != null && (
                <div className="relative mt-1 h-1.5 rounded-full" style={{ background: 'var(--surface-sunk)' }}>
                  <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, pctNight * 1.6)}%`, background: STAGE_FILL[k] }} />
                  <span className="absolute -inset-y-0.5 w-[2px]" style={{ left: `${Math.min(100, usual * 1.6)}%`, background: 'var(--text)' }} data-testid="stage-usual" />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Time asleep per night as bars with your need as a line; nights under it in amber. Tap a bar for its value. */
export function NeedBarsChart({ bars, needH, answer }) {
  const [sel, setSel] = useState(null)
  if (!bars.length) return null
  const L = 34
  const R = 6
  const top = 24
  const H = 204
  const bottom = 22
  const hiH = Math.ceil(Math.max(needH + 1, ...bars.map((b) => b.h)))
  const loH = Math.max(0, Math.floor(Math.min(needH - 2, ...bars.map((b) => b.h))))
  const y = (h) => top + (1 - (h - loH) / (hiH - loH || 1)) * (H - top - bottom)
  const bw = (W - L - R) / bars.length
  const ticks = []
  for (let h = loH; h <= hiH; h += hiH - loH > 6 ? 2 : 1) ticks.push(h)
  const s = sel != null ? bars[sel] : null
  return (
    <div data-testid="need-chart">
      <p className="text-[17px] font-semibold">Am I sleeping enough?</p>
      <p className="text-[15px] font-semibold tabular-nums" data-testid="need-answer">{answer}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full select-none" role="img" aria-label="Time asleep per night against your need">
        <text x={2} y={9} fontSize="11.5" fontWeight="700" fill="var(--text-3)">hours</text>
        <text x={W - R} y={9} fontSize="11.5" fontWeight="700" fill="var(--text-3)" textAnchor="end">↑ better, up to your need</text>
        {ticks.map((h) => (
          <g key={h}>
            <line x1={L} x2={W - R} y1={y(h)} y2={y(h)} stroke="var(--border)" strokeWidth="1" />
            <text x={L - 5} y={y(h) + 4} fontSize="12" fontWeight="600" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{h}</text>
          </g>
        ))}
        {bars.map((b, i) => (
          <rect key={b.date} x={L + i * bw + bw * 0.18} width={Math.max(2, bw * 0.64)} y={y(b.h)} height={Math.max(1, y(loH) - y(b.h))} rx="3"
            fill={b.under ? 'var(--amber)' : 'var(--series-sleep)'} opacity={sel == null || sel === i ? 0.9 : 0.45}
            onClick={() => setSel(sel === i ? null : i)} style={{ cursor: 'pointer' }} data-testid="need-bar" data-under={b.under ? 'true' : 'false'} />
        ))}
        <line x1={L} x2={W - R} y1={y(needH)} y2={y(needH)} stroke="var(--text)" strokeWidth="1.5" strokeDasharray="5 4" data-testid="need-line" />
        <text x={L} y={H - 5} fontSize="12" fontWeight="600" fill="var(--text-3)">{short(bars[0].date)}</text>
        <text x={W - R} y={H - 5} fontSize="12" fontWeight="600" fill="var(--text-3)" textAnchor="end">{short(bars[bars.length - 1].date)}</text>
      </svg>
      <p className="min-h-[18px] text-[13px] font-medium tabular-nums" style={soft} data-testid="need-readout">
        {s ? `${short(s.date)}: ${hm(s.h * 60)} asleep, ${s.under ? `${hm((needH - s.h) * 60)} under` : 'at or over'} your ${needH} h` : 'Tap a bar for its night.'}
      </p>
      <div className="flex gap-4 text-[13px] font-medium" style={soft}>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--series-sleep)' }} />Asleep</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--amber)' }} />Under need</span>
        <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: 'var(--text)' }} />Your {needH} h need</span>
      </div>
    </div>
  )
}

/** Bed to wake per night as floating bars, so a steady window reads at a glance. Tap a bar for its times. */
export function WindowChart({ nights, answer }) {
  const [sel, setSel] = useState(null)
  if (!nights.length) return null
  const L = 46
  const R = 6
  const top = 26
  const H = 222
  const bottom = 22
  const lo = Math.floor(Math.min(...nights.map((n) => n.bedFromNoon)) / 60) * 60
  const hi = Math.ceil(Math.max(...nights.map((n) => n.wakeFromNoon)) / 60) * 60
  const y = (m) => top + ((m - lo) / (hi - lo || 1)) * (H - top - bottom)
  const bw = (W - L - R) / nights.length
  const ticks = []
  for (let m = lo; m <= hi; m += 120) ticks.push(m)
  const s = sel != null ? nights[sel] : null
  return (
    <div data-testid="window-chart">
      <p className="text-[17px] font-semibold">Is my sleep window steady?</p>
      <p className="text-[15px] font-semibold tabular-nums" data-testid="window-answer">{answer}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full select-none" role="img" aria-label="Bedtime to wake time per night">
        <text x={2} y={10} fontSize="11.5" fontWeight="700" fill="var(--text-3)">time</text>
        <text x={W - R} y={10} fontSize="11.5" fontWeight="700" fill="var(--text-3)" textAnchor="end">steadier is better</text>
        {ticks.map((m) => (
          <g key={m}>
            <line x1={L} x2={W - R} y1={y(m)} y2={y(m)} stroke="var(--border)" strokeWidth="1" />
            <text x={L - 5} y={y(m) + 4} fontSize="12" fontWeight="600" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{clockOf(m)}</text>
          </g>
        ))}
        {nights.map((n, i) => (
          <rect key={n.date} x={L + i * bw + bw * 0.2} width={Math.max(2, bw * 0.6)} y={y(n.bedFromNoon)} height={Math.max(2, y(n.wakeFromNoon) - y(n.bedFromNoon))} rx="3"
            fill="var(--series-sleep)" opacity={sel == null || sel === i ? 0.8 : 0.4} onClick={() => setSel(sel === i ? null : i)} style={{ cursor: 'pointer' }} data-testid="window-bar" />
        ))}
        <text x={L} y={H - 5} fontSize="12" fontWeight="600" fill="var(--text-3)">{short(nights[0].date)}</text>
        <text x={W - R} y={H - 5} fontSize="12" fontWeight="600" fill="var(--text-3)" textAnchor="end">{short(nights[nights.length - 1].date)}</text>
      </svg>
      <p className="min-h-[18px] text-[13px] font-medium tabular-nums" style={soft} data-testid="window-readout">
        {s ? `${short(s.date)}: bed ${clockOf(s.bedFromNoon)}, up ${clockOf(s.wakeFromNoon)}` : 'Tap a bar for its times.'}
      </p>
    </div>
  )
}
