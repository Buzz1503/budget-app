import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronDown } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { displayName } from '../../lib/naming'
import { currentRung } from '../../lib/schedule'
import { formatDose } from '../../lib/calc'
import { PIN_BY_ID } from '../../lib/sitePins'
import { colourHex } from '../../lib/peptideIdentity'
import {
  recentUses, summaryLine, suggestSite, warningsFor, pinBarLines, DEFAULT_WINDOW_DAYS,
} from '../../lib/siteRotation'
import { SEVERITY_BY_ID } from '../../lib/reactionTracker'
import SiteMap from './SiteMap'
import { useElementHeight, AREA_PADDING_PX } from '../../lib/useElementHeight'

/**
 * Logging a dose by choosing where it goes.
 *
 * The quick Log button stays exactly as it was — one tap, no decisions. This is
 * the other half: the same dose, the same schedule link, the same effect on
 * stock, plus the one fact that makes a reaction attributable to a compound.
 * Nothing is written until "Log here", so backing out costs nothing.
 */
export default function LogOnBody({ peptideId, onClose }) {
  const peptides = useStore((s) => s.peptides)
  const records = useStore((s) => s.injectionRecords)
  const reactions = useStore((s) => s.reactions)
  const titration = useStore((s) => s.titration)
  const doseLogs = useStore((s) => s.doseLogs)
  const siteMap = useStore((s) => s.siteMap)
  const windowDays = useStore((s) => s.reactionSettings?.windowDays ?? DEFAULT_WINDOW_DAYS)
  const logDoseOnSite = useStore((s) => s.logDoseOnSite)

  const peptide = peptides.find((p) => p.id === peptideId)
  const [view, setView] = useState('front')
  const [picked, setPicked] = useState(null)
  const [confirmAgain, setConfirmAgain] = useState(false)
  const areaRef = useRef(null)
  const mapH = useElementHeight(areaRef)

  const nameOf = useMemo(() => (id) => {
    const p = peptides.find((x) => x.id === id)
    return p ? displayName(p) : 'Unknown'
  }, [peptides])

  const nowIso = useMemo(() => new Date().toISOString(), [])
  const ctx = useMemo(() => ({
    records, reactions, nowIso, windowDays, nameOf,
    overrides: siteMap?.pinOverrides || {},
  }), [records, reactions, nowIso, windowDays, nameOf, siteMap])

  const suggestion = useMemo(() => suggestSite(peptideId, ctx), [peptideId, ctx])
  const summary = useMemo(() => summaryLine(peptideId, ctx), [peptideId, ctx])
  const uses = useMemo(() => recentUses(ctx), [ctx])
  const warnings = useMemo(
    () => (picked ? warningsFor(picked, peptideId, ctx) : []),
    [picked, peptideId, ctx],
  )

  // open on the view the suggestion is actually on, so it is not behind a toggle
  useEffect(() => {
    if (suggestion?.pin) setView(suggestion.pin.view)
  }, [suggestion?.pin?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
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
  }, [])

  if (!peptide) return null

  const { dose } = currentRung(peptide, titration[peptideId])
  const alreadyToday = doseLogs.some((l) => l.peptideId === peptideId && l.date === todayStr())

  const commit = () => {
    if (!picked) return
    if (alreadyToday && !confirmAgain) { setConfirmAgain(true); return }
    logDoseOnSite(peptideId, picked)
    onClose?.()
  }

  const pinLabel = picked ? PIN_BY_ID[picked]?.label : null

  return createPortal(
    <div
      data-testid="log-on-body-screen"
      className="fixed inset-0 z-[60] flex flex-col"
      style={{
        background: 'var(--bg)',
        height: '100dvh',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-black leading-tight tracking-tight">{displayName(peptide)}</h2>
          <p className="t-caption tabular-nums" style={{ color: 'var(--text-2)' }}>
            {formatDose(dose, peptide.ladder.unit)}
          </p>
        </div>
        <button
          data-testid="log-on-body-cancel"
          onClick={onClose}
          className="shrink-0 rounded-full p-2"
          style={{ background: 'var(--surface-sunk)' }}
          aria-label="Cancel"
        >
          <X size={16} />
        </button>
      </div>

      <div className="mt-2 shrink-0 px-4">
        <div className="flex gap-1 rounded-full p-1" style={{ background: 'var(--surface-sunk)' }}>
          {['front', 'back'].map((v) => (
            <button
              key={v}
              data-testid={`lob-view-${v}`}
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

      {summary && (
        <p className="shrink-0 px-4 pt-2 t-caption" data-testid="lob-summary" style={{ color: 'var(--text-2)' }}>
          {summary}
        </p>
      )}

      <div ref={areaRef} className="min-h-0 flex-1 px-2 py-2">
        <SiteMap
          fit="contain"
          maxHeight={mapH - AREA_PADDING_PX}
          view={view}
          onView={setView}
          showChrome={false}
          forPeptideId={peptideId}
          selectedId={picked}
          onSelect={(p) => setPicked(p.id)}
        />
      </div>

      <div className="shrink-0 space-y-2 px-4 pb-3">
        {picked ? (
          <div className="rounded-[var(--r-sm)] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid="lob-pin-bar">
            <div className="text-sm font-black">{pinLabel}</div>
            {pinBarLines(picked, ctx).map((line, i) => (
              <div key={i} className="t-caption" style={{ color: 'var(--text-2)' }}>{line}</div>
            ))}
            {warnings.map((wn) => (
              <div
                key={wn.kind}
                data-testid={`lob-warning-${wn.kind}`}
                className="mt-1 t-caption"
                style={{ color: wn.kind === 'reacting' ? 'var(--danger)' : 'var(--warn)' }}
              >
                {wn.text}
                {wn.suggest && suggestion && suggestion.pinId !== picked && (
                  <button className="ml-1 underline" onClick={() => setPicked(suggestion.pinId)}>
                    Try {suggestion.pin.label}.
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : suggestion ? (
          <div className="flex items-center gap-2 rounded-[var(--r-sm)] p-3" style={{ background: 'var(--surface-sunk)' }}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-black">{suggestion.pin.label}</div>
              <div className="t-caption" data-testid="lob-reason" style={{ color: 'var(--text-2)' }}>{suggestion.reason}</div>
            </div>
            <button
              data-testid="lob-use-suggested"
              onClick={() => setPicked(suggestion.pinId)}
              className="chip shrink-0"
            >
              Use suggested
            </button>
          </div>
        ) : null}

        <RecentSitesList uses={uses} nameOf={nameOf} onPick={(u) => { setView(PIN_BY_ID[u.pinId]?.view || 'front'); setPicked(u.pinId) }} />

        {confirmAgain && (
          <p className="t-caption" data-testid="lob-already" style={{ color: 'var(--warn)' }}>
            Already logged today. Log again?
          </p>
        )}
        <button
          data-testid="lob-log-here"
          onClick={commit}
          disabled={!picked}
          className="btn-primary w-full rounded-full py-3 text-sm font-black disabled:opacity-40"
        >
          {confirmAgain ? 'Yes, log again' : 'Log here'}
        </button>
      </div>
    </div>,
    document.body,
  )
}

/**
 * The window's shots, under the map.
 *
 * Three lines by default because that is about one rotation's worth; the rest
 * are one tap away. Tapping a line only moves the map to that pin — in this
 * screen nothing is logged without pressing Log here.
 */
export function RecentSitesList({ uses = [], nameOf, onPick, defaultShown = 3 }) {
  const [open, setOpen] = useState(false)
  if (!uses.length) return null
  const shown = open ? uses : uses.slice(0, defaultShown)
  return (
    <div data-testid="recent-sites-list">
      <div className="rows">
        {shown.map((u) => (
          <button
            key={u.record.id}
            data-testid={`recent-site-${u.record.id}`}
            onClick={() => onPick?.(u)}
            className="flex w-full items-center gap-2 py-1.5 text-left"
          >
            <span className="t-caption shrink-0 tabular-nums" style={{ color: 'var(--text-3)' }}>
              {whenWords(u.hoursAgo)}
            </span>
            <span className="min-w-0 flex-1 truncate t-caption" style={{ color: 'var(--text-2)' }}>
              {nameOf(u.peptideId)} · {PIN_BY_ID[u.pinId]?.label}
            </span>
            {u.severity && u.severity !== 'none' && (
              <span className="t-caption shrink-0" style={{ color: u.reacting ? 'var(--warn)' : 'var(--text-3)' }}>
                {SEVERITY_BY_ID[u.severity]?.label}
              </span>
            )}
          </button>
        ))}
      </div>
      {uses.length > defaultShown && (
        <button
          className="t-caption flex items-center gap-1 underline"
          data-testid="recent-sites-more"
          style={{ color: 'var(--text-3)' }}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown size={11} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
          {open ? 'Show fewer' : `Show all ${uses.length}`}
        </button>
      )}
    </div>
  )
}

export function whenWords(hours) {
  if (hours < 1) return 'now'
  if (hours < 20) return 'today'
  const days = Math.round(hours / 24)
  if (days <= 1) return 'yest'
  return `${days}d`
}

/** Attach a site to a dose that was already quick-logged. */
export function AddSite({ doseLogId, peptideId, onClose }) {
  const attachSiteToDose = useStore((s) => s.attachSiteToDose)
  const showToast = useStore((s) => s.showToast)
  const peptides = useStore((s) => s.peptides)
  const [picked, setPicked] = useState(null)
  const [view, setView] = useState('front')
  const areaRef = useRef(null)
  const mapH = useElementHeight(areaRef)
  const peptide = peptides.find((p) => p.id === peptideId)

  const save = () => {
    if (!picked) return
    attachSiteToDose(doseLogId, picked)
    showToast(`Site added: ${PIN_BY_ID[picked]?.label}`)
    onClose?.()
  }

  return createPortal(
    <div
      data-testid="add-site-screen"
      className="fixed inset-0 z-[60] flex flex-col"
      style={{
        background: 'var(--bg)',
        height: '100dvh',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3">
        <h2 className="truncate text-lg font-black tracking-tight">
          Where did {peptide ? displayName(peptide) : 'it'} go?
        </h2>
        <button onClick={onClose} className="shrink-0 rounded-full p-2" style={{ background: 'var(--surface-sunk)' }} aria-label="Cancel">
          <X size={16} />
        </button>
      </div>
      <div className="mt-2 shrink-0 px-4">
        <div className="flex gap-1 rounded-full p-1" style={{ background: 'var(--surface-sunk)' }}>
          {['front', 'back'].map((v) => (
            <button key={v} data-testid={`addsite-view-${v}`} onClick={() => setView(v)}
              className="flex-1 rounded-full py-2 text-sm font-bold capitalize"
              style={view === v ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { color: 'var(--text-2)' }}>
              {v}
            </button>
          ))}
        </div>
      </div>
      <div ref={areaRef} className="min-h-0 flex-1 px-2 py-2">
        <SiteMap fit="contain" maxHeight={mapH - AREA_PADDING_PX} view={view} onView={setView} showChrome={false}
          forPeptideId={peptideId} selectedId={picked} onSelect={(p) => setPicked(p.id)} />
      </div>
      <div className="shrink-0 px-4 pb-3">
        {picked && <p className="mb-2 text-sm font-black">{PIN_BY_ID[picked]?.label}</p>}
        <button data-testid="addsite-save" onClick={save} disabled={!picked}
          className="btn-primary w-full rounded-full py-3 text-sm font-black disabled:opacity-40">
          Add site
        </button>
      </div>
    </div>,
    document.body,
  )
}

export { colourHex }
