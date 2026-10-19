import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { compareScans } from '../../body/composition'

const label = (s) => `${format(parseISO(s.date), 'd MMM yyyy')}${s.estimated ? ' (estimated)' : ''}`

/**
 * Two scans side by side: every metric and segment both have, with the
 * difference, biggest change first. Defaults to the first and latest scan.
 */
export default function ScanCompare({ scans }) {
  const list = useMemo(() => [...scans].sort((a, b) => a.date.localeCompare(b.date) || String(a.time || '').localeCompare(String(b.time || ''))), [scans])
  const real = list.filter((s) => !s.estimated)
  const [aId, setA] = useState(real[0]?.id)
  const [bId, setB] = useState(real[real.length - 1]?.id)
  const [all, setAll] = useState(false)
  const a = list.find((s) => s.id === aId)
  const b = list.find((s) => s.id === bId)
  const rows = a && b ? compareScans(a, b) : []
  if (list.length < 2) return null
  const shown = all ? rows : rows.slice(0, 10)

  return (
    <section className="card p-4" data-testid="scan-compare">
      <h2 className="text-base font-black">Compare two scans</h2>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {[[aId, setA, 'From'], [bId, setB, 'To']].map(([v, set, l]) => (
          <label key={l} className="block min-w-0">
            <span className="t-caption mb-1 block" style={{ color: 'var(--text-3)' }}>{l}</span>
            <select className="input" value={v || ''} onChange={(e) => set(e.target.value)} data-testid={`compare-${l.toLowerCase()}`} aria-label={`${l} scan`}>
              {list.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}
            </select>
          </label>
        ))}
      </div>
      {(a?.estimated || b?.estimated) && (
        <p className="mt-2 text-xs font-medium" style={{ color: 'var(--text-3)' }} data-testid="compare-estimated">An estimated entry is in this comparison; its values are adjusted, not measured.</p>
      )}
      <div className="mt-3 rows">
        {shown.map((r) => (
          <div key={r.key} className="flex items-baseline gap-2 py-2 text-xs tabular-nums" data-testid="compare-row" data-key={r.key}>
            <span className="min-w-0 flex-1 truncate font-bold">{r.label}{r.unit ? ` (${r.unit})` : ''}</span>
            <span className="w-[54px] text-right font-medium" style={{ color: 'var(--text-3)' }}>{r.a.toFixed(r.dp)}</span>
            <span className="w-[54px] text-right font-medium" style={{ color: 'var(--text-2)' }}>{r.b.toFixed(r.dp)}</span>
            <span className="w-[58px] text-right font-black">{r.diff > 0 ? '+' : ''}{r.diff.toFixed(r.dp)}</span>
          </div>
        ))}
      </div>
      {rows.length > 10 && (
        <button onClick={() => setAll((v) => !v)} className="mt-1 w-full py-2 text-xs font-bold" style={{ color: 'var(--text-2)' }} data-testid="compare-all">
          {all ? 'Show the 10 biggest changes' : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  )
}
