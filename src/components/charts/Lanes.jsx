import { useMemo } from 'react'
import { Check } from 'lucide-react'
import useStore from '../../store/useStore'
import { useCompounds } from '../../lib/useCompounds'
import { laneFor, MAX_LANES } from '../../body/lanes'
import { shortDate } from '../../body/chartPoints'
import { saunaLaneDots } from '../../sauna/sauna'

export const SAUNA_LANE = 'sauna'

export const LANE_H = 24

/**
 * Compound lanes for a chart: which compounds are chosen for this chart type
 * (remembered), and each one's lane over the visible range.
 */
export function useLanes(chartType, from, to) {
  const compounds = useCompounds()
  const sessions = useStore((s) => s.saunaSessions)
  const saved = useStore((s) => s.healthSettings?.overlays?.[chartType]?.lanes)
  const setChartOverlay = useStore((s) => s.setChartOverlay)
  // sauna is one more lane, under the same rules: remembered per chart, four at most
  const chosen = useMemo(() => (saved || []).filter((id) => id === SAUNA_LANE || compounds.some((c) => c.id === id)).slice(0, MAX_LANES), [saved, compounds])
  const lanes = useMemo(() => chosen.map((id) => {
    if (id === SAUNA_LANE) return { id, name: 'Sauna', kind: 'dots', dots: saunaLaneDots(sessions, from, to), segments: [], changes: [], spans: [] }
    const c = compounds.find((x) => x.id === id)
    return { id, name: c.name, ...laneFor(c.points, c.runs, from, to) }
  }), [chosen, compounds, sessions, from, to])
  const toggle = (id) => {
    const on = chosen.includes(id)
    if (!on && chosen.length >= MAX_LANES) return
    setChartOverlay?.(chartType, { lanes: on ? chosen.filter((x) => x !== id) : [...chosen, id] })
  }
  return { compounds, chosen, lanes, toggle }
}

/** The Compounds list in a chart's Overlay menu. */
export function LaneMenu({ compounds, chosen, toggle }) {
  const full = chosen.length >= MAX_LANES
  const items = [...compounds, { id: SAUNA_LANE, name: 'Sauna' }]
  return (
    <>
      <p className="t-caption" style={{ color: 'var(--text-3)' }}>Lanes (up to {MAX_LANES})</p>
      <div className="flex flex-wrap gap-1.5" data-testid="lane-menu">
        {items.map((c) => {
          const on = chosen.includes(c.id)
          return (
            <button key={c.id} onClick={() => toggle(c.id)} aria-pressed={on} disabled={!on && full} data-testid={`lane-toggle-${c.id}`}
              className="flex min-h-[30px] items-center gap-1 rounded-full px-2.5 text-xs font-bold disabled:opacity-40"
              style={on ? { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' } : { background: 'var(--surface-sunk)', color: 'var(--text-3)', border: '1px solid transparent' }}>
              {on && <Check size={11} />}{c.name}
            </button>
          )
        })}
      </div>
    </>
  )
}

/**
 * The lanes themselves, drawn under the x axis: the time on each compound
 * lightly shaded inside its lane only, the dose as a step line, and the dose
 * written only where it changes. Tapping a change selects it.
 */
export function LaneRows({ lanes, top, xFor, left, right, onPick, picked }) {
  return lanes.map((l, i) => {
    const y0 = top + i * LANE_H
    if (l.kind === 'dots') {
      return (
        <g key={l.id} data-testid={`lane-${l.id}`}>
          <text x={left - 4} y={y0 + LANE_H / 2 + 3} fontSize="7" fontWeight="800" textAnchor="end" fill="var(--text-3)">Sauna</text>
          <line x1={left} x2={right} y1={y0 + LANE_H / 2} y2={y0 + LANE_H / 2} stroke="var(--border)" />
          {l.dots.map((d) => (
            <circle key={d.date} cx={xFor(d.date)} cy={y0 + LANE_H / 2} r={d.r} fill="var(--series-sauna)" opacity={picked && picked.id === l.id && picked.date === d.date ? 1 : 0.75}
              onClick={() => onPick({ id: l.id, name: l.name, date: d.date, kind: 'sauna', label: `${d.minutes} min` })} style={{ cursor: 'pointer' }} data-testid="lane-sauna-dot" />
          ))}
        </g>
      )
    }
    const yFor = (dose) => y0 + LANE_H - 5 - (l.maxDose ? (dose / l.maxDose) * (LANE_H - 13) : 0)
    let path = ''
    for (const s of l.segments) path += `M${xFor(s.from).toFixed(1)},${yFor(s.dose).toFixed(1)} H${xFor(s.to).toFixed(1)} `
    return (
      <g key={l.id} data-testid={`lane-${l.id}`}>
        {l.spans.map((s, j) => (
          <rect key={j} x={xFor(s.from)} y={y0 + 2} width={Math.max(1, xFor(s.to) - xFor(s.from))} height={LANE_H - 4} rx="3" fill="var(--text)" opacity="0.06" />
        ))}
        <text x={left - 4} y={y0 + LANE_H / 2 + 3} fontSize="7" fontWeight="800" textAnchor="end" fill="var(--text-3)">{l.name.slice(0, 5)}</text>
        <path d={path} fill="none" stroke="var(--text-2)" strokeWidth="1.6" />
        {l.changes.map((c) => {
          const on = picked && picked.id === l.id && picked.date === c.date
          const atEnd = xFor(c.date) > right - 30
          const tx = atEnd ? Math.min(right - 2, xFor(c.date)) : xFor(c.date) + 2
          return (
            <g key={c.date} onClick={() => onPick({ id: l.id, name: l.name, ...c })} style={{ cursor: 'pointer' }} data-testid="lane-change">
              <line x1={xFor(c.date)} x2={xFor(c.date)} y1={y0 + 2} y2={y0 + LANE_H - 2} stroke="var(--text-3)" strokeWidth="1" />
              <text x={tx} y={y0 + 8} fontSize="7" fontWeight="700" fill={on ? 'var(--text)' : 'var(--text-2)'} textAnchor={atEnd ? 'end' : 'start'}>{c.label}</text>
              {/* the tap target: the whole label area, not just its glyphs */}
              <rect x={atEnd ? tx - 40 : xFor(c.date) - 4} y={y0} width="44" height={LANE_H} fill="transparent" />
            </g>
          )
        })}
      </g>
    )
  })
}

/** Popover text for a tapped lane change. */
export const laneChangeWords = (p) => (p.kind === 'sauna' ? `Sauna, ${p.label} on ${shortDate(p.date)}`
  : p.kind === 'stop' ? `${p.name} stopped on ${shortDate(p.date)}` : `${p.name} to ${p.label} on ${shortDate(p.date)}`)
