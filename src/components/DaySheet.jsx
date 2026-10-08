import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Check, SkipForward, AlertCircle, Pause, Syringe as SyringeIcon, Wind, Sun, Moon,
  Pill, Trash2, Pencil, HeartPulse, Droplet, X,
} from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import Modal from './ui/Modal'
import NumberField from './ui/NumberField'
import { entryState, vialOnDate, stockNote, doseOnDate } from '../lib/backfill'
import { useCalendarRange } from '../lib/useCalendarRange'
import { prettyDate } from '../lib/schedule'
import { formatDose, formatUnitsLong } from '../lib/calc'
import { SYMPTOM_TAGS, TAG_BY_ID, SEVERITY } from '../lib/symptoms'

/**
 * One day, and everything that can be said or changed about it.
 *
 * The month grid is a picture; this is the record behind a cell. Every
 * scheduled compound with the state it actually ended in, the supplements, the
 * check-in, any blood test — and, for a day that has already been, the ability
 * to put right anything that went unrecorded at the time.
 *
 * Backdated entries are ordinary records, not estimates. Saying "I took it on
 * Tuesday" on Thursday is a statement of fact about Tuesday, and it moves
 * inventory, adherence, tenure and the dose timeline exactly as logging it on
 * Tuesday would have. What stays labelled estimated is the older, vaguer thing:
 * dose history typed in from memory for the months before the app existed.
 */

const STATE_STYLE = {
  logged: { icon: Check, tone: 'var(--good)', label: 'Logged' },
  skipped: { icon: SkipForward, tone: 'var(--warn)', label: 'Skipped' },
  paused: { icon: Pause, tone: 'var(--text-3)', label: 'Paused' },
  missed: { icon: AlertCircle, tone: 'var(--danger)', label: 'Missed' },
  due: { icon: SyringeIcon, tone: 'var(--text-2)', label: 'Due today' },
  scheduled: { icon: SyringeIcon, tone: 'var(--text-2)', label: 'Scheduled' },
}

export default function DaySheet({ open, date, onClose, goTo, onBackfill }) {
  const t = todayStr()
  const [skipping, setSkipping] = useState(null)
  const [editing, setEditing] = useState(null)
  const [symptomOpen, setSymptomOpen] = useState(false)

  useEffect(() => {
    if (open) { setSkipping(null); setEditing(null); setSymptomOpen(false) }
  }, [open, date])

  if (!open || !date) return null

  return (
    <Modal open onClose={onClose} wide title={format(parseISO(date), 'EEEE d MMMM')}>
      <DayBody date={date} todayStr={t} goTo={goTo} onClose={onClose} onBackfill={onBackfill}
        skipping={skipping} setSkipping={setSkipping}
        editing={editing} setEditing={setEditing}
        symptomOpen={symptomOpen} setSymptomOpen={setSymptomOpen} />
    </Modal>
  )
}

function DayBody({
  date, todayStr: t, goTo, onClose, onBackfill,
  skipping, setSkipping, editing, setEditing, symptomOpen, setSymptomOpen,
}) {
  const cal = useCalendarRange(date, date)
  const day = cal.byDate[date]

  const doseLogs = useStore((s) => s.doseLogs)
  const skips = useStore((s) => s.skips)
  const supplements = useStore((s) => s.supplements)
  const symptomLogs = useStore((s) => s.symptomLogs)
  const bloodTests = useStore((s) => s.bloods?.tests || [])

  const symptom = useMemo(() => symptomLogs.find((l) => l.date === date) || null, [symptomLogs, date])
  const bloods = useMemo(() => bloodTests.filter((b) => b.date === date), [bloodTests, date])
  const logsToday = useMemo(() => doseLogs.filter((l) => l.date === date), [doseLogs, date])

  const isPast = day?.isPast
  const editable = isPast || day?.isToday

  if (!day) {
    return <p className="py-6 text-center text-sm font-bold" style={{ color: 'var(--text-2)' }}>Nothing to show.</p>
  }

  const nothing = day.scheduled === 0 && !symptom && bloods.length === 0 && day.events.length === 0

  return (
    <div className="space-y-3" data-testid="day-sheet" data-date={date}>
      {/* what the day amounted to */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold tabular-nums">
        {day.wholeDayPaused ? (
          <span className="flex items-center gap-1.5" data-testid="day-paused" style={{ color: 'var(--text-2)' }}>
            <Pause size={12} /> Paused{day.pauseReason ? ` · ${day.pauseReason}` : ''}
          </span>
        ) : day.scheduled > 0 ? (
          <>
            <span style={{ color: 'var(--text-2)' }}>{day.done} of {day.owed ?? day.scheduled} logged</span>
            {day.missed > 0 && <span style={{ color: 'var(--danger)' }}>{day.missed} missed</span>}
            {day.skipped > 0 && <span style={{ color: 'var(--warn)' }}>{day.skipped} skipped</span>}
            {day.pushedOff > 0 && <span style={{ color: 'var(--info)' }}>{day.pushedOff} pushed on</span>}
          </>
        ) : null}
      </div>

      {nothing && (
        <p className="py-4 text-center text-sm font-bold" style={{ color: 'var(--text-2)' }}>
          Nothing scheduled — a clear day.
        </p>
      )}

      {/* ------------------------------------------------ the compounds */}
      {['AM', 'PM'].map((slot) => (
        day.slots[slot].length > 0 && (
          <div key={slot} className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }}>
            <p className="mb-2 flex items-center gap-1 t-caption" style={{ color: 'var(--text-2)' }}>
              {slot === 'AM' ? <Sun size={11} /> : <Moon size={11} />} {slot}
            </p>
            <div className="space-y-1.5">
              {day.slots[slot].map((e) => (
                <CompoundLine key={e.peptideId} entry={e} day={day} date={date} editable={editable}
                  log={logsToday.find((l) => l.peptideId === e.peptideId)}
                  skip={skips.find((k) => k.kind === 'peptide' && k.peptideId === e.peptideId && k.date === date)}
                  onSkip={() => setSkipping(e)} onEdit={setEditing} />
              ))}
            </div>
          </div>
        )
      ))}

      {/* ---------------------------------------------- the supplements */}
      {day.oralEntries.length > 0 && (
        <div className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }}>
          <p className="mb-2 flex items-center gap-1 t-caption" style={{ color: 'var(--text-2)' }}>
            <Pill size={11} /> Supplements
          </p>
          <div className="space-y-1" data-testid="day-supplements">
            {day.oralEntries.map((e) => {
              const st = entryState(e, day)
              const S = STATE_STYLE[st] || STATE_STYLE.scheduled
              return (
                <p key={e.supplementId} className="flex items-center gap-2 text-xs font-bold"
                  data-testid="day-supplement" data-state={st}>
                  {(st === 'due' || st === 'scheduled')
                    ? <Pill size={11} className="shrink-0" style={{ color: S.tone }} />
                    : <S.icon size={11} className="shrink-0" style={{ color: S.tone }} />}
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  <span className="shrink-0 font-semibold" style={{ color: S.tone }}>{S.label}</span>
                </p>
              )
            })}
          </div>
        </div>
      )}

      {/* --------------------------------------------------- the symptoms */}
      <div className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }}>
        <div className="flex items-center gap-2">
          <p className="flex min-w-0 flex-1 items-center gap-1 t-caption" style={{ color: 'var(--text-2)' }}>
            <HeartPulse size={11} /> How the day felt
          </p>
          {editable && (
            <button onClick={() => setSymptomOpen(true)} data-testid="day-edit-symptoms"
              className="shrink-0 rounded-full px-2.5 py-1 text-xs font-black"
              style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
              {symptom ? 'Edit' : 'Add'}
            </button>
          )}
        </div>
        {symptom ? (
          <div className="mt-1.5" data-testid="day-symptom-entry">
            <div className="flex flex-wrap gap-1.5">
              {symptom.tags.map((tg) => (
                <span key={tg.id} className="rounded-full px-2 py-1 text-xs font-bold"
                  style={{
                    background: 'var(--surface)',
                    color: (TAG_BY_ID[tg.id]?.polarity === 'neg') ? 'var(--warn)' : 'var(--good)',
                  }}>
                  {TAG_BY_ID[tg.id]?.icon} {TAG_BY_ID[tg.id]?.label || tg.id}
                  {tg.severity ? ` · ${tg.severity}` : ''}
                </span>
              ))}
            </div>
            {symptom.note && (
              <p className="mt-1.5 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
                {symptom.note}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
            Nothing logged for this day.
          </p>
        )}
      </div>

      {/* ------------------------------------------------- the blood test */}
      {bloods.length > 0 && (
        <div className="rounded-[14px] p-3" data-testid="day-bloods"
          style={{ background: 'var(--surface-sunk)' }}>
          <p className="flex items-center gap-1 t-caption" style={{ color: 'var(--info)' }}>
            <Droplet size={11} /> Blood test
          </p>
          {bloods.map((b) => (
            <button key={b.id} onClick={() => { onClose(); goTo?.('bloods') }} data-testid="day-blood-row"
              className="mt-1 flex w-full items-center gap-2 text-left">
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold">{b.lab || 'lab not recorded'}</span>
                <span className="block text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
                  {Object.keys(b.values || {}).length} markers · tap to open Bloods
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ----------------------------------------------------- the events */}
      {day.events.length > 0 && (
        <div className="space-y-1">
          <p className="t-caption" style={{ color: 'var(--text-2)' }}>On this day</p>
          {day.events.slice(0, 6).map((e, i) => (
            <p key={i} className="text-xs font-bold" style={{ color: 'var(--text-3)' }}>{e.text}</p>
          ))}
        </div>
      )}

      {day.isToday && (
        <button onClick={() => { onClose(); goTo?.('today') }}
          className="btn-primary w-full rounded-full py-3 text-sm font-black">
          Go to today's list
        </button>
      )}

      {/* The per-compound buttons above handle one dose at a time. A day where
          several shared a syringe is one event, not three, and the catch-up
          sheet is the one that knows that — so the way to it stays. */}
      {isPast && day.missed > 0 && (
        <div className="rounded-[14px] p-3" data-testid="day-missed"
          style={{ background: 'color-mix(in srgb, var(--danger) 14%, transparent)' }}>
          <p className="flex items-center gap-1.5 text-xs font-black" style={{ color: 'var(--danger)' }}>
            <AlertCircle size={13} strokeWidth={3} />
            {day.missed} missed — nothing recorded either way
          </p>
          <button onClick={() => { onClose(); onBackfill?.(date) }} data-testid="day-catch-up"
            className="btn-primary mt-2 w-full rounded-full py-3 text-xs font-black">
            Catch up the whole day
          </button>
        </div>
      )}

      {isPast && day.missed === 0 && day.scheduled > 0 && (
        <button onClick={() => { onClose(); onBackfill?.(date) }} data-testid="day-open-backfill"
          className="w-full rounded-full py-3 text-xs font-black"
          style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
          Correct this day
        </button>
      )}

      {isPast && (
        <p className="px-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
          Anything added here is recorded as having happened on this day — it moves the vial, the run-out
          date and your adherence exactly as logging it at the time would have.
        </p>
      )}

      <SkipSheet entry={skipping} date={date} onClose={() => setSkipping(null)} />
      <EditLogSheet log={editing} onClose={() => setEditing(null)} />
      <SymptomSheet open={symptomOpen} date={date} existing={symptom} onClose={() => setSymptomOpen(false)} />
    </div>
  )
}

/** One compound's line, with whatever can still be done to it. */
function CompoundLine({ entry: e, day, date, editable, log, skip, onSkip, onEdit }) {
  const backfillDose = useStore((s) => s.backfillDose)
  const undoLog = useStore((s) => s.undoLog)
  const unskip = useStore((s) => s.unskip)
  const openVials = useStore((s) => s.openVials)
  const finishedVials = useStore((s) => s.finishedVials)
  const doseLogs = useStore((s) => s.doseLogs)
  const showToast = useStore((s) => s.showToast)

  const st = entryState(e, day)
  const S = STATE_STYLE[st] || STATE_STYLE.scheduled
  const v = vialOnDate(e.peptideId, date, { openVials, finishedVials })

  const logIt = () => {
    // The dose that applied on that date, not the one standing today.
    // doseOnDate answers with its provenance as well as the number, so the
    // number has to be taken off it — passing the whole answer through wrote
    // an object into the log where a dose belonged.
    const { dose } = doseOnDate({ id: e.peptideId, ladder: { unit: e.unit } }, date, doseLogs, e.dose)
    const p = backfillDose(e.peptideId, date, { doseValue: dose })
    if (p) showToast(`${e.name} recorded on ${prettyDate(date)}`)
  }

  return (
    <div className="space-y-1" data-testid="day-compound" data-compound={e.peptideId} data-state={st}>
      <div className="flex items-start gap-2">
        {e.nasal
          ? <Wind size={12} className="mt-0.5 shrink-0" style={{ color: S.tone }} />
          : <S.icon size={12} className="mt-0.5 shrink-0" style={{ color: S.tone }} />}
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-bold leading-snug">
            {e.name}
            <span className="ml-1 font-semibold" style={{ color: 'var(--text-3)' }}>
              {formatDose(e.dose, e.unit)}{e.units ? ` · ${formatUnitsLong(e.units)}` : ''}
            </span>
          </span>
          <span className="block text-xs font-semibold" style={{ color: S.tone }}>
            {S.label}
            {st === 'paused' && e.pauseReason ? ` · ${e.pauseReason}` : ''}
            {st === 'skipped' && skip?.reason ? ` · ${skip.reason}` : ''}
            {st === 'logged' && log?.backfilled ? ' · added later' : ''}
          </span>
        </span>
      </div>

      {editable && (
        <div className="flex flex-wrap gap-1.5 pl-5">
          {st === 'logged' && log && (
            <>
              <Action onClick={() => onEdit(log)} testid="day-edit-log" icon={Pencil}>Edit</Action>
              <Action onClick={() => { undoLog(log.id); showToast('Removed') }}
                testid="day-delete-log" icon={Trash2} danger>Delete</Action>
            </>
          )}
          {(st === 'missed' || st === 'paused' || st === 'due') && (
            <>
              <Action onClick={logIt} testid="day-log" icon={Check} primary>
                {st === 'paused' ? 'Took it anyway' : 'Log it'}
              </Action>
              {st !== 'paused' && (
                <Action onClick={onSkip} testid="day-skip" icon={SkipForward}>Skipped it</Action>
              )}
            </>
          )}
          {st === 'skipped' && skip && (
            <Action onClick={() => { unskip(skip.id); showToast('Skip removed') }}
              testid="day-unskip" icon={X}>Undo skip</Action>
          )}
          {st === 'missed' && !v.movesStock && (
            <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>{stockNote(v)}</span>
          )}
        </div>
      )}
    </div>
  )
}

function Action({ children, onClick, icon: Icon, testid, primary, danger }) {
  return (
    <button onClick={onClick} data-testid={testid}
      className="flex min-h-[30px] items-center gap-1 rounded-full px-2.5 text-xs font-black"
      style={primary
        ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
        : { background: 'var(--surface)', color: danger ? 'var(--danger)' : 'var(--text-2)' }}>
      <Icon size={11} /> {children}
    </button>
  )
}

/** Why it was skipped, recorded against the day it was skipped on. */
function SkipSheet({ entry, date, onClose }) {
  const skipDose = useStore((s) => s.skipDose)
  const showToast = useStore((s) => s.showToast)
  const [reason, setReason] = useState('')
  useEffect(() => { if (entry) setReason('') }, [entry])
  if (!entry) return null

  const REASONS = ['Forgot', 'Sides', 'Out of stock', 'Travelling', 'Felt off', 'On purpose']

  return (
    <Modal open onClose={onClose} title={`Skipped ${entry.name}`}>
      <div className="space-y-3" data-testid="day-skip-sheet">
        <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Recorded on {prettyDate(date)} as a decision rather than a lapse — it stops counting as missed.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button key={r} onClick={() => setReason(r)} data-testid="skip-reason"
              className="flex min-h-[34px] items-center rounded-full px-3 text-xs font-black"
              style={reason === r
                ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              {r}
            </button>
          ))}
        </div>
        <input className="input" value={reason} aria-label="Reason" data-testid="skip-reason-text"
          placeholder="Or say it in your own words…" onChange={(e) => setReason(e.target.value)} />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-full py-3 text-xs font-black"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>Cancel</button>
          <button onClick={() => { skipDose(entry.peptideId, reason, date); showToast('Marked as skipped'); onClose() }}
            data-testid="skip-save" className="btn-primary flex-1 rounded-full py-3 text-xs font-black">
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Correcting a dose that was recorded wrong. */
function EditLogSheet({ log, onClose }) {
  const editLog = useStore((s) => s.editLog)
  const showToast = useStore((s) => s.showToast)
  const [dose, setDose] = useState(0)
  useEffect(() => { if (log) setDose(log.doseValue) }, [log])
  if (!log) return null

  return (
    <Modal open onClose={onClose} title="Correct this dose">
      <div className="space-y-3" data-testid="day-edit-sheet">
        <label className="block">
          <span className="t-caption mb-1 block" style={{ color: 'var(--text-2)' }}>
            Dose ({log.unit})
          </span>
          <NumberField value={dose} min={0} aria-label="Dose" data-testid="edit-dose"
            onChange={(v) => setDose(v ?? 0)} />
        </label>
        <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
          The vial moves by the difference, not by a whole second dose.
        </p>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-full py-3 text-xs font-black"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>Cancel</button>
          <button onClick={() => { editLog(log.id, { doseValue: Number(dose) }); showToast('Corrected'); onClose() }}
            data-testid="edit-save" className="btn-primary flex-1 rounded-full py-3 text-xs font-black">
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** A check-in for a day that has already been. */
function SymptomSheet({ open, date, existing, onClose }) {
  const logSymptomCheckin = useStore((s) => s.logSymptomCheckin)
  const deleteSymptomLog = useStore((s) => s.deleteSymptomLog)
  const showToast = useStore((s) => s.showToast)
  const [tags, setTags] = useState([])
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open) return
    setTags(existing?.tags?.map((t) => ({ id: t.id, severity: t.severity || null })) || [])
    setNote(existing?.note || '')
  }, [open, existing])

  if (!open) return null

  const toggle = (id) => setTags((prev) => prev.some((t) => t.id === id)
    ? prev.filter((t) => t.id !== id)
    : [...prev, { id, severity: null }])

  const setSeverity = (id, sev) => setTags((prev) => prev.map((t) => (t.id === id ? { ...t, severity: sev } : t)))

  const save = () => {
    logSymptomCheckin({ tags, note, site: existing?.site || null, dateStr: date })
    onClose()
  }

  return (
    <Modal open onClose={onClose} wide title={`How ${format(parseISO(date), 'd MMMM')} felt`}>
      <div className="space-y-3" data-testid="day-symptom-sheet">
        <div className="flex flex-wrap gap-1.5" data-testid="symptom-tags">
          {SYMPTOM_TAGS.map((tg) => {
            const on = tags.some((x) => x.id === tg.id)
            return (
              <button key={tg.id} onClick={() => toggle(tg.id)} data-testid="symptom-tag"
                data-tag={tg.id} data-on={on ? 'true' : 'false'}
                className="flex min-h-[34px] items-center gap-1 rounded-full px-2.5 text-xs font-black"
                style={on
                  ? { background: tg.polarity === 'neg' ? 'color-mix(in srgb, var(--warn) 26%, transparent)' : 'color-mix(in srgb, var(--good) 26%, transparent)', color: tg.polarity === 'neg' ? 'var(--warn)' : 'var(--good)' }
                  : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                {tg.icon} {tg.label}
              </button>
            )
          })}
        </div>

        {tags.filter((x) => TAG_BY_ID[x.id]?.polarity === 'neg').map((x) => (
          <div key={x.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs font-bold">{TAG_BY_ID[x.id]?.label}</span>
            <div className="flex shrink-0 gap-1">
              {SEVERITY.map((sv) => (
                <button key={sv} onClick={() => setSeverity(x.id, sv)}
                  className="rounded-full px-2 py-1 text-xs font-black"
                  style={x.severity === sv
                    ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                    : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                  {sv}
                </button>
              ))}
            </div>
          </div>
        ))}

        <label className="block">
          <span className="t-caption mb-1 block" style={{ color: 'var(--text-2)' }}>Note (optional)</span>
          <input className="input" value={note} aria-label="Note" data-testid="symptom-note"
            placeholder="Anything worth remembering…" onChange={(e) => setNote(e.target.value)} />
        </label>

        <div className="flex gap-2">
          {existing && (
            <button onClick={() => { deleteSymptomLog(existing.id); showToast('Check-in removed'); onClose() }}
              aria-label="Delete this check-in" data-testid="symptom-delete"
              className="rounded-full px-3 py-3 text-xs font-black"
              style={{ background: 'var(--surface-sunk)', color: 'var(--danger)' }}>
              <Trash2 size={13} />
            </button>
          )}
          <button onClick={onClose} className="flex-1 rounded-full py-3 text-xs font-black"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>Cancel</button>
          <button onClick={save} disabled={tags.length === 0 && !note.trim()} data-testid="symptom-save"
            className="btn-primary flex-1 rounded-full py-3 text-xs font-black disabled:opacity-40">
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}
