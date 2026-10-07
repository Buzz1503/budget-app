import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Paperclip, AlertTriangle } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore from '../../store/useStore'
import NumberField from '../ui/NumberField'
import { PANEL_ORDER, allMarkers } from '../../lib/bloods'
import { buildPreview, commitPlan, countsLine, normName, isRealDate } from '../../lib/bloodImport'

/**
 * Everything an import is about to do, before it does any of it.
 *
 * A full screen rather than a sheet: a report is dozens of rows and the two
 * things that matter — what the count says and whether the Import button is
 * live — have to stay in view while the list scrolls. Nothing here writes to the
 * record. It edits a plain object of changes, buildPreview() turns the file plus
 * those changes into what would happen, and only the Import button hands the
 * result on.
 */
export default function ImportPreview({ fileName, entries, warnings = [], onCancel, onConfirm }) {
  const bloods = useStore((s) => s.bloods)
  const tests = bloods?.tests || []
  const customMarkers = bloods?.customMarkers || []
  const overrides = bloods?.rangeOverrides || {}

  const [edits, setEdits] = useState({})
  const [files, setFiles] = useState({})

  const preview = useMemo(
    () => buildPreview(entries, { tests, customMarkers, overrides }, edits),
    [entries, tests, customMarkers, overrides, edits],
  )
  const markers = useMemo(() => allMarkers(customMarkers), [customMarkers])

  // small immutable updaters over the one edits object
  const setEntry = (i, patch) => setEdits((e) => ({ ...e, entries: { ...e.entries, [i]: { ...e.entries?.[i], ...patch } } }))
  const setRow = (key, patch) => setEdits((e) => ({ ...e, rows: { ...e.rows, [key]: { ...e.rows?.[key], ...patch } } }))
  const setResolution = (name, patch) => setEdits((e) => ({ ...e, resolutions: { ...e.resolutions, [name]: { ...e.resolutions?.[name], ...patch } } }))
  const setMarkerDef = (name, patch) => setEdits((e) => ({ ...e, markers: { ...e.markers, [name]: { ...e.markers?.[name], ...patch } } }))

  const { counts, blockers, canImport } = preview
  const active = preview.entries.filter((e) => !e.skipped)
  const multi = entries.length > 1

  const cancelEntry = (i) => {
    // cancelling the only result is cancelling the import
    if (!multi) { onCancel(); return }
    setEntry(i, { mode: 'skip' })
  }

  return createPortal(
    <div
      data-testid="import-preview"
      className="fixed inset-0 z-[60] flex flex-col"
      style={{
        background: 'var(--bg)', height: '100dvh',
        paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* ------------------------------------------------------- header */}
      <div className="shrink-0 px-4 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-black tracking-tight">Check before importing</h2>
            <p className="truncate text-xs font-medium" style={{ color: 'var(--text-3)' }}>{fileName}</p>
          </div>
          <button onClick={onCancel} data-testid="import-close" aria-label="Cancel the import"
            className="shrink-0 rounded-full p-2" style={{ background: 'var(--surface-sunk)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="mt-2 rounded-[var(--r-sm)] p-3" style={{ background: 'var(--surface-sunk)' }}>
          <p className="text-sm font-black tabular-nums" data-testid="import-counts">{countsLine(counts)}</p>
          <p className="text-xs font-medium tabular-nums" data-testid="import-tosave" style={{ color: 'var(--text-2)' }}>
            {counts.toSave} will be saved{counts.excluded ? ` · ${counts.excluded} excluded` : ''}
            {counts.outOfRange ? ` · ${counts.outOfRange} outside the interval` : ''}
          </p>
          <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
            Nothing has been saved yet.
          </p>
        </div>
      </div>

      {/* --------------------------------------------------------- body */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3" data-testid="import-body">
        {warnings.length > 0 && (
          <div className="rounded-[var(--r-sm)] p-2.5 text-xs font-medium leading-snug" data-testid="import-warnings"
            style={{ background: 'color-mix(in srgb, var(--warn) 10%, transparent)', color: 'var(--text-2)' }}>
            {warnings.map((w) => <p key={w}>{w}</p>)}
          </div>
        )}

        {preview.entries.map((entry) => (
          <EntryCard
            key={entry.index}
            entry={entry}
            multi={multi}
            file={files[entry.index] || null}
            existingAttachment={entry.conflict?.hasAttachment}
            markers={markers}
            declared={entries[entry.index].newMarkers}
            edits={edits}
            onEntry={(patch) => setEntry(entry.index, patch)}
            onCancel={() => cancelEntry(entry.index)}
            onRow={setRow}
            onResolve={setResolution}
            onMarkerDef={setMarkerDef}
            onFile={(f) => setFiles((x) => ({ ...x, [entry.index]: f }))}
          />
        ))}
      </div>

      {/* ------------------------------------------------------- footer */}
      <div className="shrink-0 space-y-2 px-4 pb-3 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
        {blockers.length > 0 ? (
          <p className="flex items-start gap-1.5 text-xs font-bold" data-testid="import-blockers" style={{ color: 'var(--warn)' }}>
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>{blockers.length} to sort out first. {blockers[0].text}</span>
          </p>
        ) : !canImport && active.length > 0 ? (
          <p className="text-xs font-medium" data-testid="import-nothing" style={{ color: 'var(--text-3)' }}>
            Nothing here would add anything new.
          </p>
        ) : null}
        <div className="flex gap-2">
          <button onClick={onCancel} data-testid="import-cancel"
            className="rounded-full px-5 py-3 text-sm font-black" style={{ background: 'var(--surface-sunk)' }}>
            Cancel
          </button>
          <button
            onClick={() => onConfirm(commitPlan(preview), files)}
            disabled={!canImport}
            data-testid="import-commit"
            className="btn-primary min-w-0 flex-1 rounded-full py-3 text-sm font-black disabled:opacity-40"
          >
            Import {counts.toSave} value{counts.toSave === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------- one test

const field = (text) => <span className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-2)' }}>{text}</span>

function EntryCard({ entry, multi, file, existingAttachment, markers, declared, edits, onEntry, onCancel, onRow, onResolve, onMarkerDef, onFile }) {
  const fileRef = useRef(null)
  const i = entry.index
  const pretty = entry.validDate ? format(parseISO(entry.date), 'EEEE d MMMM yyyy') : null

  if (entry.skipped) {
    return (
      <div className="card flex items-center gap-3 p-3" data-testid={`import-entry-${i}`} data-skipped="true">
        <span className="min-w-0 flex-1 text-sm font-bold tabular-nums" style={{ color: 'var(--text-3)' }}>
          {pretty || entry.date} · cancelled
        </span>
        <button className="chip shrink-0" data-testid={`import-unskip-${i}`}
          onClick={() => onEntry({ mode: entry.conflict ? null : 'add' })}>
          Include again
        </button>
      </div>
    )
  }

  return (
    <section className="space-y-3" data-testid={`import-entry-${i}`}>
      <div className="card space-y-3 p-3">
        {/* the date, written out in full so a wrong one is obvious */}
        <div>
          <p className="t-caption" style={{ color: 'var(--text-3)' }}>Collected</p>
          <p className="text-lg font-black leading-tight" data-testid={`import-date-text-${i}`}
            style={{ color: pretty ? 'var(--text)' : 'var(--danger)' }}>
            {pretty || 'Not a real date'}
          </p>
          {entry.dateWarning && (
            <p className="text-xs font-bold" data-testid={`import-date-warning-${i}`} style={{ color: 'var(--warn)' }}>
              {entry.dateWarning} Check it is right.
            </p>
          )}
        </div>

        <label className="block">
          {field('Date')}
          <input type="date" className="input" value={isRealDate(entry.date) ? entry.date : ''}
            data-testid={`import-date-${i}`} onChange={(e) => e.target.value && onEntry({ date: e.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            {field('Lab')}
            <input className="input" value={entry.lab} data-testid={`import-lab-${i}`} onChange={(e) => onEntry({ lab: e.target.value })} />
          </label>
          <label className="block">
            {field('Reference')}
            <input className="input" value={entry.ref} data-testid={`import-ref-${i}`} onChange={(e) => onEntry({ ref: e.target.value })} />
          </label>
        </div>
        <label className="block">
          {field('Notes')}
          <input className="input" value={entry.notes} data-testid={`import-notes-${i}`} onChange={(e) => onEntry({ notes: e.target.value })} />
        </label>

        {entry.conflict && <Conflict entry={entry} multi={multi} onEntry={onEntry} onCancel={onCancel} />}

        {/* the original report, kept with this date */}
        <div>
          {field('Original report (optional)')}
          <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden"
            data-testid={`import-attach-input-${i}`}
            onChange={(e) => { onFile(e.target.files?.[0] || null); e.target.value = '' }} />
          {file ? (
            <div className="flex items-center gap-2" data-testid={`import-attached-${i}`}>
              <Paperclip size={14} className="shrink-0" style={{ color: 'var(--text-3)' }} />
              <span className="min-w-0 flex-1 truncate text-xs font-bold">{file.name}</span>
              <button className="chip shrink-0" onClick={() => onFile(null)}>Remove</button>
            </div>
          ) : (
            <button className="chip" data-testid={`import-attach-${i}`} onClick={() => fileRef.current?.click()}>
              <Paperclip size={13} /> Attach a PDF or photo
            </button>
          )}
          {file && existingAttachment && (
            <p className="mt-1 text-xs font-medium" style={{ color: 'var(--warn)' }}>
              This date already has a report attached. This one replaces it.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {entry.rows.map((row) => (
          <Row
            key={row.key}
            row={row}
            entry={entry}
            markers={markers}
            declaredDef={declared.find((d) => normName(d.name) === normName(row.name))}
            edits={edits}
            onRow={onRow}
            onResolve={onResolve}
            onMarkerDef={onMarkerDef}
          />
        ))}
      </div>
    </section>
  )
}

/** A date that already has a result: three answers, and no default. */
function Conflict({ entry, multi, onEntry, onCancel }) {
  const i = entry.index
  const c = entry.conflict
  const pick = (mode) => (mode === 'cancel' ? onCancel() : onEntry({ mode }))
  const describe = {
    merge: 'Fills only the markers that are empty. Everything already recorded stays as it is.',
    replace: `Removes the ${c.markerCount} value${c.markerCount === 1 ? '' : 's'} already recorded for this date and uses this file's.`,
  }
  return (
    <div className="rounded-[var(--r-sm)] p-3" data-testid={`import-conflict-${i}`}
      style={{ background: 'color-mix(in srgb, var(--warn) 10%, var(--surface-sunk))' }}>
      <p className="text-sm font-black" style={{ color: 'var(--warn)' }}>A result for this date already exists</p>
      <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
        {c.markerCount} marker{c.markerCount === 1 ? '' : 's'}{c.lab ? ` from ${c.lab}` : ''} are recorded. Nothing is overwritten until you choose.
      </p>
      <div className="mt-2 grid grid-cols-3 gap-1.5" role="radiogroup">
        {[['merge', 'Merge'], ['replace', 'Replace'], ['cancel', multi ? 'Skip' : 'Cancel']].map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={entry.mode === id}
            data-testid={`import-mode-${i}-${id}`} data-on={entry.mode === id ? 'true' : 'false'}
            onClick={() => pick(id)}
            className="rounded-full py-2 text-sm font-black"
            style={entry.mode === id
              ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
              : { background: 'var(--surface-sunk)', color: 'var(--text)' }}>
            {label}
          </button>
        ))}
      </div>
      {entry.mode && describe[entry.mode] && (
        <p className="mt-2 text-xs font-medium" data-testid={`import-mode-note-${i}`} style={{ color: 'var(--text-2)' }}>
          {describe[entry.mode]}
        </p>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ one row

const KIND = {
  recognised: { label: 'Recognised', color: 'var(--text-3)' },
  new: { label: 'New marker', color: 'var(--info)' },
  unrecognised: { label: 'Unrecognised', color: 'var(--warn)' },
}

function Row({ row, entry, markers, declaredDef, edits, onRow, onResolve, onMarkerDef }) {
  const kind = KIND[row.kind]
  const status = row.status
  const flagged = status === 'low' || status === 'high'
  const key = row.key
  const dim = row.excluded

  return (
    <div className="card p-3" data-testid={`import-row-${key}`} data-kind={row.kind} data-excluded={row.excluded ? 'true' : 'false'}
      style={{ opacity: dim ? 0.55 : 1 }}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words text-sm font-black">{row.mappedTo ? `${row.name} → ${row.mappedTo}` : row.name}</p>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-black" data-testid={`import-kind-${key}`}
          style={{ background: 'var(--surface-sunk)', color: kind.color }}>
          {kind.label}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <input
          className="input !w-28 text-right tabular-nums" inputMode="decimal" aria-label={`${row.name} value`}
          data-testid={`import-value-${key}`} value={row.valueText} disabled={dim}
          onChange={(e) => onRow(key, { value: e.target.value.replace(',', '.') })}
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: 'var(--text-3)' }}>
          {row.markerUnit || row.unit}
        </span>
        <button className="chip shrink-0" data-testid={`import-exclude-${key}`} aria-pressed={row.excluded}
          onClick={() => onRow(key, { excluded: !row.excluded })}>
          {row.excluded ? 'Include' : 'Exclude'}
        </button>
      </div>

      {row.marker && row.value != null && (
        row.compared === false ? (
          <p className="mt-1.5 text-xs font-bold" data-testid={`import-range-${key}`} data-status="uncompared"
            style={{ color: 'var(--text-3)' }}>
            Not compared with the interval: different unit
          </p>
        ) : (
          <p className="mt-1.5 text-xs font-bold tabular-nums" data-testid={`import-range-${key}`} data-status={status}
            style={{ color: flagged ? 'var(--warn)' : 'var(--text-3)' }}>
            {status === 'high' ? 'High' : status === 'low' ? 'Low' : status === 'in' ? 'In range' : 'No stated interval'}
            {row.rangeText && status !== 'unknown' ? ` · ${row.rangeText}` : ''}
          </p>
        )
      )}

      {entry.conflict && entry.mode && !row.excluded && row.existingValue != null && (
        <p className="mt-1 text-xs font-medium tabular-nums" data-testid={`import-effect-${key}`} data-effect={row.effect}
          style={{ color: 'var(--text-2)' }}>
          {row.effect === 'kept' && `Keeps the ${row.existingValue} already recorded.`}
          {row.effect === 'overwrites' && `Replaces the ${row.existingValue} already recorded.`}
        </p>
      )}
      {entry.conflict && entry.mode === 'merge' && !row.excluded && row.effect === 'fills' && (
        <p className="mt-1 text-xs font-medium" data-testid={`import-effect-${key}`} data-effect="fills" style={{ color: 'var(--text-2)' }}>
          Fills an empty slot.
        </p>
      )}

      {row.problems.map((p) => (
        <div key={p.kind} className="mt-2 rounded-[var(--r-sm)] p-2"
          data-testid={`import-problem-${key}-${p.kind}`}
          style={{ background: 'color-mix(in srgb, var(--warn) 10%, transparent)' }}>
          <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-2)' }}>{p.text}</p>
        </div>
      ))}
      {!row.excluded && row.problems.some((p) => p.needsConfirm) && (
        <div className="mt-2">
          {row.confirmed ? (
            <p className="text-xs font-bold" data-testid={`import-confirmed-${key}`} style={{ color: 'var(--text-3)' }}>
              Confirmed as entered.
            </p>
          ) : (
            <button className="chip" data-testid={`import-confirm-${key}`}
              onClick={() => onRow(key, { confirmedFor: row.valueText })}>
              The value is right. Keep it
            </button>
          )}
        </div>
      )}

      {row.kind === 'unrecognised' && !row.excluded && (
        <Resolve row={row} markers={markers} edits={edits} onResolve={onResolve} />
      )}
      {row.kind === 'new' && !row.excluded && declaredDef && (
        <NewMarker row={row} edits={edits} onMarkerDef={onMarkerDef} />
      )}
    </div>
  )
}

/** Three honest answers for a name the app has never seen. */
function Resolve({ row, markers, edits, onResolve }) {
  const name = normName(row.name)
  const res = edits.resolutions?.[name] || {}
  const key = row.key
  const action = res.action
  const byPanel = PANEL_ORDER.map((p) => [p, markers.filter((m) => m.panel === p)]).filter(([, ms]) => ms.length)

  return (
    <div className="mt-3 space-y-2" data-testid={`import-resolve-${key}`}>
      <p className="text-xs font-bold" style={{ color: 'var(--warn)' }}>
        The app has no marker called "{row.name}". Choose what to do with it.
      </p>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup">
        {[['add', 'Add as new'], ['map', 'Map to one'], ['skip', 'Skip']].map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={action === id}
            data-testid={`import-res-${key}-${id}`} data-on={action === id ? 'true' : 'false'}
            onClick={() => onResolve(name, { action: id, ...(id === 'add' ? { panel: res.panel || 'Chemistry', unit: res.unit ?? row.unit ?? '' } : {}) })}
            className="rounded-full py-2 text-xs font-black"
            style={action === id
              ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
              : { background: 'var(--surface-sunk)', color: 'var(--text)' }}>
            {label}
          </button>
        ))}
      </div>

      {action === 'map' && (
        <select className="input" aria-label={`Map ${row.name} to`} data-testid={`import-map-${key}`}
          value={res.mapTo || ''} onChange={(e) => onResolve(name, { mapTo: e.target.value })}>
          <option value="">Choose a marker…</option>
          {byPanel.map(([panel, ms]) => (
            <optgroup key={panel} label={panel}>
              {ms.map((m) => <option key={m.name} value={m.name}>{m.name}{m.unit ? ` (${m.unit})` : ''}</option>)}
            </optgroup>
          ))}
        </select>
      )}
      {action === 'add' && <DefFields def={{ panel: res.panel || 'Chemistry', unit: res.unit ?? row.unit ?? '', refLow: res.refLow, refHigh: res.refHigh }}
        onChange={(patch) => onResolve(name, patch)} testKey={key} />}
    </div>
  )
}

/** A marker the file declared: its definition, shown, and editable on request. */
function NewMarker({ row, edits, onMarkerDef }) {
  const [open, setOpen] = useState(false)
  const name = normName(row.name)
  const m = row.marker
  const def = { panel: m.panel, unit: m.unit, refLow: m.refLow, refHigh: m.refHigh }
  return (
    <div className="mt-2" data-testid={`import-newdef-${row.key}`}>
      <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
        Will be added to {m.panel}{m.unit ? ` · ${m.unit}` : ''}{m.refLow != null || m.refHigh != null
          ? ` · ${m.refLow ?? ''}${m.refLow != null && m.refHigh != null ? '–' : ''}${m.refHigh ?? ''}` : ''}
        <button className="ml-2 underline" style={{ color: 'var(--text-3)' }} data-testid={`import-newdef-edit-${row.key}`}
          onClick={() => setOpen((v) => !v)}>
          {open ? 'Done' : 'Edit'}
        </button>
      </p>
      {open && <div className="mt-2"><DefFields def={def} onChange={(patch) => onMarkerDef(name, patch)} testKey={row.key} /></div>}
    </div>
  )
}

function DefFields({ def, onChange, testKey }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="block">
        {field('Panel')}
        <select className="input" value={def.panel} data-testid={`import-def-panel-${testKey}`} onChange={(e) => onChange({ panel: e.target.value })}>
          {PANEL_ORDER.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label className="block">
        {field('Unit')}
        <input className="input" value={def.unit || ''} data-testid={`import-def-unit-${testKey}`} onChange={(e) => onChange({ unit: e.target.value })} />
      </label>
      {/* NumberField keeps what is typed as text until it is committed, so "0." and
          "0.5" can be typed; parsing on every keystroke turns "0." into 0 */}
      <label className="block">
        {field('Low')}
        <NumberField min={null} allowEmpty className="tabular-nums" value={def.refLow ?? undefined}
          data-testid={`import-def-low-${testKey}`} aria-label="Low limit"
          onChange={(n) => onChange({ refLow: n === undefined ? null : n })} />
      </label>
      <label className="block">
        {field('High')}
        <NumberField min={null} allowEmpty className="tabular-nums" value={def.refHigh ?? undefined}
          data-testid={`import-def-high-${testKey}`} aria-label="High limit"
          onChange={(n) => onChange({ refHigh: n === undefined ? null : n })} />
      </label>
    </div>
  )
}
