/** The same switch as Settings › Site map and More › Health. */
export default function Switch({ on, onChange, label, hint, testId }) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="text-sm font-semibold">{label}</span>
        {hint && <span className="block text-xs font-medium" style={{ color: 'var(--text-3)' }}>{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} data-testid={testId} data-on={on ? 'true' : 'false'}
        onClick={() => onChange(!on)} className="relative h-7 w-12 shrink-0 rounded-full transition-colors"
        style={{ background: on ? 'var(--good)' : 'var(--surface-sunk)', border: `1px solid ${on ? 'transparent' : 'var(--border)'}` }}>
        <span className="absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition-all"
          style={{ left: on ? 'calc(100% - 22px)' : '2px', background: on ? 'var(--accent-fg)' : 'var(--text-3)' }} />
      </button>
    </div>
  )
}
