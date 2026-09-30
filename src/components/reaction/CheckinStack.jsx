import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, ChevronDown, ChevronRight, Camera, AlertTriangle } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import NumberField from '../ui/NumberField'
import { ZONE_BY_ID } from '../../lib/reactionZones'
import { checkinsDue, sinceWords, shouldResolve, spreadPct, spreadWords } from '../../lib/reactionCheckins'
import { safetyCheck } from '../../lib/reactionScore'
import { putBlob, blobUrl } from '../../lib/blobStore'
import PhotoTrace from './PhotoTrace'

/**
 * Answering the question for every site at once.
 *
 * The default on every card is "all clear", because most of the time it is, and
 * a flow that made the common answer as much work as the rare one would not get
 * used past the second week. One swipe clears a site. Everything else — the
 * photo, the scales, the toggles — only appears when the answer is "still
 * there", which is the only time any of it is worth collecting.
 */

const SEVERITY_ANCHORS = [
  { at: 0, word: 'None' }, { at: 3, word: 'Mild' }, { at: 6, word: 'Moderate' }, { at: 9, word: 'Severe' },
]

export default function CheckinStack({ open, onClose }) {
  const reactions = useStore((s) => s.reactions)
  const checkins = useStore((s) => s.reactionCheckins)
  const records = useStore((s) => s.injectionRecords)
  const settings = useStore((s) => s.reactionSettings)
  const saveCheckin = useStore((s) => s.saveCheckin)
  const resolveReaction = useStore((s) => s.resolveReaction)
  const showToast = useStore((s) => s.showToast)

  const [detailFor, setDetailFor] = useState(null)
  const [i, setI] = useState(0)

  const nowIso = new Date().toISOString()
  const due = useMemo(
    () => checkinsDue({ reactions, checkins, windows: settings?.windowTimes, nowIso }),
    [reactions, checkins, settings, nowIso]
  )

  useEffect(() => { if (open) setI(0) }, [open])
  if (!open) return null

  const card = due[i] || null

  const recordOf = (rx) => records.find((r) => r.id === rx.injectionRecordId)

  const clear = (entry) => {
    const saved = saveCheckin(entry.reaction.id, {
      windowId: entry.window.id,
      scheduledWindow: entry.window.dueAt,
      present: false,
    })
    const mine = [...checkins.filter((c) => c.reactionId === entry.reaction.id), saved]
    if (shouldResolve(mine)) {
      resolveReaction(entry.reaction.id)
      showToast('Site cleared and closed')
    }
    setI((n) => n + 1)
  }

  return (
    <Modal open onClose={onClose} wide title="Check-ins">
      <div className="space-y-3" data-testid="checkin-stack">
        {!card && (
          <div className="py-8 text-center" data-testid="checkins-done">
            <p className="text-sm font-black">Nothing to check</p>
            <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
              Every open site has been looked at.
            </p>
            <button onClick={onClose} className="btn-primary mt-4 rounded-full px-6 py-3 text-xs font-black">
              Done
            </button>
          </div>
        )}

        {card && (
          <>
            <p className="t-caption" style={{ color: 'var(--text-2)' }}>
              {i + 1} of {due.length}
            </p>
            <SwipeCard
              key={card.reaction.id}
              entry={card}
              record={recordOf(card.reaction)}
              lastPhoto={null}
              onClear={() => clear(card)}
              onPresent={() => setDetailFor(card)}
            />
            <p className="px-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
              Swipe right if it has gone, left if it is still there. The buttons do the same thing.
            </p>
          </>
        )}

        <DetailSheet
          entry={detailFor}
          record={detailFor ? recordOf(detailFor.reaction) : null}
          onClose={() => setDetailFor(null)}
          onSaved={() => { setDetailFor(null); setI((n) => n + 1) }}
        />
      </div>
    </Modal>
  )
}

function SwipeCard({ entry, record, onClear, onPresent }) {
  const zone = ZONE_BY_ID[record?.zoneId]
  const compounds = (record?.compoundIds || []).join(' + ') || 'control shot'
  const nowIso = new Date().toISOString()

  return (
    <motion.div
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.5}
      onDragEnd={(e, info) => {
        if (info.offset.x > 90) onClear()
        else if (info.offset.x < -90) onPresent()
      }}
      className="card p-4"
      data-testid="checkin-card"
      data-reaction={entry.reaction.id}>
      <p className="text-sm font-black">{zone?.label || 'Site'}</p>
      <p className="mt-0.5 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
        {compounds} · {sinceWords(entry.reaction.injectedAt, nowIso)}
      </p>
      {entry.missed > 0 && (
        <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
          {entry.missed} window{entry.missed === 1 ? '' : 's'} went by — one answer covers them.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button onClick={onPresent} data-testid="checkin-present"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-3 text-xs font-black"
          style={{ background: 'var(--surface-sunk)', color: 'var(--warn)' }}>
          <X size={13} /> Still there
        </button>
        <button onClick={onClear} data-testid="checkin-clear"
          className="btn-primary flex flex-1 items-center justify-center gap-1.5 rounded-full py-3 text-xs font-black">
          <Check size={13} /> All clear
        </button>
      </div>
    </motion.div>
  )
}

/** Everything worth collecting, but only once the answer is "still there". */
function DetailSheet({ entry, record, onClose, onSaved }) {
  const settings = useStore((s) => s.reactionSettings)
  const checkins = useStore((s) => s.reactionCheckins)
  const photos = useStore((s) => s.reactionPhotos)
  const saveCheckin = useStore((s) => s.saveCheckin)
  const addReactionPhoto = useStore((s) => s.addReactionPhoto)
  const showToast = useStore((s) => s.showToast)

  const [itch, setItch] = useState(0)
  const [pain, setPain] = useState(0)
  const [flags, setFlags] = useState({})
  const [other, setOther] = useState(false)
  const [tracing, setTracing] = useState(false)
  const [trace, setTrace] = useState(null)
  const [manualMm, setManualMm] = useState(0)
  const [ghost, setGhost] = useState(null)
  const [note, setNote] = useState('')

  const rxId = entry?.reaction?.id
  const prior = useMemo(
    () => checkins.filter((c) => c.reactionId === rxId && c.completedAt)
      .sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt))),
    [checkins, rxId]
  )
  const lastPhoto = useMemo(
    () => photos.filter((p) => p.reactionId === rxId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null,
    [photos, rxId]
  )

  useEffect(() => {
    if (!entry) return
    setItch(0); setPain(0); setFlags({}); setOther(false)
    setTracing(false); setTrace(null); setManualMm(0); setNote('')
  }, [entry])

  useEffect(() => {
    let alive = true
    if (lastPhoto?.blobKey) blobUrl(lastPhoto.blobKey).then((u) => { if (alive) setGhost(u) })
    else setGhost(null)
    return () => { alive = false }
  }, [lastPhoto])

  if (!entry) return null

  const diameterMm = trace?.measurements?.diameterMm ?? (manualMm > 0 ? manualMm : null)
  const areaMm2 = trace?.measurements?.areaMm2 ?? null
  const prevArea = [...prior].reverse().find((c) => c.tracedAreaMm2 != null)?.tracedAreaMm2 ?? null
  const spread = spreadPct(areaMm2, prevArea)

  const draft = {
    present: true, itch, pain, ...flags,
    diameterMm, tracedAreaMm2: areaMm2, spreadPct: spread,
  }
  const danger = safetyCheck(draft, prior.at(-1) || null)

  const save = async () => {
    const saved = saveCheckin(entry.reaction.id, {
      windowId: entry.window.id,
      scheduledWindow: entry.window.dueAt,
      ...draft,
      note,
    })
    if (trace?.blob) {
      const key = `rxphoto-${saved.id}`
      const ok = await putBlob(key, trace.blob)
      if (ok) {
        addReactionPhoto({
          checkinId: saved.id, reactionId: entry.reaction.id, zoneId: record?.zoneId,
          blobKey: key, width: trace.width, height: trace.height,
          coinCalibration: trace.coinCalibration, tracePaths: trace.tracePaths,
        })
      }
    }
    showToast('Check-in saved')
    onSaved?.()
  }

  return (
    <Modal open onClose={onClose} wide title={ZONE_BY_ID[record?.zoneId]?.label || 'Still there'}>
      <div className="space-y-3" data-testid="checkin-detail">
        {danger && (
          <div className="card p-3" data-testid="detail-safety"
            style={{ background: danger.level === 'emergency' ? 'var(--danger)' : 'color-mix(in srgb, var(--danger) 18%, transparent)' }}>
            <p className="flex items-center gap-1.5 text-sm font-black"
              style={{ color: danger.level === 'emergency' ? 'var(--accent-fg)' : 'var(--danger)' }}>
              <AlertTriangle size={14} /> {danger.title}
            </p>
            <p className="mt-0.5 text-xs font-bold"
              style={{ color: danger.level === 'emergency' ? 'var(--accent-fg)' : 'var(--text)' }}>
              {danger.reasons.join(' · ')}
            </p>
          </div>
        )}

        {/* the photo first, because the measurement comes off it */}
        {tracing ? (
          <PhotoTrace
            coinId={settings?.coin}
            ghostUrl={ghost}
            previousTrace={lastPhoto?.tracePaths?.redness || null}
            onDone={(r) => { setTrace(r); setTracing(false) }}
            onCancel={() => setTracing(false)}
          />
        ) : (
          <button onClick={() => setTracing(true)} data-testid="open-trace"
            className="flex w-full items-center justify-center gap-2 rounded-full py-3 text-xs font-black"
            style={{ background: trace ? 'var(--surface-sunk)' : 'var(--accent)', color: trace ? 'var(--text-2)' : 'var(--accent-fg)' }}>
            <Camera size={14} /> {trace ? `Traced · ${trace.measurements?.diameterMm} mm` : 'Photograph and trace it'}
          </button>
        )}

        {spread != null && (
          <p className="px-1 text-xs font-bold" data-testid="spread-line"
            style={{ color: spread > 10 ? 'var(--warn)' : 'var(--text-2)' }}>
            {spreadWords(spread)}
          </p>
        )}

        {!trace && (
          <label className="block">
            <span className="t-caption mb-1 block" style={{ color: 'var(--text-2)' }}>
              Or measure it yourself (mm across)
            </span>
            <NumberField value={manualMm} min={0} aria-label="Redness across"
              data-testid="manual-mm" onChange={(v) => setManualMm(v ?? 0)} />
          </label>
        )}

        <Scale label="Itch" value={itch} onChange={setItch} testid="scale-itch" />
        <Scale label="Pain" value={pain} onChange={setPain} testid="scale-pain" />

        <div className="flex flex-wrap gap-1.5" data-testid="detail-toggles">
          {[['welt', 'Raised welt'], ['lump', 'Hard lump'], ['warm', 'Warm to touch'], ['bruise', 'Bruise']].map(([k, label]) => (
            <Toggle key={k} label={label} on={!!flags[k]} testid="detail-toggle" flag={k}
              onClick={() => setFlags((f) => ({ ...f, [k]: !f[k] }))} />
          ))}
        </div>

        {/* the things that stop this being an experiment and start it being a
            trip to a doctor, folded away but never removed */}
        <div className="card overflow-hidden">
          <button onClick={() => setOther((v) => !v)} aria-expanded={other} data-testid="other-symptoms-toggle"
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
            {other ? <ChevronDown size={14} style={{ color: 'var(--text-3)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-3)' }} />}
            <span className="text-xs font-bold" style={{ color: 'var(--text-2)' }}>Other symptoms</span>
          </button>
          <AnimatePresence initial={false}>
            {other && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} className="overflow-hidden" data-testid="other-symptoms">
                <div className="flex flex-wrap gap-1.5 px-3 pb-3" style={{ borderTop: '1px solid var(--border)' }}>
                  {[['redStreaks', 'Red streaks'], ['pus', 'Pus'], ['fever', 'Fever'],
                    ['elsewhere', 'Symptoms elsewhere'], ['faceSwelling', 'Lip or face swelling'],
                    ['throatSwelling', 'Throat swelling'], ['breathing', 'Trouble breathing']].map(([k, label]) => (
                    <Toggle key={k} label={label} on={!!flags[k]} danger testid="safety-toggle" flag={k}
                      onClick={() => setFlags((f) => ({ ...f, [k]: !f[k] }))} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <label className="block">
          <span className="t-caption mb-1 block" style={{ color: 'var(--text-2)' }}>Note</span>
          <input className="input" value={note} aria-label="Note" data-testid="checkin-note"
            placeholder="Anything worth remembering" onChange={(e) => setNote(e.target.value)} />
        </label>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-full py-3 text-xs font-black"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>Cancel</button>
          <button onClick={save} data-testid="checkin-save"
            className="btn-primary flex-1 rounded-full py-3 text-xs font-black">Save</button>
        </div>
      </div>
    </Modal>
  )
}

/** A 0–10 scale with words under it, because a bare number means nothing. */
function Scale({ label, value, onChange, testid }) {
  return (
    <div data-testid={testid}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="t-caption" style={{ color: 'var(--text-2)' }}>{label}</span>
        <span className="text-xs font-black tabular-nums">{value}</span>
      </div>
      <div className="flex gap-0.5">
        {Array.from({ length: 11 }, (_, n) => (
          <button key={n} onClick={() => onChange(n)} aria-label={`${label} ${n}`}
            data-testid="scale-step" data-value={n} data-on={value === n ? 'true' : 'false'}
            className="h-9 flex-1 rounded-[6px] text-xs font-black tabular-nums"
            style={value === n
              ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
              : { background: 'var(--surface-sunk)', color: 'var(--text-3)' }}>
            {n % 2 === 0 ? n : ''}
          </button>
        ))}
      </div>
      <div className="mt-0.5 flex justify-between px-0.5">
        {SEVERITY_ANCHORS.map((a) => (
          <span key={a.at} className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>{a.word}</span>
        ))}
      </div>
    </div>
  )
}

function Toggle({ label, on, onClick, danger, testid, flag }) {
  return (
    <button onClick={onClick} data-testid={testid} data-flag={flag} data-on={on ? 'true' : 'false'}
      className="flex min-h-[34px] items-center rounded-full px-3 text-xs font-black"
      style={on
        ? { background: danger ? 'color-mix(in srgb, var(--danger) 26%, transparent)' : 'var(--accent)', color: danger ? 'var(--danger)' : 'var(--accent-fg)' }
        : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
      {label}
    </button>
  )
}
