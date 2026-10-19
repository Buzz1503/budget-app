import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { segmentChanges, symmetry, evoltScans } from '../../body/composition'

const TONE = { good: 'var(--accent)', bad: 'var(--amber)', neutral: 'var(--text-3)' }

// A plain front-facing figure drawn from simple shapes. The figure faces you,
// so the left arm and leg are on the right of the picture.
const REGIONS = {
  torso: { shape: <rect x="62" y="54" width="56" height="86" rx="16" />, label: { x: 90, y: 100, anchor: 'middle' } },
  rightArm: { shape: <rect x="38" y="58" width="18" height="78" rx="9" />, label: { x: 30, y: 98, anchor: 'end' } },
  leftArm: { shape: <rect x="124" y="58" width="18" height="78" rx="9" />, label: { x: 150, y: 98, anchor: 'start' } },
  rightLeg: { shape: <rect x="64" y="146" width="24" height="98" rx="11" />, label: { x: 56, y: 200, anchor: 'end' } },
  leftLeg: { shape: <rect x="92" y="146" width="24" height="98" rx="11" />, label: { x: 124, y: 200, anchor: 'start' } },
}

const pctWords = (v) => (v == null ? 'no reading' : Math.abs(v) < 0.5 ? 'even' : `${Math.abs(v).toFixed(1)}% ${v > 0 ? 'more on the left' : 'more on the right'}`)

/**
 * Lean or fat in each of five regions from the latest Evolt scan, with the
 * change since the first scan. Colour says which way it went: lean up or fat
 * down in the accent, the opposite in amber, under 0.1 kg neutral.
 */
export default function SegmentMap({ measurements }) {
  const [kind, setKind] = useState('Lean')
  const segs = segmentChanges(measurements, kind)
  const scans = evoltScans(measurements)
  const latest = scans[scans.length - 1]
  if (!latest || segs.every((s) => s.latest == null)) return null
  const sym = symmetry(latest)
  const by = Object.fromEntries(segs.map((s) => [s.key, s]))
  const k = kind.toLowerCase()

  return (
    <section className="card p-4" data-testid="segment-map">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-base font-black">Where it is</h2>
        <div className="flex gap-1 rounded-full p-1" style={{ background: 'var(--surface-sunk)' }} role="group" aria-label="Show lean or fat">
          {['Lean', 'Fat'].map((x) => (
            <button key={x} onClick={() => setKind(x)} aria-pressed={kind === x} data-testid={`segment-kind-${x.toLowerCase()}`}
              className="min-h-[30px] rounded-full px-3 text-xs font-bold"
              style={kind === x ? { background: 'var(--surface2)', color: 'var(--text)' } : { color: 'var(--text-3)' }}>{x}</button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>{kind} by region, {format(parseISO(latest.date), 'd MMM yyyy')}. Change since your first scan.</p>
      <svg viewBox="0 0 180 252" className="mx-auto mt-3 block w-full max-w-[300px]" role="img" aria-label={`${kind} by body region`}>
        <circle cx="90" cy="30" r="18" fill="var(--surface-sunk)" />
        {Object.entries(REGIONS).map(([key, r]) => {
          const s = by[key]
          return (
            <g key={key} data-testid={`segment-${key}`} data-tone={s?.tone}>
              <g fill={s?.tone && s.tone !== 'neutral' ? TONE[s.tone] : 'var(--surface2)'} fillOpacity={s?.tone && s.tone !== 'neutral' ? 0.28 : 1}
                stroke={s?.tone ? TONE[s.tone] : 'var(--border)'} strokeWidth="1.2">{r.shape}</g>
              {s?.latest != null && (
                <text x={r.label.x} y={r.label.y} textAnchor={r.label.anchor} fontSize="9" fontWeight="800" fill="var(--text)" className="tabular-nums">
                  {s.latest.toFixed(2)}
                  <tspan x={r.label.x} dy="11" fontSize="8" fontWeight="700" fill={TONE[s.tone]}>{s.delta == null ? '' : `${s.delta > 0 ? '+' : ''}${s.delta.toFixed(2)}`}</tspan>
                </text>
              )}
            </g>
          )
        })}
        <text x="90" y="250" fontSize="7" fontWeight="700" textAnchor="middle" fill="var(--text-3)">kg · facing you: your left is on the right</text>
      </svg>
      <div className="mt-3 rows text-xs" data-testid="segment-symmetry">
        <div className="flex items-baseline gap-2 py-2">
          <span className="min-w-0 flex-1 font-bold">Arms, left against right</span>
          <span className="font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>{pctWords(sym.arms[k])}</span>
        </div>
        <div className="flex items-baseline gap-2 py-2">
          <span className="min-w-0 flex-1 font-bold">Legs, left against right</span>
          <span className="font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>{pctWords(sym.legs[k])}</span>
        </div>
        {latest.balance && (
          <div className="flex items-baseline gap-2 py-2" data-testid="segment-balance">
            <span className="min-w-0 flex-1 font-bold">Evolt balance</span>
            <span className="font-medium" style={{ color: 'var(--text-2)' }}>
              Upper and lower {String(latest.balance.upperLower || '–').toLowerCase()}, left and right {String(latest.balance.leftRight || '–').toLowerCase()}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}
