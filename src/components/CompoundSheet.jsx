import { useMemo, useState } from 'react'
import {
  Syringe, Wind, Calendar, Package, Pencil, Trash2, Plus, StickyNote,
  SkipForward, AlertTriangle, Clock, Check,
} from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import Modal from './ui/Modal'
import NumberField from './ui/NumberField'
import ReferenceInfo, { TierBadge } from './ReferenceInfo'
import { referenceFor, protocolTextFrom } from '../lib/reference'
import { currentRung, cycleInfo, prettyDate, addDaysStr } from '../lib/schedule'
import { formatDose, concentration, isNasal } from '../lib/calc'
import { scheduledWeekdaySet, WEEKDAYS } from '../lib/daily'
import { SITE_BY_ID } from '../lib/sites'
import { runwayFor, durationWords, batchesFor, sealedCount } from '../lib/stock'

const FREQ_LABELS = {
  daily: 'Daily', nightly: 'Nightly', weekly: 'Weekly',
  '2xweek': '2×/week', '3xweek': '3×/week', '5on2off': '5 on / 2 off',
}

/**
 * Everything known about one compound, in one place.
 *
 * Deliberately read-only for anything the user has set. Dose, ladder and
 * schedule are edited in Build/rebuild and nowhere else — two editing paths
 * into the same field is how two screens end up disagreeing about what the
 * protocol actually is. This sheet shows, explains, and hands you over to the
 * one place that changes things.
 *
 * The exceptions are the two things that belong to this compound and to no
 * screen at all: my own notes, and corrections to my own log.
 */
export default function CompoundSheet({ open, compoundId, onClose, goTo }) {
  const peptides = useStore((s) => s.peptides)
  const vials = useStore((s) => s.vials)
  const openVials = useStore((s) => s.openVials)
  const titration = useStore((s) => s.titration)
  const doseLogs = useStore((s) => s.doseLogs)
  const skips = useStore((s) => s.skips)
  const leadDays = useStore((s) => s.settings.restockLeadDays)
  const setPeptideNote = useStore((s) => s.setPeptideNote)
  const t = todayStr()

  const [tab, setTab] = useState('about')
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)

  const peptide = peptides.find((p) => p.id === compoundId)
  const batches = batchesFor(vials, compoundId)
  const stockName = batches[0]?.name
  const reference = referenceFor(compoundId)
  const name = peptide?.name || stockName || reference?.name || compoundId

  const logs = useMemo(
    () => doseLogs.filter((l) => l.peptideId === compoundId).slice().sort((a, b) => b.date.localeCompare(a.date)),
    [doseLogs, compoundId]
  )
  const mySkips = useMemo(
    () => (skips || []).filter((s) => s.peptideId === compoundId),
    [skips, compoundId]
  )

  if (!open || !compoundId) return null

  const runway = peptide
    ? runwayFor(peptide, titration[compoundId], openVials[compoundId], vials, doseLogs, t, leadDays)
    : null
  const cyc = peptide ? cycleInfo(peptide, t) : null
  const rung = peptide ? currentRung(peptide, titration[compoundId]) : null
  const unlinked = !!openVials[compoundId]?.unlinked

  return (
    <Modal open={open} onClose={onClose} title={name} wide>
      <div className="space-y-2.5" data-testid="compound-sheet">
        {/* what this compound is, to this app */}
        <div className="flex flex-wrap items-center gap-1.5">
          {reference?.tier && <TierBadge tier={reference.tier} confidence={reference.confidence} />}
          <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
            style={peptide
              ? { background: 'color-mix(in srgb, var(--lime) 18%, transparent)', color: 'var(--lime)' }
              : { background: 'var(--surface2)', color: 'var(--muted)' }}>
            {peptide ? 'in my protocol' : 'not in my protocol'}
          </span>
          {batches.length > 0 && (
            <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
              style={{ background: 'color-mix(in srgb, var(--amber) 18%, transparent)', color: 'var(--amber)' }}>
              {sealedCount(vials, compoundId)} in stock
            </span>
          )}
        </div>

        <div className="flex gap-1.5">
          {[['about', 'About'], ['mine', 'My settings'], ['history', 'History']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} data-testid={`sheet-tab-${id}`}
              className="flex-1 rounded-full py-1.5 text-[11px] font-black"
              style={tab === id
                ? { backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff' }
                : { background: 'var(--surface2)', color: 'var(--muted)' }}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'about' && <AboutTab reference={reference} name={name} />}

        {tab === 'mine' && (
          <MineTab
            peptide={peptide} rung={rung} cyc={cyc} runway={runway} unlinked={unlinked}
            batches={batches} note={peptide?.note || ''}
            onNote={(v) => peptide && setPeptideNote(peptide.id, v)}
            onEdit={() => { onClose(); goTo?.('wizard') }}
          />
        )}

        {tab === 'history' && (
          <HistoryTabPane
            logs={logs} skips={mySkips} peptide={peptide}
            onEdit={setEditing} onAdd={() => setAdding(true)}
          />
        )}
      </div>

      {editing && <EditLogModal log={editing} onClose={() => setEditing(null)} />}
      {adding && peptide && <BackfillModal peptide={peptide} onClose={() => setAdding(false)} />}
    </Modal>
  )
}

// ------------------------------------------------------------------ about

function AboutTab({ reference, name }) {
  if (!reference) {
    return (
      <p className="py-6 text-center text-xs font-semibold" style={{ color: 'var(--muted)' }}>
        No reference entry for {name}. Everything about it is whatever you set.
      </p>
    )
  }
  const text = protocolTextFrom(reference)
  return (
    <div className="space-y-2.5">
      {reference.mechanism && (
        <p className="text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
          <span className="font-black" style={{ color: 'var(--text)' }}>How it works. </span>
          {reference.mechanism}
        </p>
      )}
      {reference.human_data && (
        <p className="text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
          <span className="font-black" style={{ color: 'var(--text)' }}>Human data. </span>
          {reference.human_data}
        </p>
      )}

      {text && !text.excluded && (text.doseText || text.frequencyText || text.cycleText) && (
        <div className="rounded-2xl p-3" style={{ background: 'var(--surface2)' }}>
          <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: 'var(--indigo)' }}>
            Dosing reference
          </p>
          <div className="mt-1.5 space-y-1 text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
            {text.doseText && <p><span className="font-black" style={{ color: 'var(--text)' }}>Dose. </span>{text.doseText}</p>}
            {text.frequencyText && <p><span className="font-black" style={{ color: 'var(--text)' }}>Frequency. </span>{text.frequencyText}</p>}
            {text.cycleText && <p><span className="font-black" style={{ color: 'var(--text)' }}>Cycle. </span>{text.cycleText}</p>}
          </div>
        </div>
      )}
      {text?.excluded && (
        <p className="flex items-start gap-1.5 rounded-2xl p-3 text-[11px] font-bold"
          style={{ background: 'color-mix(in srgb, var(--rose) 12%, transparent)', color: 'var(--rose)' }}>
          <AlertTriangle size={13} className="mt-px shrink-0" />
          Dosing is deliberately withheld for this compound — read the safety notes below.
        </p>
      )}

      <ReferenceInfo reference={{
        tier: reference.tier, confidence: reference.confidence, mechanism: reference.mechanism,
        humanData: reference.human_data, established: reference.established || [],
        reported: reference.reported || [], safety: reference.safety || [],
        monitor: reference.monitor || [],
      }} />
    </div>
  )
}

// -------------------------------------------------------------- my settings

function Row({ label, value, tone }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="text-right text-[12px] font-black" style={{ color: tone || 'var(--text)' }}>{value}</span>
    </div>
  )
}

function MineTab({ peptide, rung, cyc, runway, unlinked, batches, note, onNote, onEdit }) {
  if (!peptide) {
    return (
      <div className="space-y-2.5">
        <p className="text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
          This one isn't in my protocol — it's{batches.length ? ' just stock on the shelf' : ' only in the catalogue'}.
          Nothing is scheduled for it and nothing is logged against it.
        </p>
        <button onClick={onEdit} data-testid="add-to-protocol"
          className="btn-primary flex w-full items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-black">
          <Plus size={14} /> Add it to my protocol
        </button>
      </div>
    )
  }

  const nasal = isNasal(peptide)
  const days = scheduledWeekdaySet(peptide)
  const conc = concentration(peptide.recon?.vialMg, peptide.recon?.bacMl)

  return (
    <div className="space-y-2.5">
      <div className="rounded-2xl px-3 py-1" style={{ background: 'var(--surface2)' }}>
        <Row label="Dose now" value={rung ? formatDose(rung.dose, peptide.ladder?.unit) : '—'} tone="var(--lime)" />
        <Row label="Ladder" value={peptide.ladder?.ceiling > 0
          ? `${formatDose(peptide.ladder.floor, peptide.ladder.unit)} → ${formatDose(peptide.ladder.ceiling, peptide.ladder.unit)}`
          : 'not set'} />
        <Row label="Rung" value={rung ? `${rung.level + 1} of ${rung.maxLevel + 1}` : '—'} />
        <Row label="Frequency" value={FREQ_LABELS[peptide.frequency] || peptide.frequency} />
        <Row label="Days" value={days.size === 7 ? 'Every day' : [...days].map((d) => WEEKDAYS[d]).join(', ') || '—'} />
        <Row label="Slot" value={peptide.slot || 'AM'} />
        <Row label="Route" value={nasal ? 'Nasal spray' : (peptide.route || 'SubQ')} />
        {!nasal && (
          <Row label="Reconstitution" value={peptide.recon?.bacMl > 0
            ? `${peptide.recon.vialMg} mg in ${peptide.recon.bacMl} mL · ${Math.round(conc * 1000) / 1000} mg/mL`
            : 'not set'} />
        )}
        <Row label="Cycle" value={cyc?.ongoing ? 'Ongoing' : `Day ${cyc?.cycleDay} · ${cyc?.isOn ? 'on' : 'off'}`}
          tone={cyc && !cyc.ongoing && !cyc.isOn ? 'var(--muted)' : undefined} />
        <Row label="Started" value={prettyDate(peptide.startDate)} />
      </div>

      {/* the vial behind it, or the honest absence of one */}
      <div className="rounded-2xl p-3" style={{ background: 'var(--surface2)' }}>
        <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide"
          style={{ color: unlinked ? 'var(--amber)' : 'var(--lime)' }}>
          <Package size={12} /> {unlinked ? 'Not in stock' : 'Stock'}
        </p>
        <p className="mt-1 text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
          {unlinked
            ? 'This still schedules and still logs — there is just no vial behind it, so nothing is being drawn down.'
            : runway && isFinite(runway.days)
              ? `${durationWords(runway.days)} left${runway.restockByDate ? ` · restock by ${prettyDate(runway.restockByDate)}` : ''}`
              : batches.length ? `${batches.length} batch${batches.length === 1 ? '' : 'es'} on the shelf` : 'Nothing recorded in stock.'}
        </p>
      </div>

      {/* my own words about it */}
      <div>
        <p className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide" style={{ color: 'var(--violet)' }}>
          <StickyNote size={12} /> My notes
        </p>
        <textarea className="input min-h-[72px] resize-y" value={note} aria-label="My notes"
          data-testid="compound-note" placeholder="Anything you want to remember about this one…"
          onChange={(e) => onNote(e.target.value)} />
      </div>

      <button onClick={onEdit} data-testid="edit-in-wizard"
        className="flex w-full items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-black"
        style={{ background: 'var(--surface2)', color: 'var(--violet)' }}>
        <Pencil size={13} /> Edit dose &amp; schedule in Build / rebuild
      </button>
      <p className="text-center text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
        Everything above is set in one place, so no two screens can disagree about it.
      </p>
    </div>
  )
}

// ----------------------------------------------------------------- history

function HistoryTabPane({ logs, skips, peptide, onEdit, onAdd }) {
  const rows = useMemo(() => {
    const all = [
      ...logs.map((l) => ({ kind: 'dose', date: l.date, log: l })),
      ...skips.map((s) => ({ kind: 'skip', date: s.date, skip: s })),
    ]
    return all.sort((a, b) => b.date.localeCompare(a.date))
  }, [logs, skips])

  return (
    <div className="space-y-2">
      {peptide && (
        <button onClick={onAdd} data-testid="backfill-open"
          className="flex w-full items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-black"
          style={{ background: 'color-mix(in srgb, var(--lime) 16%, transparent)', color: 'var(--lime)' }}>
          <Plus size={14} /> Add a dose I forgot to log
        </button>
      )}

      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        {logs.length} dose{logs.length === 1 ? '' : 's'}{skips.length ? ` · ${skips.length} skipped` : ''}
      </p>

      {rows.length === 0 && (
        <p className="py-6 text-center text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          Nothing logged for this one yet.
        </p>
      )}

      <div className="space-y-1.5" data-testid="compound-history">
        {rows.map((r) => r.kind === 'dose' ? (
          <div key={r.log.id} className="flex items-center gap-2.5 rounded-2xl p-2.5" data-testid="history-row"
            style={{ background: 'var(--surface2)' }}>
            <Syringe size={14} className="shrink-0" style={{ color: 'var(--lime)' }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-black leading-tight">
                {formatDose(r.log.doseValue, r.log.unit)}
                {r.log.insulinUnits != null && (
                  <span className="ml-1.5 text-[10px] font-bold" style={{ color: 'var(--muted)' }}>
                    {r.log.insulinUnits} units
                  </span>
                )}
              </p>
              <p className="truncate text-[10px] font-semibold leading-tight" style={{ color: 'var(--muted)' }}>
                {prettyDate(r.log.date)}
                {r.log.siteId ? ` · ${SITE_BY_ID[r.log.siteId]?.label || r.log.siteId}` : ''}
                {r.log.backfilled ? ' · added later' : ''}
                {r.log.edited ? ' · edited' : ''}
              </p>
            </div>
            <button onClick={() => onEdit(r.log)} aria-label={`Edit the dose on ${r.log.date}`}
              data-testid="history-edit"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
              style={{ background: 'var(--surface-solid)', color: 'var(--muted)' }}>
              <Pencil size={12} />
            </button>
          </div>
        ) : (
          <div key={`${r.skip.peptideId}-${r.skip.date}`} className="flex items-center gap-2.5 rounded-2xl p-2.5"
            data-testid="history-row" style={{ background: 'var(--surface2)', opacity: 0.75 }}>
            <SkipForward size={14} className="shrink-0" style={{ color: 'var(--amber)' }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-black leading-tight" style={{ color: 'var(--amber)' }}>Skipped</p>
              <p className="truncate text-[10px] font-semibold leading-tight" style={{ color: 'var(--muted)' }}>
                {prettyDate(r.skip.date)}{r.skip.reason ? ` · ${r.skip.reason}` : ''}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------- backfill & correct

function BackfillModal({ peptide, onClose }) {
  const backfillDose = useStore((s) => s.backfillDose)
  const showToast = useStore((s) => s.showToast)
  const undoLog = useStore((s) => s.undoLog)
  const doseLogs = useStore((s) => s.doseLogs)
  const t = todayStr()
  const [date, setDate] = useState(addDaysStr(t, -1))

  const save = () => {
    if (!date || date > t) return
    const p = backfillDose(peptide.id, date)
    if (!p) return
    const added = useStore.getState().doseLogs
    const id = added[added.length - 1]?.id
    showToast(`${peptide.name} added on ${prettyDate(date)}`, () => undoLog(id))
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={`Add a past ${peptide.name} dose`}>
      <div className="space-y-2.5" data-testid="backfill-form">
        <p className="text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
          Recorded exactly like a live one, at the dose your ladder was on — so your vial, your run-out
          date and your adherence all catch up with what actually happened.
        </p>
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Which day?
          </span>
          <input type="date" className="input" value={date} max={t} aria-label="Dose date"
            onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        {date > t && (
          <p className="text-[11px] font-bold" style={{ color: 'var(--coral)' }}>
            That's in the future — a dose you haven't taken isn't a log.
          </p>
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-full py-2.5 text-xs font-black"
            style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>Cancel</button>
          <button onClick={save} disabled={!date || date > t} data-testid="backfill-save"
            className="btn-primary flex-1 rounded-full py-2.5 text-xs font-black disabled:opacity-40">
            Add it
          </button>
        </div>
      </div>
    </Modal>
  )
}

function EditLogModal({ log, onClose }) {
  const editLog = useStore((s) => s.editLog)
  const undoLog = useStore((s) => s.undoLog)
  const showToast = useStore((s) => s.showToast)
  const t = todayStr()
  const [date, setDate] = useState(log.date)
  const [dose, setDose] = useState(log.doseValue)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = () => {
    editLog(log.id, { date, doseValue: dose })
    showToast('Dose corrected')
    onClose()
  }

  const del = () => {
    undoLog(log.id)
    showToast('Dose deleted — the drug went back in the vial')
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={confirmDelete ? 'Delete this dose?' : 'Correct this dose'}>
      {confirmDelete ? (
        <div className="space-y-2.5" data-testid="confirm-delete-log">
          <p className="text-[12px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
            The dose on <span className="font-black" style={{ color: 'var(--text)' }}>{prettyDate(log.date)}</span> is
            removed from your history, and what it drew comes back into the vial. Your adherence and run-out
            date both move to match.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmDelete(false)} className="flex-1 rounded-full py-2.5 text-xs font-black"
              style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>Keep it</button>
            <button onClick={del} data-testid="confirm-delete-log-yes"
              className="flex-1 rounded-full py-2.5 text-xs font-black"
              style={{ background: 'color-mix(in srgb, var(--coral) 22%, transparent)', color: 'var(--coral)' }}>
              Delete
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5" data-testid="edit-log-form">
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Date</span>
            <input type="date" className="input" value={date} max={t} aria-label="Log date"
              onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Dose ({log.unit})
            </span>
            <NumberField value={dose} onChange={(v) => setDose(v ?? 0)} min={0} aria-label="Dose value" />
          </label>
          <p className="text-[10px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
            Changing the dose moves the vial by the difference, not by a whole extra dose.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmDelete(true)} data-testid="delete-log"
              className="rounded-full px-3 py-2.5 text-xs font-black"
              style={{ background: 'var(--surface2)', color: 'var(--coral)' }}>
              <Trash2 size={13} />
            </button>
            <button onClick={onClose} className="flex-1 rounded-full py-2.5 text-xs font-black"
              style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>Cancel</button>
            <button onClick={save} data-testid="edit-log-save"
              className="btn-primary flex-1 rounded-full py-2.5 text-xs font-black">Save</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
