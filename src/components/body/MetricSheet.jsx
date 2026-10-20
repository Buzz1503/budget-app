import Modal from '../ui/Modal'
import TrendChart from '../charts/TrendChart'
import BodyChart from '../charts/BodyChart'
import useChartEvents from '../charts/useChartEvents'

/**
 * One metric's chart, opened from a tile or a row: one source at a time (Scale
 * or Evolt where both have it), "Since start" by default. The Evolt reference
 * range is a faint band on the Evolt line where the scan gives one. A derived
 * series (FFMI) is drawn as given.
 */
export default function MetricSheet({ metric, onClose }) {
  const events = useChartEvents()
  const open = !!metric
  const key = metric?.key
  return (
    <Modal open={open} onClose={onClose} title={metric?.label || ''} wide>
      {open && (
        <div className="space-y-2" data-testid="metric-sheet" data-metric={key}>
          {metric.series ? (
            <TrendChart metric={key} chartType={`metric-${key}`} title={metric.label} unit={metric.unit} dp={metric.dp ?? 1}
              series={metric.series} events={events} defaultRange="All"
              current={metric.series.at(-1)?.value ?? null} />
          ) : (
            <BodyChart metric={key} chartType={`metric-${key}`} title={metric.label} unit={metric.unit} dp={metric.dp ?? 1} events={events} />
          )}
          {metric.definition && <p className="px-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>{metric.definition}</p>}
        </div>
      )}
    </Modal>
  )
}
