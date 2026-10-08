import { useEffect, useMemo, useState } from 'react'
import { Camera, Check, ChevronRight } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import NumberField from '../ui/NumberField'
import { displayName } from '../../lib/naming'
import { prettyDate } from '../../lib/schedule'
import { putBlob, blobUrl } from '../../lib/blobStore'
import { importPhoto } from '../../lib/photoImport'
import { PIN_BY_ID, PINS, GROUPS } from '../../lib/sitePins'
import { DEFAULT_CHECK_TIME } from '../../lib/reactionTracker'
import {
  SYMPTOMS, SYMPTOM_BY_ID, CHECK_SEVERITIES, severityWord, statusOf, describeReaction, openReactions,
  prefillSymptoms, currentSeverity, isReaction, openedOn,
} from '../../lib/reactionCourse'
import { patterns, MIN_INJECTIONS } from '../../lib/reactionPatterns'
import { suggestNeedle, needleLabel, needleKey, normaliseNeedle, needleCategoryFor } from '../../lib/injectionCapture'
import { optionsFor } from '../../lib/gear'

const toneOf = (sev) => (sev === 'severe' ? 'var(--danger)' : sev === 'none' ? 'var(--good)' : 'var(--warn)')
const on = { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' }
const pct = (r) => `${Math.round(r * 100)}%`
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
const DIRECTION_WORDS = { improving: 'improving', stable: 'stable', worsening: 'worsening' }

function usePeptideLabel() {
  const peptides = useStore((s) => s.peptides)
  return useMemo(() => (id) => {
    const p = peptides.find((x) => x.id === id)
    return p ? displayName(p) : 'Unknown'
  }, [peptides])
}

/** Who was in the syringe, as words: "BPC-157 + TB-500 (shared a syringe)". */
function peptideWords(record, label) {
  const ids = (record.coDrawPeptideIds?.length ? record.coDrawPeptideIds : [record.peptideId]).filter(Boolean)
  const names = ids.map(label).join(' + ')
  return record.coDraw || ids.length > 1 ? `${names} · co-draw` : names
}

function Thumb({ blobKey, size = 56 }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let dead = false
    blobUrl(blobKey).then((u) => { if (!dead) setUrl(u) })
    return () => { dead = true }
  }, [blobKey])
  return url
    ? <img src={url} alt="" className="shrink-0 rounded-[var(--r-sm)] object-cover" style={{ width: size, height: size }} />
    : <div className="shrink-0 rounded-[var(--r-sm)]" style={{ width: size, height: size, background: 'var(--surface-sunk)' }} />
}

/** A picked photo → stored blob key. */
async function storePhoto(file, recordId) {
  const out = await importPhoto(file)
  if (!out.ok) return null
  const key = `rx-${recordId}-${Date.now()}`
  await putBlob(key, out.blob)
  return key
}

// ------------------------------------------------------------- the Home row

/**
 * Open reactions, one compact row each: where, what, how long, how it is now,
 * and a Check. They stay until they are resolved; nothing here nags and nothing
 * here says what to do about one.
 */
export function OpenReactionsCard() {
  const records = useStore((s) => s.injectionRecords)
  const reactions = useStore((s) => s.reactions)
  const settings = useStore((s) => s.reactionSettings)
  const sweep = useStore((s) => s.sweepReactions)
  const label = usePeptideLabel()
  const [checking, setChecking] = useState(null)
  const [detail, setDetail] = useState(null)
  const today = todayStr()

  // a reaction left alone for a week is written down as abandoned, once
  useEffect(() => { sweep(today) }, [sweep, today, reactions])

  const open = useMemo(() => openReactions({ records, reactions }, today), [records, reactions, today])
  if (!open.length) return null

  const hour = new Date().getHours()
  const evening = hour >= Number(String(settings?.checkTime || DEFAULT_CHECK_TIME).slice(0, 2))

  return (
    <>
      <div className="card p-3" data-testid="open-reactions">
        <p className="mb-1 px-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
          Open reactions · {open.length}
        </p>
        <div className="rows">
          {open.map(({ record, reaction }) => {
            const d = describeReaction(record, reaction, today)
            const pin = PIN_BY_ID[record.pinId]
            return (
              <div key={record.id} className="flex items-center gap-2 py-2" data-testid="open-reaction-row"
                data-record={record.id} data-due={d.dueToday ? 'true' : 'false'}>
                <button onClick={() => setDetail(record.id)} className="min-w-0 flex-1 text-left"
                  data-testid="open-reaction-detail">
                  <p className="truncate text-sm font-bold leading-tight">{pin?.label || 'No site'}</p>
                  <p className="truncate text-xs font-semibold leading-tight tabular-nums" style={{ color: 'var(--text-2)' }}>
                    {peptideWords(record, label)} · {d.daysOpen === 0 ? 'opened today' : `${plural(d.daysOpen, 'day')} open`}
                  </p>
                  <p className="truncate text-xs font-bold leading-tight" style={{ color: toneOf(d.current) }}
                    data-testid="open-reaction-severity">
                    {severityWord(d.current)}
                    {d.direction && <span style={{ color: 'var(--text-3)' }}> · {DIRECTION_WORDS[d.direction]}</span>}
                  </p>
                </button>
                <button onClick={() => setChecking(record.id)} data-testid="open-reaction-check"
                  className="flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-black"
                  style={d.dueToday && evening
                    ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                    : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                  {d.dueToday ? 'Check' : <><Check size={12} /> Checked</>}
                </button>
              </div>
            )
          })}
        </div>
      </div>
      {checking && <ReactionCheck recordId={checking} onClose={() => setChecking(null)} />}
      {detail && <ReactionDetail recordId={detail} onClose={() => setDetail(null)} />}
    </>
  )
}

// ------------------------------------------------------------ the daily check

/**
 * One screen, as few taps as it can be. Symptoms and severity open as
 * yesterday left them, so "no change" is a single tap on Save. Gone does not
 * wait for Save: it is the end of the reaction, and it ends it.
 */
export function ReactionCheck({ recordId, onClose }) {
  const record = useStore((s) => s.injectionRecords.find((r) => r.id === recordId))
  const reaction = useStore((s) => s.reactions.find((r) => r.injectionRecordId === recordId))
  const check = useStore((s) => s.recordReactionCheck)
  const label = usePeptideLabel()
  const today = todayStr()

  const [symptoms, setSymptoms] = useState(() => prefillSymptoms(reaction))
  const [severity, setSeverity] = useState(() => {
    const cur = currentSeverity(reaction)
    return cur && cur !== 'none' ? cur : 'mild'
  })
  const [photoKey, setPhotoKey] = useState(null)
  const [busy, setBusy] = useState(false)
  if (!record) return null

  const d = describeReaction(record, reaction, today)
  const toggle = (id) => setSymptoms((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  const save = (sev = severity) => {
    check(recordId, { severity: sev, symptoms: sev === 'none' ? [] : symptoms, date: today, photoKey })
    onClose?.()
  }
  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try { setPhotoKey(await storePhoto(file, recordId)) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title="Check">
      <div className="space-y-4" data-testid="reaction-check">
        <div>
          <p className="text-sm font-black">{PIN_BY_ID[record.pinId]?.label || 'No site'}</p>
          <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-2)' }}>
            {peptideWords(record, label)} · {d.daysOpen === 0 ? 'opened today' : `${plural(d.daysOpen, 'day')} open`}
          </p>
        </div>

        <div>
          <p className="t-label mb-2" style={{ color: 'var(--text-3)' }}>Still there</p>
          <div className="flex flex-wrap gap-1.5">
            {SYMPTOMS.map((s) => (
              <button key={s.id} data-testid={`rc-symptom-${s.id}`} data-on={symptoms.includes(s.id) ? 'true' : 'false'}
                aria-pressed={symptoms.includes(s.id)} onClick={() => toggle(s.id)} className="chip"
                style={symptoms.includes(s.id) ? on : undefined}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="t-label mb-2" style={{ color: 'var(--text-3)' }}>Overall</p>
          <div className="grid grid-cols-4 gap-1.5">
            {CHECK_SEVERITIES.map((s) => (
              <button key={s.id} data-testid={`rc-sev-${s.id}`} data-on={severity === s.id ? 'true' : 'false'}
                aria-pressed={severity === s.id}
                onClick={() => (s.id === 'none' ? save('none') : setSeverity(s.id))}
                className="rounded-[var(--r-sm)] py-2.5 text-xs font-black"
                style={s.id === 'none'
                  ? { background: 'color-mix(in srgb, var(--good) 22%, transparent)', color: 'var(--good)' }
                  : severity === s.id ? on : { background: 'var(--surface-sunk)', color: 'var(--text)' }}>
                {s.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>
            Gone ends it straight away.
          </p>
        </div>

        <label className="flex items-center gap-2 text-xs font-bold" style={{ color: 'var(--text-2)' }}>
          <span className="rounded-full p-2" style={{ background: photoKey ? 'color-mix(in srgb, var(--good) 20%, transparent)' : 'var(--surface-sunk)' }}>
            {busy ? '…' : photoKey ? <Check size={14} /> : <Camera size={14} />}
          </span>
          {photoKey ? 'Photo added' : 'Add a photo (optional)'}
          <input type="file" accept="image/*" className="hidden" onChange={pick} data-testid="rc-photo" />
        </label>

        <button data-testid="rc-save" onClick={() => save()} className="btn-primary w-full py-3">Save check</button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------- what was captured

/**
 * Peptides, site, dose and needle for an injection — as captured when it was
 * logged, and every field can be corrected. Calls `onChange(patch)` with only
 * what changed.
 */
export function CapturedFields({ record, onChange }) {
  const peptides = useStore((s) => s.peptides)
  const gearItems = useStore((s) => s.gearItems)
  const gearOptions = useStore((s) => s.gearOptions)
  const records = useStore((s) => s.injectionRecords)
  const label = usePeptideLabel()
  const peptide = peptides.find((p) => p.id === record.peptideId)
  const category = needleCategoryFor(peptide)
  const { choices } = useMemo(
    () => suggestNeedle({ peptide, gearItems, records }),
    [peptide, gearItems, records],
  )
  const gaugeKey = category === 'Pen needles' ? 'pen_needle_gauge' : 'syringe_needle_gauge'
  const lengthKey = category === 'Pen needles' ? 'pen_needle_length_mm' : 'syringe_needle_length_mm'
  const gauges = optionsFor(gaugeKey, { extras: gearOptions || {}, items: gearItems })
  const lengths = optionsFor(lengthKey, { extras: gearOptions || {}, items: gearItems })
  const needle = normaliseNeedle(record.needle)
  const ids = (record.coDrawPeptideIds?.length ? record.coDrawPeptideIds : [record.peptideId]).filter(Boolean)

  return (
    <div className="space-y-3" data-testid="captured-fields">
      <div>
        <p className="t-label mb-1" style={{ color: 'var(--text-3)' }}>Peptide{ids.length > 1 ? 's' : ''}</p>
        <p className="text-sm font-bold" data-testid="cf-peptides">{ids.map(label).join(' + ')}</p>
        <label className="mt-1 flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
          <input type="checkbox" data-testid="cf-codraw" checked={!!record.coDraw}
            onChange={(e) => onChange({ coDraw: e.target.checked })} />
          Shared a syringe (co-draw)
        </label>
      </div>

      <div>
        <p className="t-label mb-1" style={{ color: 'var(--text-3)' }}>Site</p>
        <select className="input" value={record.pinId || ''} aria-label="Site" data-testid="cf-site"
          onChange={(e) => onChange({ pinId: e.target.value || null })}>
          <option value="">No site recorded</option>
          {GROUPS.map((g) => (
            <optgroup key={g.id} label={g.label}>
              {PINS.filter((p) => p.group === g.id).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      <div>
        <p className="t-label mb-1" style={{ color: 'var(--text-3)' }}>Dose at the time</p>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <NumberField value={record.dose ?? ''} allowEmpty aria-label="Dose at the time"
              onChange={(v) => onChange({ dose: v ?? null })} />
          </div>
          <span className="text-xs font-bold" style={{ color: 'var(--text-2)' }}>{record.units || ''}</span>
        </div>
      </div>

      <div>
        <p className="t-label mb-1" style={{ color: 'var(--text-3)' }}>Needle</p>
        {choices.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {choices.map((c) => (
              <button key={needleKey(c)} data-testid="cf-needle-choice" className="chip"
                style={needle && needleKey(needle) === needleKey(c) ? on : undefined}
                onClick={() => onChange({ needle: c })}>
                {needleLabel(c)}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <select className="input" aria-label="Needle gauge" data-testid="cf-gauge" value={needle?.gauge || ''}
            onChange={(e) => onChange({ needle: e.target.value ? { gauge: e.target.value, lengthMm: needle?.lengthMm ?? lengths[0] } : null })}>
            <option value="">Gauge</option>
            {gauges.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select className="input" aria-label="Needle length" data-testid="cf-length" value={needle?.lengthMm ?? ''}
            onChange={(e) => onChange({ needle: e.target.value ? { gauge: needle?.gauge || gauges[0], lengthMm: Number(e.target.value) } : null })}>
            <option value="">Length</option>
            {lengths.map((l) => <option key={l} value={l}>{l} mm</option>)}
          </select>
        </div>
        {!needle && (
          <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
            Nothing is In use for this in Supplies, so it is left blank rather than guessed.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * The needle for a new injection: whatever is In use in Supplies for this
 * route, already selected, with the other in-use ones a tap away. `value`
 * undefined means "leave it to the default"; the parent holds the choice.
 */
export function NeedlePicker({ peptide, value, onChange }) {
  const gearItems = useStore((s) => s.gearItems)
  const records = useStore((s) => s.injectionRecords)
  const { needle: suggested, choices } = useMemo(
    () => suggestNeedle({ peptide, gearItems, records }),
    [peptide, gearItems, records],
  )
  const current = value === undefined ? suggested : normaliseNeedle(value)
  if (!choices.length) {
    return (
      <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }} data-testid="needle-picker" data-needle="">
        Needle: nothing In use in Supplies, so none recorded.
      </p>
    )
  }
  return (
    <div data-testid="needle-picker" data-needle={current ? needleKey(current) : ''}>
      <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Needle</p>
      <div className="flex flex-wrap gap-1.5">
        {choices.map((c) => (
          <button key={needleKey(c)} data-testid="needle-choice" data-on={current && needleKey(current) === needleKey(c) ? 'true' : 'false'}
            className="chip" style={current && needleKey(current) === needleKey(c) ? on : undefined}
            onClick={() => onChange(c)}>
            {needleLabel(c)}
          </button>
        ))}
      </div>
    </div>
  )
}

// --------------------------------------------------------------- log one

/** Log a reaction against an injection. Opens it. */
export function LogReaction({ open, onClose, recordId = null }) {
  const records = useStore((s) => s.injectionRecords)
  const logReaction = useStore((s) => s.logReaction)
  const label = usePeptideLabel()
  const today = todayStr()

  const recent = useMemo(() => {
    const cut = Date.now() - 21 * 86400000
    return records.filter((r) => new Date(r.timestamp).getTime() >= cut)
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
  }, [records])

  const [pickId, setPickId] = useState(recordId)
  const [patch, setPatch] = useState({})
  const [symptoms, setSymptoms] = useState([])
  const [severity, setSeverity] = useState('mild')
  const chosen = pickId || recent[0]?.id || null
  const base = records.find((r) => r.id === chosen)
  const record = base ? { ...base, ...patch } : null

  if (!open) return null
  const toggle = (id) => setSymptoms((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  const save = () => {
    if (!record) return
    logReaction(record.id, { severity, symptoms, date: today, record: patch })
    onClose?.()
  }

  return (
    <Modal open onClose={onClose} title="Log a reaction">
      <div className="space-y-4" data-testid="log-reaction">
        {recent.length === 0 && (
          <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
            No injections in the last three weeks to attach a reaction to.
          </p>
        )}
        {recent.length > 0 && (
          <div>
            <p className="t-label mb-2" style={{ color: 'var(--text-3)' }}>Which injection</p>
            <div className="flex flex-col gap-1.5">
              {recent.slice(0, 6).map((r) => (
                <button key={r.id} data-testid={`lr-pick-${r.id}`} className="chip justify-start text-left"
                  style={chosen === r.id ? on : undefined}
                  onClick={() => { setPickId(r.id); setPatch({}) }}>
                  {PIN_BY_ID[r.pinId]?.label || 'No site'} · {label(r.peptideId)} · {prettyDate(String(r.timestamp).slice(0, 10))}
                </button>
              ))}
            </div>
          </div>
        )}

        {record && (
          <>
            <CapturedFields record={record} onChange={(p) => setPatch((cur) => ({ ...cur, ...p }))} />

            <div>
              <p className="t-label mb-2" style={{ color: 'var(--text-3)' }}>What it looks like</p>
              <div className="flex flex-wrap gap-1.5">
                {SYMPTOMS.map((s) => (
                  <button key={s.id} data-testid={`lr-symptom-${s.id}`} aria-pressed={symptoms.includes(s.id)}
                    className="chip" style={symptoms.includes(s.id) ? on : undefined} onClick={() => toggle(s.id)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="t-label mb-2" style={{ color: 'var(--text-3)' }}>Overall</p>
              <div className="grid grid-cols-3 gap-1.5">
                {CHECK_SEVERITIES.filter((s) => s.id !== 'none').map((s) => (
                  <button key={s.id} data-testid={`lr-sev-${s.id}`} aria-pressed={severity === s.id}
                    onClick={() => setSeverity(s.id)} className="rounded-[var(--r-sm)] py-2.5 text-xs font-black"
                    style={severity === s.id ? on : { background: 'var(--surface-sunk)', color: 'var(--text)' }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <button data-testid="lr-save" onClick={save} className="btn-primary w-full py-3">Log reaction</button>
          </>
        )}
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------- the detail

/** One reaction, everything it has computed, and everything captured — editable. */
export function ReactionDetail({ recordId, onClose }) {
  const record = useStore((s) => s.injectionRecords.find((r) => r.id === recordId))
  const reaction = useStore((s) => s.reactions.find((r) => r.injectionRecordId === recordId))
  const update = useStore((s) => s.updateInjectionRecord)
  const label = usePeptideLabel()
  const [checking, setChecking] = useState(false)
  const today = todayStr()
  if (!record) return null
  const d = describeReaction(record, reaction, today)
  const status = d.status

  return (
    <Modal open onClose={onClose} title={PIN_BY_ID[record.pinId]?.label || 'Reaction'}>
      <div className="space-y-4" data-testid="reaction-detail" data-status={status || 'none'}>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
          {peptideWords(record, label)} · injected {prettyDate(String(record.timestamp).slice(0, 10))}
        </p>

        <div className="grid grid-cols-2 gap-2" data-testid="rd-stats">
          <Stat label="Status" value={status ? status[0].toUpperCase() + status.slice(1) : 'No reaction'} tid="rd-status" />
          <Stat label="Days open" value={d.daysOpen == null ? '—' : d.daysOpen === 0 ? 'Same day' : String(d.daysOpen)} tid="rd-days-open" />
          <Stat label="Time to resolve" value={d.timeToResolve == null ? '—' : d.timeToResolve === 0 ? 'Same day' : plural(d.timeToResolve, 'day')} tid="rd-resolve" />
          <Stat label="Peak" value={d.peak ? severityWord(d.peak) : '—'} tid="rd-peak" tone={d.peak ? toneOf(d.peak) : null} />
          <Stat label="Direction" value={d.direction ? DIRECTION_WORDS[d.direction] : d.checks < 2 ? 'Needs 2 checks' : '—'} tid="rd-direction" />
          <Stat label="Checks" value={`${d.checks}${d.gaps.length ? ` · ${plural(d.gaps.length, 'day')} missed` : ''}`} tid="rd-checks" />
        </div>

        {status === 'open' && (
          <button onClick={() => setChecking(true)} className="btn-primary w-full py-3" data-testid="rd-check">
            {d.dueToday ? 'Check today' : 'Correct today\'s check'}
          </button>
        )}
        {status === 'abandoned' && (
          <div>
            <p className="mb-2 text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>
              No check for a week, so this stopped asking. The record stays.
            </p>
            <button onClick={() => setChecking(true)} className="chip" data-testid="rd-check">Check it now</button>
          </div>
        )}

        <div>
          <p className="t-label mb-1" style={{ color: 'var(--text-3)' }}>Timeline</p>
          <div className="rows" data-testid="rd-timeline">
            {d.timeline.length === 0 && <p className="py-2 text-xs" style={{ color: 'var(--text-2)' }}>Not checked yet.</p>}
            {d.timeline.map((c) => (
              <div key={c.date} className="py-2" data-testid="rd-timeline-day" data-date={c.date}>
                <p className="flex items-baseline gap-2 text-xs font-bold tabular-nums">
                  <span style={{ color: 'var(--text-2)' }}>{prettyDate(c.date)}</span>
                  <span style={{ color: toneOf(c.severity) }}>{severityWord(c.severity)}</span>
                </p>
                <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-2)' }}>
                  {c.symptoms.length ? c.symptoms.map((s) => SYMPTOM_BY_ID[s].label).join(' · ') : 'No symptoms ticked'}
                </p>
              </div>
            ))}
          </div>
        </div>

        {d.photos.length > 0 && (
          <div>
            <p className="t-label mb-1" style={{ color: 'var(--text-3)' }}>Photos</p>
            <div className="flex gap-2 overflow-x-auto pb-1" data-testid="rd-photos">
              {d.photos.map((p) => (
                <div key={p.key} className="shrink-0 text-center" data-testid="rd-photo" data-date={p.date || ''}>
                  <Thumb blobKey={p.key} size={72} />
                  <p className="mt-0.5 text-[10px] font-semibold tabular-nums" style={{ color: 'var(--text-3)' }}>
                    {p.date ? prettyDate(p.date) : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="t-label mb-2" style={{ color: 'var(--text-3)' }}>Captured when it was logged</p>
          <CapturedFields record={record} onChange={(p) => update(record.id, p)} />
        </div>

        <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>
          A record of what was entered, not advice. If something worries you, ask a doctor.
        </p>
      </div>
      {checking && <ReactionCheck recordId={recordId} onClose={() => setChecking(false)} />}
    </Modal>
  )
}

function Stat({ label, value, tid, tone }) {
  return (
    <div className="rounded-[var(--r-sm)] p-2.5" style={{ background: 'var(--surface-sunk)' }}>
      <p className="t-caption" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className="mt-0.5 text-sm font-black tabular-nums" data-testid={tid} style={tone ? { color: tone } : undefined}>{value}</p>
    </div>
  )
}

// ------------------------------------------------------------ the history

/** Every reaction ever logged: open first, then resolved, then abandoned. */
export function ReactionsList() {
  const records = useStore((s) => s.injectionRecords)
  const reactions = useStore((s) => s.reactions)
  const label = usePeptideLabel()
  const [detail, setDetail] = useState(null)
  const today = todayStr()

  const rows = useMemo(() => reactions
    .filter(isReaction)
    .map((reaction) => ({ reaction, record: records.find((r) => r.id === reaction.injectionRecordId) }))
    .filter((x) => x.record)
    .map((x) => ({ ...x, status: statusOf(x.reaction, today), opened: openedOn(x.reaction) }))
    .sort((a, b) => ['open', 'resolved', 'abandoned'].indexOf(a.status) - ['open', 'resolved', 'abandoned'].indexOf(b.status)
      || b.opened.localeCompare(a.opened)), [reactions, records, today])

  return (
    <div className="card p-4" data-testid="reactions-list">
      <div className="t-label mb-2" style={{ color: 'var(--text-3)' }}>Reactions</div>
      {rows.length === 0 && <div className="t-caption" style={{ color: 'var(--text-2)' }}>None logged.</div>}
      <div className="rows">
        {rows.map(({ record, reaction, status, opened }) => {
          const d = describeReaction(record, reaction, today)
          return (
            <button key={record.id} onClick={() => setDetail(record.id)} data-testid="reaction-row"
              data-record={record.id} data-status={status} className="flex w-full items-center gap-3 py-2 text-left">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-black">{PIN_BY_ID[record.pinId]?.label || 'No site'}</div>
                <div className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-2)' }}>
                  {label(record.peptideId)} · {prettyDate(opened)} ·{' '}
                  {status === 'resolved'
                    ? `resolved in ${d.timeToResolve === 0 ? 'under a day' : plural(d.timeToResolve, 'day')}`
                    : status === 'abandoned' ? 'no check for a week' : `${plural(d.daysOpen, 'day')} open`}
                </div>
              </div>
              <span className="text-xs font-black" style={{ color: status === 'open' ? toneOf(d.current) : 'var(--text-3)' }}>
                {status === 'open' ? severityWord(d.current) : status === 'resolved' ? 'Gone' : 'Left'}
              </span>
              <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
            </button>
          )
        })}
      </div>
      {detail && <ReactionDetail recordId={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

// ----------------------------------------------------------------- patterns

function StatsLine({ s }) {
  if (s.status === 'insufficient') {
    return (
      <div className="text-xs font-medium leading-snug" style={{ color: 'var(--text-2)' }} data-testid="stats-insufficient">
        {plural(s.injections, 'injection')} · {plural(s.reactions, 'reaction')} — <b>Not enough data yet</b>
        <span style={{ color: 'var(--text-3)' }}> (needs {MIN_INJECTIONS} checked)</span>
      </div>
    )
  }
  return (
    <div className="text-xs font-medium leading-snug tabular-nums" style={{ color: 'var(--text-2)' }} data-testid="stats-ok">
      {plural(s.injections, 'injection')} · {plural(s.reactions, 'reaction')} · <b data-testid="stats-rate">{pct(s.rate)}</b> reaction rate
      {s.medianDaysToResolve != null && <> · median {s.medianDaysToResolve === 0 ? 'under a day' : `${s.medianDaysToResolve} days`} to resolve</>}
      {s.reactions > 0 && (
        <div style={{ color: 'var(--text-3)' }}>
          Peak: {s.peakSpread.mild} mild · {s.peakSpread.moderate} moderate · {s.peakSpread.severe} severe
          {s.symptoms.length > 0 && <> · most often {s.symptoms.map((x) => x.label.toLowerCase()).join(', ')}</>}
        </div>
      )}
    </div>
  )
}

/** Counts by compound, needle and body region. Describes; ranks nothing. */
export function PatternsSection({ onOpenPeptide }) {
  const records = useStore((s) => s.injectionRecords)
  const reactions = useStore((s) => s.reactions)
  const peptides = useStore((s) => s.peptides)
  const label = usePeptideLabel()
  const p = useMemo(() => patterns({ records, reactions, peptides }), [records, reactions, peptides])

  return (
    <div className="space-y-3" data-testid="patterns">
      <div className="card p-4">
        <div className="t-label mb-1" style={{ color: 'var(--text-3)' }}>Patterns</div>
        <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-2)' }} data-testid="patterns-note">
          {plural(p.totals.injections, 'injection')} logged, {p.totals.checked} checked, {plural(p.totals.reactions, 'reaction')}.
          A rate appears once a row has {MIN_INJECTIONS} checked injections. These are counts, not causes.
        </p>
      </div>

      <div className="card p-4" data-testid="patterns-peptides">
        <div className="t-label mb-2" style={{ color: 'var(--text-3)' }}>By peptide</div>
        {p.peptides.length === 0 && <div className="t-caption" style={{ color: 'var(--text-2)' }}>Nothing logged yet.</div>}
        <div className="rows">
          {p.peptides.map((r) => (
            <button key={r.peptideId} data-testid={`peptide-card-${r.peptideId}`} onClick={() => onOpenPeptide?.(r.peptideId)}
              className="block w-full py-2 text-left">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-sm font-black">
                  {label(r.peptideId)}{r.isBlend && <span className="font-semibold" style={{ color: 'var(--text-3)' }}> · blend</span>}
                </span>
                <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
              </div>
              <StatsLine s={r.clean} />
              {r.coDraw && (
                <div className="mt-0.5 text-xs font-medium leading-snug tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="codraw-line">
                  Plus {plural(r.coDraw.injections, 'injection')} that shared a syringe, {plural(r.coDraw.reactions, 'reaction')} —
                  unable to isolate this compound, so not in the rate above.
                </div>
              )}
              {r.viaBlends.map((b) => (
                <div key={b.blendId} className="mt-0.5 text-xs font-medium leading-snug tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="blend-line">
                  Also an ingredient of {label(b.blendId)}: {plural(b.injections, 'injection')}, {plural(b.reactions, 'reaction')} —
                  a blend isn't clean data for {label(r.peptideId)}, so not counted here.
                </div>
              ))}
            </button>
          ))}
        </div>
      </div>

      <div className="card p-4" data-testid="patterns-needles">
        <div className="t-label mb-2" style={{ color: 'var(--text-3)' }}>By needle</div>
        {p.needles.rows.length === 0 && (
          <div className="t-caption" style={{ color: 'var(--text-2)' }}>
            No needle recorded yet. New injections pick it up from what is In use in Supplies.
          </div>
        )}
        <div className="rows">
          {p.needles.rows.map((r) => (
            <div key={r.key} className="py-2" data-testid="needle-row" data-key={r.key}>
              <div className="text-sm font-black">{r.label}</div>
              <StatsLine s={r} />
            </div>
          ))}
        </div>
        {p.needles.unrecorded > 0 && (
          <div className="mt-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
            {plural(p.needles.unrecorded, 'injection')} with no needle recorded, left out.
          </div>
        )}
      </div>

      <div className="card p-4" data-testid="patterns-regions">
        <div className="t-label mb-2" style={{ color: 'var(--text-3)' }}>By site region</div>
        {p.regions.rows.length === 0 && <div className="t-caption" style={{ color: 'var(--text-2)' }}>No sites logged yet.</div>}
        <div className="rows">
          {p.regions.rows.map((r) => (
            <div key={r.key} className="py-2" data-testid={`group-card-${r.key}`}>
              <div className="text-sm font-black">{r.label}</div>
              <StatsLine s={r} />
            </div>
          ))}
        </div>
        {p.regions.unrecorded > 0 && (
          <div className="mt-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
            {plural(p.regions.unrecorded, 'injection')} with no site recorded, left out.
          </div>
        )}
      </div>
    </div>
  )
}
