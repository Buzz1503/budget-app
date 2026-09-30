import { useMemo, useRef, useState } from 'react'
import { ZONES, ZONE_BY_ID, zonesOn } from '../../lib/reactionZones'

/**
 * A body you can point at.
 *
 * The figure is deliberately crude — a silhouette, not an anatomy plate. What
 * matters is that the zones sit where they sit on a real torso and that a thumb
 * can hit one, so every zone is at least 10% of the body's width and the tap
 * target is the whole rectangle rather than the label.
 *
 * Status is carried by fill colour *and* by a stroke, because a fill difference
 * alone disappears for anyone with a colour vision deficiency, and this is the
 * one screen where telling a resting site from a reacting one actually matters.
 */

const BOX = { w: 100, h: 200 }

const TONE = {
  clear: { fill: 'color-mix(in srgb, var(--good) 16%, transparent)', stroke: 'var(--good)' },
  reacting: { fill: 'color-mix(in srgb, var(--danger) 26%, transparent)', stroke: 'var(--danger)' },
  resting: { fill: 'color-mix(in srgb, var(--warn) 16%, transparent)', stroke: 'var(--warn)' },
  unused: { fill: 'var(--surface-sunk)', stroke: 'var(--border)' },
  blocked: { fill: 'var(--surface-sunk)', stroke: 'var(--border)' },
}

/** The silhouette, front or back. Same outline both ways — it is a target, not a portrait. */
function Figure() {
  return (
    <g fill="var(--surface-sunk)" stroke="var(--border)" strokeWidth="0.6">
      <ellipse cx="50" cy="20" rx="10" ry="12" />
      <rect x="45" y="31" width="10" height="7" rx="3" />
      <path d="M30 38 h40 a6 6 0 0 1 6 6 v58 a4 4 0 0 1 -4 4 h-44 a4 4 0 0 1 -4 -4 v-58 a6 6 0 0 1 6 -6 z" />
      <path d="M28 42 l-12 6 a4 4 0 0 0 -2 4 v34 a4 4 0 0 0 8 0 v-30 z" />
      <path d="M72 42 l12 6 a4 4 0 0 1 2 4 v34 a4 4 0 0 1 -8 0 v-30 z" />
      <path d="M33 106 h14 v54 a4 4 0 0 1 -8 0 z" />
      <path d="M53 106 h14 v54 a4 4 0 0 1 -8 0 z" />
      <path d="M34 160 h12 v22 a4 4 0 0 1 -8 0 z" />
      <path d="M54 160 h12 v22 a4 4 0 0 1 -8 0 z" />
    </g>
  )
}

export default function BodyMap({
  view = 'front',
  onView,
  statusByZone = {},
  rateByZone = null,
  heatmap = false,
  onHeatmap,
  selectedZone = null,
  onSelectZone,
  points = [],
  onSelectPoint,
  activeDots = [],
  onOpenDot,
  allowedZoneIds = null,
  compact = false,
}) {
  const svgRef = useRef(null)
  const zones = useMemo(() => zonesOn(view), [view])

  const tap = (e, zone) => {
    if (!onSelectPoint) { onSelectZone?.(zone.id); return }
    const svg = svgRef.current
    if (!svg) { onSelectZone?.(zone.id); return }
    const r = svg.getBoundingClientRect()
    const cx = (e.clientX - r.left) / r.width * BOX.w
    const cy = (e.clientY - r.top) / r.height * BOX.h
    // stored as a fraction of the zone, so it survives the map being resized
    const px = Math.min(1, Math.max(0, (cx - zone.x) / zone.w))
    const py = Math.min(1, Math.max(0, (cy - zone.y) / zone.h))
    onSelectZone?.(zone.id)
    onSelectPoint({ zoneId: zone.id, x: Math.round(px * 100) / 100, y: Math.round(py * 100) / 100 })
  }

  const fillFor = (z) => {
    if (heatmap && rateByZone) {
      const r = rateByZone[z.id]
      if (!r || !r.n) return TONE.unused.fill
      return `color-mix(in srgb, var(--danger) ${Math.round(12 + r.rate * 58)}%, transparent)`
    }
    const st = statusByZone[z.id]?.status || 'unused'
    return TONE[st].fill
  }
  const strokeFor = (z) => {
    if (selectedZone === z.id) return 'var(--accent)'
    if (allowedZoneIds && !allowedZoneIds.includes(z.id)) return 'var(--border)'
    if (heatmap) return 'var(--border)'
    return TONE[statusByZone[z.id]?.status || 'unused'].stroke
  }

  return (
    <div className="space-y-2" data-testid="body-map">
      {(onView || onHeatmap) && (
        <div className="flex items-center gap-2">
          {onView && (
            <div className="flex flex-1 rounded-full p-1" style={{ background: 'var(--surface-sunk)' }}>
              {['front', 'back'].map((v) => (
                <button key={v} onClick={() => onView(v)} data-testid={`map-view-${v}`}
                  className="flex-1 rounded-full py-2 text-xs font-black capitalize"
                  style={view === v
                    ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                    : { color: 'var(--text-2)' }}>
                  {v}
                </button>
              ))}
            </div>
          )}
          {onHeatmap && (
            <button onClick={() => onHeatmap(!heatmap)} data-testid="map-heatmap"
              data-on={heatmap ? 'true' : 'false'}
              className="shrink-0 rounded-full px-3 py-2 text-xs font-black"
              style={heatmap
                ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              Heatmap
            </button>
          )}
        </div>
      )}

      <svg ref={svgRef} viewBox={`0 0 ${BOX.w} ${BOX.h}`} className="w-full"
        style={{ maxHeight: compact ? 260 : 420 }} role="img"
        aria-label={`Injection sites, ${view} view`}>
        <Figure />
        {zones.map((z) => {
          const st = statusByZone[z.id]
          const blocked = !!st?.blocked
          const notAllowed = allowedZoneIds && !allowedZoneIds.includes(z.id)
          return (
            <g key={z.id}>
              <rect
                x={z.x} y={z.y} width={z.w} height={z.h} rx="2.5"
                data-testid={`zone-${z.id}`}
                data-status={st?.status || 'unused'}
                data-blocked={blocked ? 'true' : 'false'}
                data-selected={selectedZone === z.id ? 'true' : 'false'}
                fill={fillFor(z)}
                stroke={strokeFor(z)}
                strokeWidth={selectedZone === z.id ? 1.6 : 0.7}
                strokeDasharray={notAllowed ? '2 2' : undefined}
                opacity={notAllowed ? 0.45 : 1}
                style={{ cursor: 'pointer' }}
                onClick={(e) => tap(e, z)}
              />
              {/* the mark of a shot already placed here */}
              {points.filter((p) => p.zoneId === z.id).map((p, i) => (
                <circle key={i} cx={z.x + p.x * z.w} cy={z.y + p.y * z.h} r="1.4"
                  fill="var(--accent)" stroke="var(--surface-solid)" strokeWidth="0.5" />
              ))}
            </g>
          )
        })}

        {/* open reactions, at the exact point they were put */}
        {activeDots.filter((d) => ZONE_BY_ID[d.zoneId]?.view === view).map((d) => {
          const z = ZONE_BY_ID[d.zoneId]
          const cx = z.x + (d.point?.x ?? 0.5) * z.w
          const cy = z.y + (d.point?.y ?? 0.5) * z.h
          return (
            <g key={d.id}>
              {/* The pulse is decoration and never the tap target: an element
                  whose radius is always changing is one a pointer can never
                  settle on. The hit area is a static, generously sized circle
                  over the top of it. */}
              <circle cx={cx} cy={cy} r="4" fill="var(--danger)" opacity="0.25" pointerEvents="none">
                <animate attributeName="r" values="3;5.5;3" dur="2.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.3;0.05;0.3" dur="2.4s" repeatCount="indefinite" />
              </circle>
              <circle cx={cx} cy={cy} r="1.8" fill="var(--danger)" stroke="var(--surface-solid)"
                strokeWidth="0.5" pointerEvents="none" />
              <circle cx={cx} cy={cy} r="7" fill="transparent"
                data-testid="reaction-dot" data-reaction={d.id}
                style={{ cursor: 'pointer' }} onClick={() => onOpenDot?.(d)} />
            </g>
          )
        })}
      </svg>

      {/* the key, in words — colour alone is not a label */}
      {!heatmap && !compact && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-1">
          {['clear', 'reacting', 'resting', 'unused'].map((k) => (
            <span key={k} className="flex items-center gap-1.5 text-xs font-bold capitalize"
              style={{ color: 'var(--text-3)' }}>
              <span className="h-2 w-2 rounded-sm"
                style={{ background: TONE[k].fill, outline: `1px solid ${TONE[k].stroke}` }} />
              {k === 'unused' ? 'Never used' : k}
            </span>
          ))}
        </div>
      )}
      {heatmap && (
        <p className="px-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
          Darker means a higher share of shots at that site reacted. Sites with nothing recorded stay blank.
        </p>
      )}
    </div>
  )
}

export { ZONES, ZONE_BY_ID }
