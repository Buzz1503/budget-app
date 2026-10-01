import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, RotateCcw } from 'lucide-react'
import useStore from '../../store/useStore'
import SiteMap from './SiteMap'
import { useElementHeight, AREA_PADDING_PX } from '../../lib/useElementHeight'

/**
 * Adjust pins, as a screen rather than a sheet.
 *
 * It was a bottom sheet, and a bottom sheet was the wrong container for it.
 * The sheet's background is `--surface`, which is 5% white — so Settings showed
 * straight through it. Its height was capped at 88% of the viewport while the
 * map alone is 517 px tall, which pushed the thigh pins and the Done button
 * below the fold. And the map sets `touch-action: none`, so the one gesture
 * that could have reached them — scrolling the sheet — was swallowed by the
 * map's own pan handler.
 *
 * A fixed, opaque, full-height column fixes all three at once: nothing shows
 * through, the map is sized to the space actually left over instead of a fixed
 * 517 px, and there is nothing to scroll because everything fits.
 */
export default function AdjustPins({ open, onClose }) {
  const siteMap = useStore((s) => s.siteMap)
  const resetPin = useStore((s) => s.resetPin)
  const resetAllPins = useStore((s) => s.resetAllPins)

  const [view, setView] = useState('front')
  const [selected, setSelected] = useState(null)
  const [warning, setWarning] = useState(null)
  const [confirmClose, setConfirmClose] = useState(false)

  const startOverrides = useRef(null)
  const areaRef = useRef(null)
  const mapH = useElementHeight(areaRef)

  const moved = Object.keys(siteMap?.pinOverrides || {})

  useEffect(() => {
    if (!open) return undefined
    startOverrides.current = JSON.stringify(siteMap?.pinOverrides || {})
    setSelected(null)
    setWarning(null)
    setConfirmClose(false)

    // Lock the page behind, and put it back exactly where it was. Without the
    // saved offset the body springs to the top the moment position:fixed lands,
    // and closing drops you at the top of Settings instead of at the Site map
    // card you opened this from.
    const y = window.scrollY
    const body = document.body
    const prev = { position: body.style.position, top: body.style.top, width: body.style.width }
    body.style.position = 'fixed'
    body.style.top = `-${y}px`
    body.style.width = '100%'
    return () => {
      body.style.position = prev.position
      body.style.top = prev.top
      body.style.width = prev.width
      window.scrollTo(0, y)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const dirty = JSON.stringify(siteMap?.pinOverrides || {}) !== startOverrides.current
  const tryClose = () => {
    if (dirty && !confirmClose) { setConfirmClose(true); return }
    onClose?.()
  }

  return createPortal(
    <div
      data-testid="adjust-pins-screen"
      className="fixed inset-0 z-[60] flex flex-col"
      style={{
        // opaque, and above the tab bar (z-40) and every sheet (z-50), so the
        // bar is covered rather than showing through
        background: 'var(--bg)',
        height: '100dvh',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3">
        <h2 className="text-lg font-black tracking-tight">Adjust pins</h2>
        <div className="flex items-center gap-2">
          <button
            data-testid="adjust-done"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm font-black"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            Done
          </button>
          <button
            data-testid="adjust-close"
            onClick={tryClose}
            className="rounded-full p-2"
            style={{ background: 'var(--surface-sunk)' }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="mt-2 shrink-0 px-4">
        <div className="flex gap-1 rounded-full p-1" style={{ background: 'var(--surface-sunk)' }}>
          {['front', 'back'].map((v) => (
            <button
              key={v}
              data-testid={`adjust-view-${v}`}
              data-on={view === v ? 'true' : 'false'}
              onClick={() => setView(v)}
              className="flex-1 rounded-full py-2 text-sm font-bold capitalize"
              style={view === v
                ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                : { color: 'var(--text-2)' }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div ref={areaRef} className="min-h-0 flex-1 px-2 py-2">
        <SiteMap
          adjust
          fit="contain"
          maxHeight={mapH - AREA_PADDING_PX}
          view={view}
          onView={setView}
          showChrome={false}
          selectedId={selected?.id || null}
          onSelect={setSelected}
          onAdjustWarning={setWarning}
        />
      </div>

      <div className="shrink-0 space-y-2 px-4 pb-3">
        {warning ? (
          <div
            data-testid="adjust-footer-warning"
            className="rounded-[var(--r-sm)] px-3 py-2 t-caption"
            style={{ background: 'color-mix(in srgb, var(--danger) 16%, transparent)', color: 'var(--danger)' }}
          >
            {warning}
          </div>
        ) : (
          <p className="t-caption" style={{ color: 'var(--text-3)' }}>
            Long-press a pin to move it. Pinch to zoom.
          </p>
        )}

        {selected && (
          <div className="flex items-center justify-between gap-2 rounded-[var(--r-sm)] px-3 py-2" style={{ background: 'var(--surface-sunk)' }}>
            <span className="min-w-0 flex-1 truncate text-sm font-black">{selected.label}</span>
            <button
              data-testid="reset-one-pin"
              onClick={() => resetPin(selected.id)}
              className="chip shrink-0"
              disabled={!moved.includes(selected.id)}
            >
              Reset
            </button>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="t-caption" style={{ color: 'var(--text-3)' }}>
            {moved.length ? `${moved.length} pin${moved.length === 1 ? '' : 's'} moved` : 'Every pin is where it started'}
          </span>
          <button
            className="t-caption flex items-center gap-1.5 underline"
            style={{ color: 'var(--text-3)' }}
            onClick={resetAllPins}
            disabled={!moved.length}
            data-testid="adjust-reset-all"
          >
            <RotateCcw size={12} /> Reset all pins
          </button>
        </div>
      </div>

      {confirmClose && (
        <div className="absolute inset-0 z-10 flex items-end justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="w-full rounded-[var(--r-lg)] p-4" style={{ background: 'var(--surface-solid)' }} data-testid="adjust-discard">
            <p className="mb-3 text-sm font-bold">Discard changes?</p>
            <div className="flex gap-2">
              <button
                data-testid="adjust-discard-yes"
                onClick={onClose}
                className="flex-1 rounded-full py-2 text-sm font-extrabold"
                style={{ background: 'var(--danger)', color: 'var(--accent-fg)' }}
              >
                Discard
              </button>
              <button
                onClick={() => setConfirmClose(false)}
                className="flex-1 rounded-full py-2 text-sm font-extrabold"
                style={{ background: 'var(--surface-sunk)' }}
              >
                Keep editing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
