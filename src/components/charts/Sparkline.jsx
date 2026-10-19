/** A tiny neutral line of the last few readings. */
export default function Sparkline({ values, width = 64, height = 20, color = 'var(--text-3)' }) {
  const pts = values.filter((v) => v != null)
  if (pts.length < 2) return <span style={{ width, height, display: 'inline-block' }} />
  const lo = Math.min(...pts)
  const hi = Math.max(...pts)
  const step = width / (values.length - 1 || 1)
  const y = (v) => height - 2 - ((v - lo) / (hi - lo || 1)) * (height - 4)
  const path = values.map((v, i) => (v == null ? null : `${(i * step).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ')
  return (
    <svg width={width} height={height} aria-hidden="true" data-testid="sparkline" className="shrink-0">
      <polyline points={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}
