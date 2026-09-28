import { rangePosition, fmtRange, deltaWords } from '../../lib/bloods'
import { prettyDate } from '../../lib/schedule'

/**
 * Where one value sits inside the lab's interval.
 *
 * A number on its own is not readable without the interval beside it, and an
 * interval written out in text is read by nobody. The bar puts the two
 * together: the shaded stretch is what the lab calls unremarkable, the dot is
 * you. Colour appears only when the dot is outside the shading, which is the
 * one piece of status this screen is willing to assert.
 */
export function RangeBar({ value, range, height = 6 }) {
  const pos = rangePosition(value, range)
  if (!pos) return null
  const tone = pos.status === 'in' ? 'var(--good)' : pos.status === 'unknown' ? 'var(--text-3)' : 'var(--warn)'
  const width = Math.max(0.5, pos.bandEnd - pos.bandStart)
  return (
    <div className="relative w-full overflow-visible rounded-full" data-testid="range-bar"
      data-status={pos.status}
      style={{ height, background: 'var(--surface-sunk)' }}>
      {/* the lab's interval */}
      <div className="absolute inset-y-0 rounded-full"
        style={{ left: `${pos.bandStart}%`, width: `${width}%`, background: 'color-mix(in srgb, var(--text-3) 45%, transparent)' }} />
      {/* you */}
      <div className="absolute rounded-full"
        style={{
          left: `${pos.pct}%`, top: '50%',
          width: height + 4, height: height + 4,
          transform: 'translate(-50%, -50%)',
          background: tone,
          boxShadow: '0 0 0 2px var(--surface-solid)',
        }} />
    </div>
  )
}

/** The value, its interval and which way it moved — one line, no opinion. */
export function MarkerRow({ row, onOpen, compounds }) {
  const { marker, range, latest, delta, status } = row
  const tone = status === 'in' ? 'var(--text)' : status === 'unknown' ? 'var(--text-2)' : 'var(--warn)'
  return (
    <button onClick={onOpen} data-testid="marker-row" data-marker={marker.name} data-status={status}
      className="flex w-full flex-col gap-1.5 px-3 py-2.5 text-left">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-bold">{marker.name}</span>
        <span className="shrink-0 text-sm font-black tabular-nums" style={{ color: tone }}>
          {latest ? latest.value : '—'}
          {marker.unit ? <span className="ml-1 text-xs font-bold" style={{ color: 'var(--text-3)' }}>{marker.unit}</span> : null}
        </span>
      </div>

      {latest && <RangeBar value={latest.value} range={range} />}

      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
          {fmtRange(range, marker.unit)}
          {range.edited ? ' · edited' : ''}
          {compounds?.length ? ` · ${compounds.map((c) => c.name).join(', ')}` : ''}
        </span>
        {delta && (
          <span className="shrink-0 text-xs font-bold tabular-nums" data-testid="marker-delta"
            style={{ color: 'var(--text-2)' }}>
            {deltaWords(delta, prettyDate)}
          </span>
        )}
      </div>
    </button>
  )
}
