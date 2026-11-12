/**
 * The one segment control every tab uses (three at most). Hidden when there is
 * only one segment to show, as on the web where Apple Health is not read.
 */
export default function Segments({ items, value, onChange, testid = 'segments', idPrefix = 'seg' }) {
  if (items.length < 2) return null
  return (
    <div className="flex gap-1 rounded-full p-1" style={{ background: 'var(--surface-sunk)' }} role="tablist" data-testid={testid}>
      {items.map((s) => (
        <button key={s.id} role="tab" aria-selected={value === s.id} onClick={() => onChange(s.id)} data-testid={`${idPrefix}-${s.id}`}
          className="min-h-[34px] flex-auto whitespace-nowrap rounded-full px-2 text-xs font-bold"
          style={value === s.id ? { background: 'var(--surface2)', color: 'var(--text)' } : { color: 'var(--text-3)' }}>
          {s.label}
        </button>
      ))}
    </div>
  )
}
