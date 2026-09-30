import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Phone, ChevronRight, Plus, Camera, Image as ImageIcon } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import { displayName } from '../../lib/naming'
import { prettyDate } from '../../lib/schedule'
import { putBlob, blobUrl, getBlob, revokeBlobUrl } from '../../lib/blobStore'
import { importPhoto } from '../../lib/photoImport'
import { PIN_BY_ID, GROUPS } from '../../lib/sitePins'
import {
  SEVERITIES, SEVERITY_BY_ID, RATED_SEVERITIES, SAFETY_FLAGS, DEFAULT_CHECK_TIME,
  activeSafety, checkDue, newSites, openSites, pinStatusWords, suggestedPin,
  peptideScorecards, groupScorecards, peptideDetail, pinHistory, topLine,
  durationWords, recentOtherUse, reuseWarning, mixedWarning, findMixedGroup,
  needsSymptomReview, MIN_FOR_NUMBERS,
} from '../../lib/reactionTracker'
import SiteMap from './SiteMap'
import SiteMapSettings from './SiteMapSettings'

const pct = (r) => (r == null ? '—' : `${Math.round(r * 100)}%`)

/** Everything on this screen needs the same two arrays. */
function useCtx() {
  const records = useStore((s) => s.injectionRecords)
  const reactions = useStore((s) => s.reactions)
  return useMemo(() => ({ records, reactions, nowIso: new Date().toISOString() }), [records, reactions])
}

function usePeptideName() {
  const peptides = useStore((s) => s.peptides)
  return useMemo(() => (id) => {
    const p = peptides.find((x) => x.id === id)
    return p ? displayName(p) : 'Unknown'
  }, [peptides])
}

/**
 * The safety banner.
 *
 * Cannot be switched off and does not time out. It stays until somebody taps
 * "Cleared", because the only person who can say a red streak has gone is the
 * person looking at it.
 */
export function SafetyBanner() {
  const flags = useStore((s) => s.safetyFlags)
  const clearAll = useStore((s) => s.clearAllSafetyFlags)
  const active = useMemo(() => activeSafety(flags), [flags])
  if (!active) return null
  const emergency = active.level === 'emergency'
  return (
    <div
      data-testid="safety-banner"
      data-level={active.level}
      className="card p-4"
      style={{
        background: 'color-mix(in srgb, var(--danger) 18%, var(--surface-solid))',
        borderColor: 'var(--danger)',
      }}
    >
      <div className="flex items-start gap-3">
        {emergency ? <Phone size={20} style={{ color: 'var(--danger)' }} /> : <AlertTriangle size={20} style={{ color: 'var(--danger)' }} />}
        <div className="min-w-0 flex-1">
          <div className="text-base font-black" style={{ color: 'var(--danger)' }}>{active.title}</div>
          <div className="t-caption mt-1" style={{ color: 'var(--text)' }}>{active.reasons.join(' · ')}</div>
          <button
            data-testid="safety-clear"
            onClick={clearAll}
            className="chip mt-3"
          >
            Cleared
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The tracker.
 *
 * One question, asked once a day: which peptide irritates the site, how badly,
 * and for how long. Everything on this screen exists to answer it, and nothing
 * on it is a chart.
 */
export default function ReactionTracker() {
  const ctx = useCtx()
  const nameOf = usePeptideName()
  const settings = useStore((s) => s.reactionSettings)
  const [checkOpen, setCheckOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [pinOpen, setPinOpen] = useState(null)
  const [peptideOpen, setPeptideOpen] = useState(null)
  const [selected, setSelected] = useState(null)

  const due = checkDue(ctx)
  const cards = useMemo(() => peptideScorecards(ctx), [ctx])
  const groups = useMemo(() => groupScorecards(ctx), [ctx])
  const line = useMemo(() => topLine(ctx, nameOf), [ctx, nameOf])
  const review = useMemo(() => needsSymptomReview(ctx), [ctx])

  return (
    <div className="space-y-3">
      <SafetyBanner />

      {review && (
        <button
          data-testid="severe-streak"
          onClick={() => setCheckOpen(true)}
          className="card w-full p-3 text-left t-caption"
          style={{ background: 'color-mix(in srgb, var(--warn) 14%, var(--surface-solid))' }}
        >
          The same site has been severe three evenings running. Worth going through Other symptoms.
        </button>
      )}

      <FirstRunPrompt />

      <div className="flex gap-2">
        <button data-testid="log-injection" onClick={() => setLogOpen(true)} className="btn-primary flex flex-1 items-center justify-center gap-2 py-3">
          <Plus size={16} /> Log injection
        </button>
        <button
          data-testid="open-check"
          onClick={() => setCheckOpen(true)}
          className="chip px-4"
          style={due ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' } : undefined}
        >
          Evening check{due ? ' ·' : ''}
        </button>
      </div>

      <div className="card p-4">
        <div className="t-label mb-1" style={{ color: 'var(--text-3)' }}>Summary</div>
        <div className="text-sm font-bold" data-testid="reaction-topline">{line}</div>
      </div>

      <div className="card p-4">
        <div className="t-label mb-3" style={{ color: 'var(--text-3)' }}>Sites</div>
        <SiteMap
          onSelect={(p) => setSelected(p)}
          selectedId={selected?.id || null}
        />
        {selected && (
          <div className="mt-3 rounded-[var(--r-sm)] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid="pin-bar">
            <div className="text-sm font-black">{selected.label}</div>
            <div className="t-caption mt-0.5" style={{ color: 'var(--text-2)' }}>{pinStatusWords(selected.id, ctx)}</div>
            <div className="mt-2 flex gap-2">
              <button className="chip" data-testid="pin-history" onClick={() => setPinOpen(selected.id)}>History</button>
              <button className="chip" data-testid="pin-confirm" onClick={() => { setLogOpen(selected.id); }}>Confirm</button>
            </div>
          </div>
        )}
      </div>

      <div className="card p-4">
        <div className="t-label mb-2" style={{ color: 'var(--text-3)' }}>By peptide</div>
        {cards.length === 0 && (
          <div className="t-caption" style={{ color: 'var(--text-2)' }}>Nothing logged yet.</div>
        )}
        <div className="rows">
          {cards.map((c) => (
            <button
              key={c.peptideId}
              data-testid={`peptide-card-${c.peptideId}`}
              onClick={() => setPeptideOpen(c.peptideId)}
              className="flex w-full items-center gap-3 py-2 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-black">{nameOf(c.peptideId)}</div>
                <div className="t-caption" style={{ color: 'var(--text-2)' }}>
                  {c.enough
                    ? `Reacted ${c.reacted} of ${c.n}${c.commonSeverity ? ` · mostly ${SEVERITY_BY_ID[c.commonSeverity]?.label.toLowerCase()}` : ''}${c.avgDurationDays != null ? ` · ${c.avgDurationDays} days on average` : ''}`
                    : `Need more data — ${c.n} of ${MIN_FOR_NUMBERS} rated`}
                </div>
              </div>
              <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
            </button>
          ))}
        </div>
      </div>

      <div className="card p-4">
        <div className="t-label mb-2" style={{ color: 'var(--text-3)' }}>By site</div>
        {groups.length === 0 && (
          <div className="t-caption" style={{ color: 'var(--text-2)' }}>Nothing rated yet.</div>
        )}
        <div className="rows">
          {groups.map((g) => (
            <div key={g.group} className="flex items-center gap-3 py-2" data-testid={`group-card-${g.group}`}>
              <div className="min-w-0 flex-1 text-sm font-black">{g.label}</div>
              <div className="t-caption tabular-nums" style={{ color: 'var(--text-2)' }}>
                {g.enough
                  ? `${pct(g.rate)} · ${g.avgDurationDays != null ? `${g.avgDurationDays} days` : 'no duration yet'}`
                  : 'Need more data'}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="t-caption" style={{ color: 'var(--text-3)' }}>
        Evening check at {settings?.checkTime || DEFAULT_CHECK_TIME}. Change it in Settings &gt; Site map.
      </div>

      <EveningCheck open={checkOpen} onClose={() => setCheckOpen(false)} />
      <LogInjection
        open={!!logOpen}
        pinId={typeof logOpen === 'string' ? logOpen : null}
        onClose={() => setLogOpen(false)}
      />
      <PinHistory pinId={pinOpen} onClose={() => setPinOpen(null)} />
      <PeptideDetail peptideId={peptideOpen} onClose={() => setPeptideOpen(null)} />
    </div>
  )
}

/**
 * The first-run prompt.
 *
 * The map works without a photo — the pins are where they are — but it is far
 * harder to aim at a grey rectangle, so this asks once and then never again.
 */
function FirstRunPrompt() {
  const siteMap = useStore((s) => s.siteMap)
  const [open, setOpen] = useState(false)
  if (siteMap?.photoKey) return null
  return (
    <>
      <button
        data-testid="map-first-run"
        onClick={() => setOpen(true)}
        className="card w-full p-3 text-left"
        style={{ background: 'color-mix(in srgb, var(--info) 12%, var(--surface-solid))' }}
      >
        <div className="text-sm font-black">Import your map photo</div>
        <div className="t-caption" style={{ color: 'var(--text-2)' }}>
          One full-body photo makes the sites easy to aim at. It stays on this phone.
        </div>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Site map photo">
        <SiteMapSettings />
      </Modal>
    </>
  )
}

/**
 * The Today card.
 *
 * Shows only when something is actually waiting. A card that is always there
 * saying "nothing to do" is a card people stop reading, and this one has to be
 * read on the evening it matters.
 */
export function EveningCheckCard() {
  const ctx = useCtx()
  const [open, setOpen] = useState(false)
  const fresh = newSites(ctx).length
  const still = openSites(ctx).length
  if (!fresh && !still) return null
  const bits = []
  if (fresh) bits.push(`${fresh} new site${fresh === 1 ? '' : 's'}`)
  if (still) bits.push(`${still} still reacting`)
  return (
    <>
      <button
        data-testid="evening-check-card"
        onClick={() => setOpen(true)}
        className="card flex w-full items-center gap-3 p-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="text-base font-black">Evening check</div>
          <div className="t-caption" style={{ color: 'var(--text-2)' }}>{bits.join(' · ')} · about ten seconds</div>
        </div>
        <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
      </button>
      <EveningCheck open={open} onClose={() => setOpen(false)} />
    </>
  )
}

// ------------------------------------------------------------ logging

/** Tap the pin, save. Everything else on this sheet is a warning or a default. */
export function LogInjection({ open, onClose, pinId: initialPin = null, doseLogId = null, peptideId: fixedPeptide = null }) {
  const peptides = useStore((s) => s.peptides)
  const records = useStore((s) => s.injectionRecords)
  const log = useStore((s) => s.logInjection)
  const nameOf = usePeptideName()
  const ctx = useCtx()

  const injectable = peptides.filter((p) => p.route !== 'oral' && !p.archived)
  const [peptideId, setPeptideId] = useState(fixedPeptide || injectable[0]?.id || null)
  const [pinId, setPinId] = useState(initialPin)
  const [group, setGroup] = useState(null)

  const suggested = useMemo(() => suggestedPin({ ...ctx, group }), [ctx, group])
  const pin = pinId ? PIN_BY_ID[pinId] : null
  const now = new Date().toISOString()

  const clash = pin ? findMixedGroup(records, { pinId, timestamp: now, peptideId }) : []
  const prev = pin ? recentOtherUse(records, { pinId, peptideId, nowIso: now }) : null

  const save = () => {
    if (!pinId || !peptideId) return
    log({ peptideId, pinId, doseLogId })
    onClose?.()
  }

  return (
    <Modal open={open} onClose={onClose} title="Log injection">
      <div className="space-y-3">
        {!fixedPeptide && (
          <div>
            <div className="t-label mb-2" style={{ color: 'var(--text-3)' }}>Peptide</div>
            <div className="flex flex-wrap gap-2">
              {injectable.map((p) => (
                <button
                  key={p.id}
                  data-testid={`log-peptide-${p.id}`}
                  onClick={() => setPeptideId(p.id)}
                  className="chip"
                  style={peptideId === p.id ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' } : undefined}
                >
                  {displayName(p)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="t-label" style={{ color: 'var(--text-3)' }}>Site</div>
            {suggested && (
              <button className="t-caption underline" data-testid="use-suggested" onClick={() => setPinId(suggested)} style={{ color: 'var(--lime)' }}>
                Use {PIN_BY_ID[suggested]?.label}
              </button>
            )}
          </div>
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {[{ id: null, label: 'All' }, ...GROUPS].map((g) => (
              <button
                key={g.id || 'all'}
                onClick={() => setGroup(g.id)}
                className="chip shrink-0"
                style={group === g.id ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' } : undefined}
              >
                {g.label}
              </button>
            ))}
          </div>
          <SiteMap
            onSelect={(p) => setPinId(p.id)}
            selectedId={pinId}
            groupFilter={group ? [group] : []}
          />
        </div>

        {pin && (
          <div className="rounded-[var(--r-sm)] p-3" style={{ background: 'var(--surface-sunk)' }}>
            <div className="text-sm font-black" data-testid="log-pin-label">{pin.label}</div>
            <div className="t-caption mt-0.5" style={{ color: 'var(--text-2)' }}>{pinStatusWords(pin.id, ctx)}</div>
          </div>
        )}

        {clash.length > 0 && (
          <div data-testid="mixed-warning" className="rounded-[var(--r-sm)] p-3 t-caption" style={{ background: 'color-mix(in srgb, var(--warn) 16%, transparent)', color: 'var(--warn)' }}>
            {mixedWarning()}
          </div>
        )}
        {prev && (
          <div data-testid="reuse-warning" className="rounded-[var(--r-sm)] p-3 t-caption" style={{ background: 'color-mix(in srgb, var(--info) 16%, transparent)', color: 'var(--info)' }}>
            {reuseWarning(prev, nameOf)}
            {suggested && suggested !== pinId && (
              <button className="ml-1 underline" data-testid="reuse-suggestion" onClick={() => setPinId(suggested)}>
                Try {PIN_BY_ID[suggested]?.label}.
              </button>
            )}
          </div>
        )}

        <button data-testid="log-save" onClick={save} disabled={!pinId || !peptideId} className="btn-primary w-full py-3 disabled:opacity-40">
          Save
        </button>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------- the evening check

/**
 * The whole check, on one screen.
 *
 * New sites first, then anything still going. Nothing nags: a missed evening
 * simply means everything still open appears on the next one, dated by when it
 * was actually tapped rather than when it was due.
 */
export function EveningCheck({ open, onClose }) {
  const ctx = useCtx()
  const nameOf = usePeptideName()
  const rateSite = useStore((s) => s.rateSite)
  const markGone = useStore((s) => s.markGone)
  const markStillThere = useStore((s) => s.markStillThere)
  const recordCheck = useStore((s) => s.recordCheck)
  const raise = useStore((s) => s.raiseSafetyFlag)
  const flags = useStore((s) => s.safetyFlags)

  const [meanings, setMeanings] = useState(false)
  const [others, setOthers] = useState(false)
  const fresh = newSites(ctx)
  const still = openSites(ctx)
  const t = todayStr()

  const done = () => { recordCheck(); onClose?.() }

  return (
    <Modal open={open} onClose={done} title="Evening check">
      <div className="space-y-4">
        {fresh.length === 0 && still.length === 0 && (
          <div className="t-caption" style={{ color: 'var(--text-2)' }} data-testid="check-empty">
            Nothing to check tonight.
          </div>
        )}

        {fresh.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="t-label" style={{ color: 'var(--text-3)' }}>New sites</div>
              <button className="t-caption underline" data-testid="what-do-these-mean" onClick={() => setMeanings((v) => !v)} style={{ color: 'var(--text-3)' }}>
                What do these mean?
              </button>
            </div>
            {meanings && (
              <div className="mb-2 rounded-[var(--r-sm)] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid="severity-meanings">
                {SEVERITIES.map((s) => (
                  <div key={s.id} className="t-caption" style={{ color: 'var(--text-2)' }}>
                    <span className="font-black" style={{ color: 'var(--text)' }}>{s.label}</span> — {s.words}
                  </div>
                ))}
              </div>
            )}
            <div className="rows">
              {fresh.map((r) => (
                <CheckRow key={r.id} record={r} nameOf={nameOf}>
                  <div className="mt-2 grid grid-cols-4 gap-1.5">
                    {SEVERITIES.map((s) => (
                      <button
                        key={s.id}
                        data-testid={`rate-${r.id}-${s.id}`}
                        onClick={() => rateSite(r.id, s.id, t)}
                        className="rounded-[var(--r-sm)] py-2 text-xs font-black"
                        style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </CheckRow>
              ))}
            </div>
          </div>
        )}

        {still.length > 0 && (
          <div>
            <div className="t-label mb-2" style={{ color: 'var(--text-3)' }}>Still reacting</div>
            <div className="rows">
              {still.map(({ record, reaction }) => (
                <CheckRow key={record.id} record={record} nameOf={nameOf} reaction={reaction}>
                  <div className="mt-2 flex gap-1.5">
                    <button
                      data-testid={`still-${record.id}`}
                      onClick={() => markStillThere(record.id, t)}
                      className="flex-1 rounded-[var(--r-sm)] py-2 text-xs font-black"
                      style={{ background: 'var(--surface-sunk)' }}
                    >
                      Still there
                    </button>
                    <button
                      data-testid={`gone-${record.id}`}
                      onClick={() => markGone(record.id, t)}
                      className="flex-1 rounded-[var(--r-sm)] py-2 text-xs font-black"
                      style={{ background: 'color-mix(in srgb, var(--good) 22%, transparent)', color: 'var(--good)' }}
                    >
                      Gone
                    </button>
                  </div>
                  <UpdateSeverity record={record} onPick={(sev) => rateSite(record.id, sev, t)} />
                </CheckRow>
              ))}
            </div>
          </div>
        )}

        <div>
          <button className="t-caption underline" data-testid="other-symptoms" onClick={() => setOthers((v) => !v)} style={{ color: 'var(--text-2)' }}>
            Other symptoms
          </button>
          {others && (
            <div className="mt-2 rows" data-testid="other-symptoms-list">
              {SAFETY_FLAGS.map((f) => {
                const on = flags.some((x) => x.type === f.id && !x.clearedAt)
                return (
                  <button
                    key={f.id}
                    data-testid={`safety-${f.id}`}
                    onClick={() => raise(f.id, t)}
                    className="flex w-full items-center justify-between py-2 text-left"
                  >
                    <span className="text-sm font-bold">{f.label}</span>
                    <span
                      className="h-5 w-5 rounded-full"
                      style={{ background: on ? 'var(--danger)' : 'var(--surface-sunk)', border: '1px solid var(--border)' }}
                    />
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <button onClick={done} className="btn-primary w-full py-3" data-testid="check-done">Done</button>
      </div>
    </Modal>
  )
}

function UpdateSeverity({ record, onPick }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-1">
      <button className="t-caption underline" data-testid={`update-severity-${record.id}`} onClick={() => setOpen((v) => !v)} style={{ color: 'var(--text-3)' }}>
        Update severity
      </button>
      {open && (
        <div className="mt-1 flex gap-1.5">
          {RATED_SEVERITIES.map((s) => (
            <button
              key={s.id}
              data-testid={`resev-${record.id}-${s.id}`}
              onClick={() => { onPick(s.id); setOpen(false) }}
              className="chip"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** One row: where, what, when — plus an optional photo. */
function CheckRow({ record, reaction, nameOf, children }) {
  const pin = PIN_BY_ID[record.pinId]
  const when = new Date(record.timestamp)
  return (
    <div className="py-2" data-testid={`check-row-${record.id}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black">{pin?.label || 'Unpinned site'}</div>
          <div className="t-caption" style={{ color: 'var(--text-2)' }}>
            {nameOf(record.peptideId)} · {when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {record.mixed ? ' · mixed' : ''}
            {reaction?.worstSeverity ? ` · ${SEVERITY_BY_ID[reaction.worstSeverity]?.label.toLowerCase()}` : ''}
          </div>
        </div>
        <RowPhoto record={record} reaction={reaction} />
      </div>
      {children}
    </div>
  )
}

/** One photo per row, no annotation. Camera or library, the same as the body tab. */
function RowPhoto({ record, reaction }) {
  const addPhoto = useStore((s) => s.addReactionPhoto)
  const [busy, setBusy] = useState(false)
  const has = (reaction?.photoIds || []).length > 0

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const out = await importPhoto(file)
      if (out.ok) {
        const key = `rx-${record.id}-${Date.now()}`
        await putBlob(key, out.blob)
        addPhoto(record.id, key)
      }
    } finally { setBusy(false) }
  }

  return (
    <label className="shrink-0 rounded-full p-2" style={{ background: has ? 'color-mix(in srgb, var(--good) 20%, transparent)' : 'var(--surface-sunk)' }}>
      {busy ? <span className="t-caption">…</span> : has ? <ImageIcon size={14} /> : <Camera size={14} />}
      <input type="file" accept="image/*" className="hidden" onChange={pick} data-testid={`row-photo-${record.id}`} />
    </label>
  )
}

// -------------------------------------------------------------- the detail

function PeptideDetail({ peptideId, onClose }) {
  const ctx = useCtx()
  const nameOf = usePeptideName()
  const detail = useMemo(() => (peptideId ? peptideDetail(peptideId, ctx) : null), [peptideId, ctx])
  if (!peptideId || !detail) return null
  const o = detail.overall
  return (
    <Modal open onClose={onClose} title={nameOf(peptideId)}>
      <div className="space-y-4">
        <div className="rounded-[var(--r-sm)] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid="peptide-overall">
          {o.enough ? (
            <div className="t-caption" style={{ color: 'var(--text-2)' }}>
              Reacted {o.reacted} of {o.n}
              {o.commonSeverity ? ` · mostly ${SEVERITY_BY_ID[o.commonSeverity]?.label.toLowerCase()}` : ''}
              {o.avgDurationDays != null ? ` · ${o.avgDurationDays} days on average` : ''}
            </div>
          ) : (
            <div className="t-caption" style={{ color: 'var(--text-2)' }}>Need more data — {o.n} of {MIN_FOR_NUMBERS} rated.</div>
          )}
        </div>

        {detail.groups.length > 0 && (
          <div>
            <div className="t-label mb-1" style={{ color: 'var(--text-3)' }}>By site</div>
            <div className="rows">
              {detail.groups.map((g) => (
                <div key={g.group} className="flex items-center justify-between py-1.5" data-testid={`peptide-group-${g.group}`}>
                  <span className="text-sm font-bold">{g.label}</span>
                  <span className="t-caption tabular-nums" style={{ color: 'var(--text-2)' }}>
                    {g.enough ? `Reacted ${g.reacted} of ${g.n}${g.avgDurationDays != null ? ` · ${g.avgDurationDays} days` : ''}` : 'Need more data'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="t-label mb-1" style={{ color: 'var(--text-3)' }}>Injections</div>
          <div className="rows">
            {detail.injections.map((row) => (
              <InjectionRow key={row.record.id} row={row} />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function PinHistory({ pinId, onClose }) {
  const ctx = useCtx()
  const nameOf = usePeptideName()
  const rows = useMemo(() => (pinId ? pinHistory(pinId, ctx) : []), [pinId, ctx])
  if (!pinId) return null
  return (
    <Modal open onClose={onClose} title={PIN_BY_ID[pinId]?.label || 'Site'}>
      <div className="rows" data-testid="pin-history-list">
        {rows.length === 0 && <div className="t-caption py-2" style={{ color: 'var(--text-2)' }}>Never used.</div>}
        {rows.map((row) => (
          <InjectionRow key={row.record.id} row={row} withPeptide nameOf={nameOf} />
        ))}
      </div>
    </Modal>
  )
}

function InjectionRow({ row, withPeptide = false, nameOf }) {
  const { record, reaction, severity } = row
  const pin = PIN_BY_ID[record.pinId]
  const [url, setUrl] = useState(null)
  const key = (reaction?.photoIds || [])[0]
  useEffect(() => {
    if (!key) { setUrl(null); return undefined }
    let dead = false
    let made = null
    getBlob(key).then((b) => {
      if (dead || !b) return
      made = blobUrl(b)
      setUrl(made)
    })
    return () => { dead = true; if (made) revokeBlobUrl(made) }
  }, [key])

  const dur = row.durationDays
  return (
    <div className="flex items-center gap-3 py-2" data-testid={`injection-row-${record.id}`}>
      {url ? (
        <img src={url} alt="" className="h-10 w-10 shrink-0 rounded-[var(--r-sm)] object-cover" />
      ) : (
        <div className="h-10 w-10 shrink-0 rounded-[var(--r-sm)]" style={{ background: 'var(--surface-sunk)' }} />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold">
          {withPeptide ? nameOf?.(record.peptideId) : (pin?.label || 'Unpinned site')}
        </div>
        <div className="t-caption" style={{ color: 'var(--text-2)' }}>
          {prettyDate(String(record.timestamp).slice(0, 10))}
          {record.mixed ? ' · mixed' : ''}
          {' · '}
          {row.rated === false || (!reaction?.ratings?.length)
            ? 'Not checked'
            : `${SEVERITY_BY_ID[severity]?.label || 'None'}${dur != null ? ` · ${durationWords(dur)}` : ''}`}
        </div>
      </div>
    </div>
  )
}
