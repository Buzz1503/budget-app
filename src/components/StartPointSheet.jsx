import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import useStore from '../store/useStore'
import Modal from './ui/Modal'
import NumberField from './ui/NumberField'
import PickerField from './ui/PickerField'
import { METRICS } from '../lib/metrics'
import { SCAN_FIELDS } from '../body/scanFields'
import { entryValues } from '../body/startPoint'
import { useHealthLink } from '../lib/healthLink'
import { useBodyStart } from '../lib/useBody'

const pretty = (d) => format(parseISO(d), 'd MMM yyyy')
const BODY_FIELDS = [...METRICS.filter((m) => ['weight', 'bodyFat', 'visceralFat', 'muscleMass', 'waist'].includes(m.key)), ...SCAN_FIELDS]
const TAPE_FIELDS = METRICS.filter((m) => !['weight', 'bodyFat', 'visceralFat', 'muscleMass', 'waist'].includes(m.key))
const LABEL = Object.fromEntries([...METRICS, ...SCAN_FIELDS].map((f) => [f.key, f]))

const r1 = (x) => Number(Number(x).toFixed(1))

/** "105.6 kg · 38.3% BF · lean 65.2 kg" */
function valuesLine(v) {
  return [
    v.weight != null && `${r1(v.weight)} kg`,
    v.bodyFat != null && `${r1(v.bodyFat)}% BF`,
    v.leanMass != null && `lean ${r1(v.leanMass)} kg`,
    v.waist != null && `waist ${r1(v.waist)} cm`,
  ].filter(Boolean).join(' · ') || Object.entries(v).slice(0, 3).map(([k, x]) => `${LABEL[k]?.label || k} ${r1(x)}`).join(' · ')
}

const deviceOf = (m) => (m.source === 'scan' ? (m.device || 'Scan') : 'Manual')

/**
 * Where every "since" delta starts. Pick an entry already on record, type one
 * in, or go back to the default (the start of the first tracked compound).
 */
export default function StartPointSheet({ open, onClose, onViewEntry = null }) {
  const bodyStart = useStore((s) => s.bodyStart)
  const measurements = useStore((s) => s.measurements)
  const setBodyStart = useStore((s) => s.setBodyStart)
  const resetBodyStart = useStore((s) => s.resetBodyStart)
  const health = useHealthLink((s) => s.bodyDaily)
  const effective = useBodyStart()
  const [mode, setMode] = useState('entry')
  const [kind, setKind] = useState('all')
  const [limit, setLimit] = useState(40)
  const [form, setForm] = useState({ date: null, label: '', values: {} })
  const [more, setMore] = useState(false)

  useEffect(() => {
    if (!open) return
    setMode('entry')
    setKind('all')
    setLimit(40)
    setForm(bodyStart && !bodyStart.entryId
      ? { date: bodyStart.date, label: bodyStart.label || '', values: { ...bodyStart.values } }
      : { date: null, label: '', values: {} })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // every body entry on record, newest first: typed, scanned and from Apple Health
  const entries = useMemo(() => [
    ...measurements.map((m) => ({
      key: m.id, date: m.date, source: deviceOf(m), kind: m.source === 'scan' ? 'scan' : 'manual', label: m.label || null, hidden: !!m.hiddenFromCharts,
      values: entryValues(m), entryId: m.id, device: m.source === 'scan' ? (m.device || 'Scan') : null,
    })),
    ...health.map((h) => {
      const device = /withings/i.test(h.weightSource || '') ? 'Withings' : (h.weightSource || 'Apple Health')
      const values = Object.fromEntries([['weight', h.weight], ['bodyFat', h.bodyFatPct], ['leanMass', h.leanMass]].filter(([, v]) => v != null))
      return { key: `health-${h.date}`, date: h.date, source: device, kind: 'health', label: null, hidden: false, values, entryId: `health:${h.date}`, device }
    }),
  ].filter((e) => Object.keys(e.values).length).sort((a, b) => b.date.localeCompare(a.date)), [measurements, health])

  const shown = kind === 'all' ? entries : entries.filter((e) => e.kind === kind)

  const use = (e) => {
    setBodyStart({ date: e.date, label: e.label, values: e.values, entryId: e.entryId, device: e.device })
    onClose()
  }
  const saveManual = () => {
    if (!form.date) return
    setBodyStart({ date: form.date, label: form.label.trim() || null, values: form.values })
    onClose()
  }
  const setValue = (k, v) => setForm((f) => ({ ...f, values: { ...f.values, [k]: v } }))
  const numberField = (f) => (
    <label key={f.key} className="block min-w-0">
      <span className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-2)' }}>{f.label}{f.unit ? ` (${f.unit})` : ''}</span>
      <NumberField allowEmpty emptyValue={null} min={0} value={form.values[f.key] ?? ''} onChange={(v) => setValue(f.key, v)} aria-label={f.label} data-testid={`start-field-${f.key}`} />
    </label>
  )

  return (
    <Modal open={open} onClose={onClose} title="Starting point" wide>
      <div className="space-y-3" data-testid="start-sheet">
        <div className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid="start-current">
          <p className="t-caption" style={{ color: 'var(--text-3)' }}>{bodyStart ? 'Set' : 'Default'}</p>
          {effective ? (
            <>
              <p className="text-sm font-black tabular-nums">{pretty(effective.date)}{effective.label ? `, ${effective.label}` : ''}</p>
              <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                {bodyStart ? (valuesLine(effective.values || {}) || 'No values set; each field starts from its first reading on or after this date.')
                  : 'The day your first tracked compound started. Each field starts from its first reading on or after it.'}
              </p>
            </>
          ) : <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>No readings yet.</p>}
          {onViewEntry && bodyStart?.entryId && measurements.some((m) => m.id === bodyStart.entryId) && (
            <button onClick={() => { onClose(); onViewEntry(bodyStart.entryId) }} className="mt-1 text-xs font-bold" style={{ color: 'var(--text)' }} data-testid="start-view-entry">
              View this entry
            </button>
          )}
          <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>Every "since" change on the body tiles and charts is measured from here.</p>
        </div>

        <div className="flex gap-1 rounded-full p-1" style={{ background: 'var(--surface-sunk)' }} role="tablist">
          {[['entry', 'Use an existing entry'], ['manual', 'Enter manually']].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)} data-testid={`start-mode-${k}`}
              className="min-h-[34px] flex-1 rounded-full text-xs font-bold"
              style={mode === k ? { background: 'var(--surface2)', color: 'var(--text)' } : { color: 'var(--text-3)' }}>
              {label}
            </button>
          ))}
        </div>

        {mode === 'entry' && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show entries from">
            {[['all', 'All'], ['scan', 'Scans'], ['manual', 'Manual'], ['health', 'Apple Health']]
              .filter(([k]) => k === 'all' || entries.some((e) => e.kind === k))
              .map(([k, label]) => (
                <button key={k} onClick={() => { setKind(k); setLimit(40) }} aria-pressed={kind === k} data-testid={`start-kind-${k}`}
                  className="min-h-[30px] rounded-full px-3 text-xs font-bold"
                  style={kind === k ? { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' } : { background: 'var(--surface-sunk)', color: 'var(--text-3)', border: '1px solid transparent' }}>
                  {label}
                </button>
              ))}
          </div>
        )}
        {mode === 'entry' && (
          <div className="rows" data-testid="start-entries">
            {shown.length === 0 && <p className="py-3 text-xs font-medium" style={{ color: 'var(--text-2)' }}>No body entries yet.</p>}
            {shown.slice(0, limit).map((e) => {
              const on = bodyStart?.entryId === e.entryId
              return (
                <button key={e.key} onClick={() => use(e)} className="flex w-full items-start gap-2 py-2.5 text-left" data-testid="start-entry" data-entry={e.entryId} aria-pressed={on}>
                  <span className="w-[84px] shrink-0 text-xs font-bold tabular-nums">{pretty(e.date)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>{valuesLine(e.values)}</span>
                    {(e.label || e.hidden) && <span className="block text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>{[e.label, e.hidden && !e.label ? 'Kept off charts' : null].filter(Boolean).join(' · ')}</span>}
                  </span>
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={on ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                    {on ? 'Start' : e.source}
                  </span>
                </button>
              )
            })}
            {shown.length > limit && (
              <button onClick={() => setLimit((n) => n + 60)} className="w-full py-2.5 text-xs font-bold" style={{ color: 'var(--text-2)' }}>Show older entries</button>
            )}
          </div>
        )}

        {mode === 'manual' && (
          <div className="space-y-3" data-testid="start-manual">
            <div className="min-w-0">
              <span className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-2)' }}>Date</span>
              <PickerField kind="date" label="Starting date" value={form.date} clearable={false} emptyText="Choose a date" testid="start-date"
                onChange={(v) => setForm((f) => ({ ...f, date: v }))} />
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-2)' }}>Label (optional)</span>
              <input className="input" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="For example: Start of protocol" data-testid="start-label" />
            </label>
            <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>All values are optional. A field left empty starts from its first reading on or after the date.</p>
            <div className="grid grid-cols-2 gap-3">{BODY_FIELDS.map(numberField)}</div>
            <button onClick={() => setMore((v) => !v)} className="text-xs font-bold" style={{ color: 'var(--text-2)' }}>{more ? 'Hide tape measurements' : 'Add tape measurements'}</button>
            {more && <div className="grid grid-cols-2 gap-3">{TAPE_FIELDS.map(numberField)}</div>}
            <button onClick={saveManual} disabled={!form.date} data-testid="start-save" className="btn-primary w-full rounded-full py-3 text-sm font-black disabled:opacity-40">
              Use as starting point
            </button>
          </div>
        )}

        <button onClick={() => { resetBodyStart(); onClose() }} disabled={!bodyStart} data-testid="start-reset"
          className="w-full rounded-full py-3 text-xs font-bold disabled:opacity-40" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
          Reset to default
        </button>
      </div>
    </Modal>
  )
}
