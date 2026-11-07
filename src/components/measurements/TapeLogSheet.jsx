import { useEffect, useMemo, useState } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import { METRIC_BY_KEY, refPhrase } from '../../lib/metrics'
import {
  TAPE_SITES, TAPE_SITE_BY_KEY, TAPE_TIP, sheetSites, prefill, entryFromSheet, stepValue,
} from '../../body/tape'

const soft = { color: 'var(--text-2)' }
const muted = { color: 'var(--text-3)' }

function Stepper({ k, value, touched, onChange, how }) {
  const site = TAPE_SITE_BY_KEY[k]
  const [text, setText] = useState(value == null ? '' : String(value))
  useEffect(() => { setText(value == null ? '' : String(value)) }, [value])
  const btn = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full'
  return (
    <div className="flex items-center gap-2 py-2.5" data-testid={`tape-row-${k}`} data-touched={touched ? 'true' : 'false'}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{site.label}</span>
        <span className="block text-[13px] font-medium" style={muted}>{touched ? 'New' : value == null ? 'Not measured yet' : 'Last value'}</span>
        {how && <span className="mt-0.5 block text-[13px] font-medium leading-snug" style={soft} data-testid={`tape-how-${k}`}>{how}</span>}
      </span>
      <button type="button" className={btn} style={{ background: 'var(--surface-sunk)' }} aria-label={`${site.label} down 0.1 cm`}
        onClick={() => onChange(stepValue(value, -0.1))} data-testid={`tape-minus-${k}`}><Minus size={18} /></button>
      <input type="text" inputMode="decimal" value={text} aria-label={`${site.label} in cm`} data-testid={`tape-input-${k}`}
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value.replace(',', '.'))
          if (e.target.value !== '' && Number.isFinite(v)) onChange(v)
        }}
        className="input w-[76px] !px-2 !py-2 text-center text-[17px] font-semibold tabular-nums"
        style={touched ? { borderColor: 'var(--accent)' } : undefined} />
      <button type="button" className={btn} style={{ background: 'var(--surface-sunk)' }} aria-label={`${site.label} up 0.1 cm`}
        onClick={() => onChange(stepValue(value, 0.1))} data-testid={`tape-plus-${k}`}><Plus size={18} /></button>
    </div>
  )
}

/**
 * Log tape: every site on one screen, each starting at its last value, with
 * 0.1 cm steppers and a number field. Only the sites changed are saved; one
 * Save for all.
 */
export default function TapeLogSheet({ open, onClose }) {
  const measurements = useStore((s) => s.measurements)
  const settings = useStore((s) => s.tapeSettings)
  const setTapeSettings = useStore((s) => s.setTapeSettings)
  const logTape = useStore((s) => s.logTape)
  const bodyRefs = useStore((s) => s.bodyRefs)
  const [showHow, setShowHow] = useState(false)
  const howFor = (k) => {
    const m = METRIC_BY_KEY[k]
    if (!m?.how) return null
    const ref = m.refKey ? refPhrase(bodyRefs, m.refKey) : null
    return ref ? `${m.how} Yours: ${ref}.` : m.how
  }
  const sites = useMemo(() => sheetSites(measurements, settings), [measurements, settings])
  const [date, setDate] = useState(todayStr())
  const [values, setValues] = useState({})
  const [touched, setTouched] = useState(new Set())
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (!open) return
    setDate(todayStr())
    setValues(prefill(measurements, sites))
    setTouched(new Set())
    setAdding(false)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const change = (k, v) => {
    setValues((x) => ({ ...x, [k]: v }))
    setTouched((t) => new Set(t).add(k))
  }
  const hidden = TAPE_SITES.filter((s) => !s.legacy && !sites.includes(s.key))
  const setSites = (next) => setTapeSettings({ sites: TAPE_SITES.filter((s) => next.includes(s.key)).map((s) => s.key) })
  const fields = entryFromSheet(values, touched)
  const count = Object.keys(fields).length

  const save = () => {
    if (!count) return
    logTape(date, fields)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Log tape measurements" wide>
      <div className="space-y-3" data-testid="tape-sheet">
        <label className="flex items-center gap-3">
          <span className="text-sm font-semibold" style={soft}>Date</span>
          <input type="date" className="input flex-1" value={date} max={todayStr()} onChange={(e) => e.target.value && setDate(e.target.value)} data-testid="tape-date" />
        </label>
        <button type="button" onClick={() => setShowHow(!showHow)} className="text-sm font-bold" style={soft} data-testid="tape-how">
          {showHow ? 'Hide how to measure' : 'How to measure each site'}
        </button>
        <div className="rows">
          {sites.map((k) => (
            <div key={k} className="flex items-center gap-1">
              <div className="min-w-0 flex-1"><Stepper k={k} value={values[k] ?? null} touched={touched.has(k)} onChange={(v) => change(k, v)} how={showHow ? howFor(k) : null} /></div>
              <button type="button" onClick={() => setSites(sites.filter((x) => x !== k))} aria-label={`Hide ${TAPE_SITE_BY_KEY[k].label}`}
                className="flex h-9 w-7 shrink-0 items-center justify-center" style={muted} data-testid={`tape-hide-${k}`}><X size={14} /></button>
            </div>
          ))}
        </div>
        {hidden.length > 0 && (
          adding ? (
            <div className="flex flex-wrap gap-2" data-testid="tape-add-list">
              {hidden.map((s) => (
                <button key={s.key} type="button" onClick={() => { setSites([...sites, s.key]); setValues((x) => ({ ...x, ...prefill(measurements, [s.key]) })) }}
                  className="min-h-[36px] rounded-full px-3 text-xs font-bold" style={{ background: 'var(--surface-sunk)' }} data-testid={`tape-add-${s.key}`}>
                  + {s.label}
                </button>
              ))}
            </div>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="text-sm font-bold" style={soft} data-testid="tape-add-site">+ Add a site</button>
          )
        )}
        <button type="button" onClick={save} disabled={!count} className="btn-primary w-full rounded-full py-3 text-sm font-black disabled:opacity-40" data-testid="tape-save">
          {count ? `Save ${count} ${count === 1 ? 'measurement' : 'measurements'}` : 'Change a value to save'}
        </button>
        <p className="text-center text-xs font-medium" style={muted} data-testid="tape-tip">{TAPE_TIP}</p>
      </div>
    </Modal>
  )
}
