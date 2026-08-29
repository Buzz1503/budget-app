import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Check, SkipForward, AlertCircle, Layers, Syringe as SyringeIcon, Wind, Sun, Moon,
  ChevronLeft, Pill, Trash2, Pencil,
} from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import Modal from './ui/Modal'
import SiteChooser from './SiteChooser'
import NumberField from './ui/NumberField'
import { useCalendarRange } from '../lib/useCalendarRange'
import { missedGroups, missedOralsOn, entryState, vialOnDate, stockNote, doseOnDate } from '../lib/backfill'
import { addDaysStr, prettyDate } from '../lib/schedule'
import { formatDose, formatUnitsLong } from '../lib/calc'
import { SITE_BY_ID, zoneOf } from '../lib/sites'

// Logged / Skipped / Missed are three different things and are never allowed to
// look like each other: each gets its own icon, its own word and its own tone.
const STATE_STYLE = {
  logged: { icon: Check, tone: 'var(--good)', label: 'Logged' },
  skipped: { icon: SkipForward, tone: 'var(--warn)', label: 'Skipped' },
  missed: { icon: AlertCircle, tone: 'var(--danger)', label: 'Missed' },
  due: { icon: SyringeIcon, tone: 'var(--text-2)', label: 'Due today' },
  scheduled: { icon: SyringeIcon, tone: 'var(--text-2)', label: 'Scheduled' },
}

/**
 * Adding a dose you took but never logged.
 *
 * One day at a time, showing everything that was owed on it and which of the
 * three states each one is in, so a correction is made against the record
 * rather than from memory. A group that shared a syringe is caught up as one
 * shot into one site, because that is what happened.
 */
export default function BackfillSheet({ open, onClose, date: initialDate }) {
  const t = todayStr()
  const [date, setDate] = useState(initialDate || addDaysStr(t, -1))
  const [siteStep, setSiteStep] = useState(null)   // { group } awaiting a site
  const [editing, setEditing] = useState(null)     // a logged dose being corrected

  useEffect(() => {
    if (open) {
      setDate(initialDate || addDaysStr(t, -1))
      setSiteStep(null)
      setEditing(null)
    }
  }, [open, initialDate, t])

  const cal = useCalendarRange(date, date)
  const day = cal.byDate[date]

  const backfillCoDraw = useStore((s) => s.backfillCoDraw)
  const skipDose = useStore((s) => s.skipDose)
  const showToast = useStore((s) => s.showToast)
  const undoLog = useStore((s) => s.undoLog)
  const unskip = useStore((s) => s.unskip)
  const openVials = useStore((s) => s.openVials)
  const finishedVials = useStore((s) => s.finishedVials)
  const peptides = useStore((s) => s.peptides)
  const doseLogs = useStore((s) => s.doseLogs)
  const skips = useStore((s) => s.skips)
  const toggleSupplementTaken = useStore((s) => s.toggleSupplementTaken)

  const groups = useMemo(() => (day ? missedGroups(day) : []), [day])
  const orals = useMemo(() => (day ? missedOralsOn(day) : []), [day])
  const future = date > t

  // What each group would do to the stock, worked out before anything is written.
  const stockFor = (group) => vialOnDate(group.items[0].peptideId, date, { openVials, finishedVials })

  // The calendar shows the rung the ladder is on now, which is not necessarily
  // the rung it was on then. Where a dose was actually recorded around that day
  // that record is the better answer, so it wins.
  const doseFor = (item) => {
    const p = peptides.find((x) => x.id === item.peptideId)
    return p ? doseOnDate(p, date, doseLogs, item.dose).dose : item.dose
  }

  const commit = (group, siteId) => {
    const ids = group.items.map((i) => i.peptideId)
    const doses = Object.fromEntries(group.items.map((i) => [i.peptideId, doseFor(i)]))
    const done = backfillCoDraw(ids, date, { siteId, doses })
    if (!done.length) return
    const written = useStore.getState().doseLogs.slice(-done.length).map((l) => l.id)
    showToast(
      done.length > 1
        ? `${done.length} added on ${prettyDate(date)} — one shot`
        : `${done[0].name} added on ${prettyDate(date)}`,
      () => { for (const id of written) undoLog(id) },
    )
    setSiteStep(null)
  }

  const logGroup = (group) => {
    if (group.nasal) { commit(group, null); return }
    setSiteStep({ group })
  }

  // Everything that needs no decision goes in at once; every injection still
  // asks where it went, one group at a time. Inventing a site nobody chose
  // would poison the rotation history that the next suggestion is built from.
  const logAll = () => {
    for (const g of groups) {
      if (!g.nasal) continue
      backfillCoDraw(g.items.map((i) => i.peptideId), date, {
        siteId: null, doses: Object.fromEntries(g.items.map((i) => [i.peptideId, doseFor(i)])),
      })
    }
    for (const s of orals) toggleSupplementTaken(s.supplementId, date)
    const needsSite = groups.filter((g) => !g.nasal)
    if (needsSite.length > 0) setSiteStep({ group: needsSite[0] })
    else showToast(`${prettyDate(date)} caught up`)
  }

  const skipGroup = (group) => {
    for (const i of group.items) skipDose(i.peptideId, 'Added later — deliberately skipped', date)
    showToast(`Marked skipped on ${prettyDate(date)}`)
  }

  // ---- site step: one site for the whole group, because it was one puncture ----
  if (siteStep) {
    return (
      <SiteStep
        group={siteStep.group}
        date={date}
        peptides={peptides}
        note={stockNote(stockFor(siteStep.group))}
        onBack={() => setSiteStep(null)}
        onConfirm={(siteId) => commit(siteStep.group, siteId)}
      />
    )
  }

  if (editing) {
    return <EditPastLog log={editing} onClose={() => setEditing(null)} onDone={() => setEditing(null)} />
  }

  const done = day ? [...day.entries, ...day.oralEntries].filter((e) => entryState(e, day) === 'logged') : []
  const skippedEntries = day ? [...day.entries, ...day.oralEntries].filter((e) => entryState(e, day) === 'skipped') : []
  const missedCount = groups.reduce((s, g) => s + g.items.length, 0) + orals.length

  return (
    <Modal open={open} onClose={onClose} title="Add a past dose"
      pinned={(
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>
            Which day?
          </span>
          <input type="date" className="input" value={date} max={t} aria-label="Which day"
            data-testid="backfill-date"
            onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
      )}>
      <div className="space-y-3" data-testid="backfill-sheet">
        {future && (
          <p className="rounded-[14px] p-3 text-xs font-bold" data-testid="backfill-future"
            style={{ background: 'color-mix(in srgb, var(--danger) 16%, transparent)', color: 'var(--danger)' }}>
            That day hasn't happened yet — a dose you haven't taken isn't a log.
          </p>
        )}

        {!future && day && day.scheduled === 0 && (
          <p className="py-6 text-center text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
            Nothing was scheduled on {prettyDate(date)} — there is nothing to catch up.
          </p>
        )}

        {!future && day && day.scheduled > 0 && (
          <p className="text-xs font-bold" style={{ color: 'var(--text-2)' }} data-testid="backfill-summary">
            {day.scheduled} due · {done.length} logged
            {skippedEntries.length > 0 ? ` · ${skippedEntries.length} skipped` : ''}
            {missedCount > 0 ? ` · ${missedCount} missed` : ''}
          </p>
        )}

        {/* ---- missed: the only part that is actionable ---- */}
        {missedCount > 0 && (
          <div className="space-y-2" data-testid="backfill-missed">
            <SectionHead state="missed" count={missedCount} />
            {groups.map((g) => (
              <MissedGroup key={g.key} group={g} note={stockNote(stockFor(g))}
                onLog={() => logGroup(g)} onSkip={() => skipGroup(g)} />
            ))}
            {orals.map((o) => (
              <div key={o.supplementId} className="rounded-[14px] p-3" data-testid="backfill-oral"
                style={{ background: 'var(--surface-sunk)' }}>
                <p className="flex items-center gap-2 text-xs font-black">
                  <Pill size={13} style={{ color: 'var(--text-2)' }} /> {o.name}
                  {o.dose ? <span className="font-semibold" style={{ color: 'var(--text-2)' }}>{o.dose}</span> : null}
                </p>
                <button onClick={() => { toggleSupplementTaken(o.supplementId, date); showToast(`${o.name} added on ${prettyDate(date)}`) }}
                  data-testid="backfill-log-oral"
                  className="btn-primary mt-2 w-full rounded-full py-2 text-xs font-black">
                  Log it
                </button>
              </div>
            ))}
            {missedCount > 1 && (
              <button onClick={logAll} data-testid="backfill-log-all"
                className="btn-primary w-full rounded-full py-3 text-xs font-black">
                Log all {missedCount} for {prettyDate(date)}
              </button>
            )}
          </div>
        )}

        {/* ---- already accounted for ---- */}
        {done.length > 0 && (
          <div className="space-y-2" data-testid="backfill-logged">
            <SectionHead state="logged" count={done.length} />
            {done.map((e) => {
              const log = doseLogs.find((l) => l.date === date && l.peptideId === e.peptideId)
              return (
                <div key={e.peptideId || e.supplementId} className="flex items-center gap-2 rounded-[14px] p-3"
                  style={{ background: 'var(--surface-sunk)' }}>
                  <Check size={13} className="shrink-0" strokeWidth={3} style={{ color: 'var(--good)' }} />
                  <span className="min-w-0 flex-1 truncate text-xs font-black">
                    {e.name}
                    <span className="ml-2 font-semibold" style={{ color: 'var(--text-2)' }}>
                      {e.oral ? e.dose : formatDose(e.dose, e.unit)}
                      {log?.siteId ? ` · ${SITE_BY_ID[log.siteId]?.short || SITE_BY_ID[log.siteId]?.label}` : ''}
                      {log?.backfilled ? ' · added later' : ''}
                    </span>
                  </span>
                  {log && (
                    <button onClick={() => setEditing(log)} data-testid="backfill-edit"
                      aria-label={`Correct ${e.name} on ${date}`}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                      style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
                      <Pencil size={12} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {skippedEntries.length > 0 && (
          <div className="space-y-2" data-testid="backfill-skipped">
            <SectionHead state="skipped" count={skippedEntries.length} />
            {skippedEntries.map((e) => {
              const sk = skips.find((k) => k.date === date && (k.peptideId === e.peptideId || k.supplementId === e.supplementId))
              return (
                <div key={e.peptideId || e.supplementId} className="flex items-center gap-2 rounded-[14px] p-3"
                  style={{ background: 'var(--surface-sunk)', opacity: 0.85 }}>
                  <SkipForward size={13} className="shrink-0" style={{ color: 'var(--warn)' }} />
                  <span className="min-w-0 flex-1 truncate text-xs font-black">
                    {e.name}
                    <span className="ml-2 font-semibold" style={{ color: 'var(--text-2)' }}>skipped on purpose</span>
                  </span>
                  {sk && (
                    <button onClick={() => { unskip(sk.id); showToast('Back on that day\'s list') }}
                      data-testid="backfill-unskip"
                      className="shrink-0 rounded-full px-2 py-1 text-xs font-black"
                      style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
                      Actually took it
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <p className="pb-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
          A dose added here is recorded exactly like a live one — same draw on the vial that was open that
          day, same effect on your run-out date, your adherence and your site rotation.
        </p>
      </div>
    </Modal>
  )
}

function SectionHead({ state, count }) {
  const s = STATE_STYLE[state]
  const Icon = s.icon
  return (
    <p className="flex items-center gap-1.5 pt-1 text-xs font-black uppercase tracking-wide" style={{ color: s.tone }}>
      <Icon size={12} strokeWidth={3} /> {s.label} · {count}
    </p>
  )
}

function MissedGroup({ group, note, onLog, onSkip }) {
  const many = group.items.length > 1
  return (
    <div className="rounded-[14px] p-3" data-testid="backfill-group"
      style={{ background: 'var(--surface-sunk)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)' }}>
      <div className="flex items-start gap-2">
        {group.nasal
          ? <Wind size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--text-2)' }} />
          : many
            ? <Layers size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--good)' }} />
            : <SyringeIcon size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--text-2)' }} />}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black leading-snug">
            {group.items.map((i, n) => (
              <span key={i.peptideId}>
                {n > 0 && <span style={{ color: 'var(--good)' }}> + </span>}
                {i.name}
                <span className="font-semibold" style={{ color: 'var(--text-2)' }}> {formatDose(i.dose, i.unit)}</span>
              </span>
            ))}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--text-2)' }}>
            {group.slot === 'AM' ? <Sun size={10} /> : group.slot === 'PM' ? <Moon size={10} /> : null}
            {group.nasal
              ? 'nasal spray'
              : <>{formatUnitsLong(group.units)}{many ? ' · one syringe, one site' : ''}</>}
          </p>
          <p className="mt-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>{note}</p>
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <button onClick={onSkip} data-testid="backfill-skip-group"
          className="rounded-full px-3 py-2 text-xs font-black"
          style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
          I skipped it
        </button>
        <button onClick={onLog} data-testid="backfill-log-group"
          className="btn-primary flex-1 rounded-full py-2 text-xs font-black">
          Log it{many ? ` — all ${group.items.length}` : ''}
        </button>
      </div>
    </div>
  )
}

// One site for the whole group. Three compounds in one syringe went into one
// spot, and recording three spots would corrupt the rotation history that the
// next suggestion is built from.
function SiteStep({ group, date, peptides, note, onBack, onConfirm }) {
  const [picked, setPicked] = useState(null)
  const [resolved, setResolved] = useState(null)
  const chosen = picked || resolved
  const first = peptides.find((p) => p.id === group.items[0].peptideId)
  const route = first?.route === 'IM' ? 'IM' : 'SubQ'
  const site = SITE_BY_ID[chosen]

  return (
    <Modal open onClose={onBack} title={`Where did it go on ${prettyDate(date)}?`}>
      <div className="space-y-3">
        <button onClick={onBack} className="flex items-center gap-1 text-xs font-black" style={{ color: 'var(--text-2)' }}>
          <ChevronLeft size={14} /> Back to the day
        </button>

        <div className="rounded-[14px] p-3 text-center" style={{ background: 'var(--surface-sunk)' }}>
          <p className="text-lg font-black leading-tight">
            {group.items.map((i) => i.name).join(' + ')}
          </p>
          <p className="mt-1 text-xs font-bold" style={{ color: 'var(--text-2)' }}>
            {formatUnitsLong(group.units)}{group.items.length > 1 ? ' · one syringe' : ''}
          </p>
        </div>

        <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>{note}</p>

        <SiteChooser route={route} zone={zoneOf(first)} picked={picked} onPick={setPicked} onResolve={setResolved} />

        <motion.button whileTap={{ scale: 0.97 }} onClick={() => onConfirm(chosen)}
          data-testid="backfill-confirm-site"
          className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-4 text-sm font-black">
          <SyringeIcon size={17} strokeWidth={2.5} /> Add it here — {site?.short || site?.label || 'pick a spot'}
        </motion.button>
      </div>
    </Modal>
  )
}

// Correcting or removing a dose already on the record.
function EditPastLog({ log, onClose }) {
  const editLog = useStore((s) => s.editLog)
  const undoLog = useStore((s) => s.undoLog)
  const showToast = useStore((s) => s.showToast)
  const t = todayStr()
  const [dose, setDose] = useState(log.doseValue)
  const [date, setDate] = useState(log.date)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <Modal open onClose={onClose} title={confirmDelete ? 'Delete this dose?' : 'Correct this dose'}>
      {confirmDelete ? (
        <div className="space-y-3" data-testid="backfill-confirm-delete">
          <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
            The dose on <span className="font-black" style={{ color: 'var(--text)' }}>{prettyDate(log.date)}</span> comes
            off your history{log.movedStock === false ? '' : ', and what it drew goes back into the vial'}. That day
            goes back to reading as missed, and your adherence and run-out date move to match.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmDelete(false)} className="flex-1 rounded-full py-3 text-xs font-black"
              style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>Keep it</button>
            <button data-testid="backfill-delete-yes"
              onClick={() => { undoLog(log.id); showToast('Dose deleted'); onClose() }}
              className="flex-1 rounded-full py-3 text-xs font-black"
              style={{ background: 'color-mix(in srgb, var(--danger) 22%, transparent)', color: 'var(--danger)' }}>
              Delete it
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3" data-testid="backfill-edit-form">
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Day</span>
            <input type="date" className="input" value={date} max={t} aria-label="Dose date"
              onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>
              Dose ({log.unit})
            </span>
            <NumberField value={dose} onChange={(v) => setDose(v ?? 0)} min={0} aria-label="Dose value" />
          </label>
          <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Changing the dose moves the vial by the difference, not by a whole extra dose.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmDelete(true)} data-testid="backfill-delete"
              aria-label="Delete this dose"
              className="rounded-full px-3 py-3 text-xs font-black"
              style={{ background: 'var(--surface-sunk)', color: 'var(--danger)' }}>
              <Trash2 size={13} />
            </button>
            <button onClick={onClose} className="flex-1 rounded-full py-3 text-xs font-black"
              style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>Cancel</button>
            <button data-testid="backfill-edit-save"
              onClick={() => { editLog(log.id, { date, doseValue: dose }); showToast('Dose corrected'); onClose() }}
              className="btn-primary flex-1 rounded-full py-3 text-xs font-black">Save</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
