import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import useStore from '../../store/useStore'
import { displayName } from '../../lib/naming'
import { PIN_BY_ID } from '../../lib/sitePins'
import { colourHex } from '../../lib/peptideIdentity'
import { recentUses, DEFAULT_WINDOW_DAYS } from '../../lib/siteRotation'
import { SEVERITY_BY_ID } from '../../lib/reactionTracker'
import SiteMap from './SiteMap'
import { useElementHeight, AREA_PADDING_PX } from '../../lib/useElementHeight'

const MAX_LINES = 5

/**
 * Where the last few shots went, on the screen you open in the morning.
 *
 * The point of it is the glance before logging: five lines is enough to see the
 * pattern you are rotating through, and the map behind "See all" is for when it
 * is not. Hidden entirely when nothing is sited, because a card explaining that
 * it has nothing to say is a card people learn to scroll past.
 */
export default function RecentSitesCard() {
  const records = useStore((s) => s.injectionRecords)
  const reactions = useStore((s) => s.reactions)
  const peptides = useStore((s) => s.peptides)
  const windowDays = useStore((s) => s.reactionSettings?.windowDays ?? DEFAULT_WINDOW_DAYS)
  const [mapOpen, setMapOpen] = useState(false)

  const uses = useMemo(
    () => recentUses({ records, reactions, nowIso: new Date().toISOString(), windowDays }),
    [records, reactions, windowDays],
  )
  const peptideById = useMemo(() => Object.fromEntries(peptides.map((p) => [p.id, p])), [peptides])

  if (!uses.length) return null
  const shown = uses.slice(0, MAX_LINES)

  return (
    <>
      <div className="card p-4" data-testid="recent-sites-card">
        <div className="mb-2 flex items-center justify-between">
          <p className="t-label" style={{ color: 'var(--text-3)' }}>Recent sites</p>
          {uses.length > MAX_LINES && (
            <button
              className="t-caption underline"
              data-testid="recent-sites-see-all"
              style={{ color: 'var(--text-3)' }}
              onClick={() => setMapOpen(true)}
            >
              See all
            </button>
          )}
        </div>
        <div className="rows">
          {shown.map((u) => {
            const pep = peptideById[u.peptideId]
            return (
              <div key={u.record.id} className="flex items-center gap-2 py-1.5" data-testid={`recent-line-${u.record.id}`}>
                <span className="t-caption w-20 shrink-0 tabular-nums" style={{ color: 'var(--text-3)' }}>
                  {whenLong(u.hoursAgo, u.record.timestamp)}
                </span>
                <span className="shrink-0 text-xs font-black" style={{ color: colourHex(pep) }}>
                  {pep?.code || '?'}
                </span>
                <span className="min-w-0 flex-1 truncate t-caption" style={{ color: 'var(--text-2)' }}>
                  {PIN_BY_ID[u.pinId]?.label}
                </span>
                {u.severity && u.severity !== 'none' && (
                  <span className="t-caption shrink-0" style={{ color: u.reacting ? 'var(--warn)' : 'var(--text-3)' }}>
                    {SEVERITY_BY_ID[u.severity]?.label}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {mapOpen && (
        <RecentSitesMap
          uses={uses}
          peptideById={peptideById}
          onClose={() => setMapOpen(false)}
        />
      )}
    </>
  )
}

/** View only: the same map with the window's pins ringed, and nothing to log. */
function RecentSitesMap({ uses, peptideById, onClose }) {
  const [view, setView] = useState('front')
  const areaRef = useRef(null)
  const mapH = useElementHeight(areaRef)
  const highlight = useMemo(() => [...new Set(uses.map((u) => u.pinId))], [uses])

  return createPortal(
    <div
      data-testid="recent-sites-map"
      className="fixed inset-0 z-[60] flex flex-col"
      style={{
        background: 'var(--bg)',
        height: '100dvh',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3">
        <h2 className="text-lg font-black tracking-tight">Recent sites</h2>
        <button onClick={onClose} className="rounded-full p-2" style={{ background: 'var(--surface-sunk)' }} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="mt-2 shrink-0 px-4">
        <div className="flex gap-1 rounded-full p-1" style={{ background: 'var(--surface-sunk)' }}>
          {['front', 'back'].map((v) => (
            <button key={v} data-testid={`recent-view-${v}`} onClick={() => setView(v)}
              className="flex-1 rounded-full py-2 text-sm font-bold capitalize"
              style={view === v ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { color: 'var(--text-2)' }}>
              {v}
            </button>
          ))}
        </div>
      </div>
      <div ref={areaRef} className="min-h-0 flex-1 px-2 py-2">
        <SiteMap
          fit="contain"
          maxHeight={mapH - AREA_PADDING_PX}
          view={view}
          onView={setView}
          showChrome={false}
          highlight={highlight}
        />
      </div>
      <div className="max-h-44 shrink-0 overflow-y-auto px-4 pb-3">
        <div className="rows">
          {uses.map((u) => {
            const pep = peptideById[u.peptideId]
            return (
              <button
                key={u.record.id}
                onClick={() => setView(PIN_BY_ID[u.pinId]?.view || 'front')}
                className="flex w-full items-center gap-2 py-1.5 text-left"
              >
                <span className="t-caption w-20 shrink-0 tabular-nums" style={{ color: 'var(--text-3)' }}>
                  {whenLong(u.hoursAgo, u.record.timestamp)}
                </span>
                <span className="shrink-0 text-xs font-black" style={{ color: colourHex(pep) }}>{pep?.code || '?'}</span>
                <span className="min-w-0 flex-1 truncate t-caption" style={{ color: 'var(--text-2)' }}>
                  {PIN_BY_ID[u.pinId]?.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** "Yesterday 8:12 pm" — the day in words, the time as it reads on a clock. */
export function whenLong(hours, iso) {
  const d = new Date(iso)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase()
  if (hours < 20) return `Today ${time}`
  const days = Math.round(hours / 24)
  if (days <= 1) return `Yest ${time}`
  return `${days}d ago`
}
