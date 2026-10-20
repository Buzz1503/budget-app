import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import useStore from '../../store/useStore'
import TrendChart from './TrendChart'
import { useBodyInput, useBodyStart } from '../../lib/useBody'
import { seriesByFamily, FAMILY_LABEL } from '../../body/bodySeries'
import { getStartValue } from '../../body/startPoint'
import { resolveSource } from '../../body/sources'
import { latestScanMeta } from '../../body/composition'

/** Scale | Evolt, only the sources that have data. A single source needs no control. */
export function SourceToggle({ options, value, onChange }) {
  if (options.length < 2) return null
  return (
    <div className="flex gap-1 rounded-full p-1" role="group" aria-label="Source" style={{ background: 'var(--surface-sunk)' }} data-testid="source-toggle">
      {options.map((f) => (
        <button key={f} onClick={() => onChange(f)} aria-pressed={value === f} data-testid={`source-${f}`} data-on={value === f ? 'true' : 'false'}
          className="min-h-[28px] flex-1 rounded-full text-xs font-bold"
          style={value === f ? { background: 'var(--surface2)', color: 'var(--text)' } : { color: 'var(--text-3)' }}>
          {FAMILY_LABEL[f] || f}
        </button>
      ))}
    </div>
  )
}

/** The source a metric's chart shows, remembered per metric. */
export function useChartSource(metric, available) {
  const saved = useStore((s) => s.chartSources?.[metric])
  const set = useStore((s) => s.setChartSource)
  const family = resolveSource(metric, available, saved)
  return [family, (f) => set(metric, f)]
}

/**
 * A body metric from one source at a time: weight from Scale by default, body
 * fat, fat mass and lean mass from Evolt, and the scan-only metrics from Evolt
 * with no control. The starting point is the "Since start" range and the
 * dashed Start line, read from the source on screen.
 */
export default function BodyChart({ metric, chartType = `body-${metric}`, title, unit = '', dp = 1, events = [], testid, note = null, onEditDate = null, defaultRange = 'Start' }) {
  const input = useBodyInput()
  const start = useBodyStart()
  const families = useMemo(() => seriesByFamily(metric, input), [metric, input])
  const available = Object.keys(families).sort((a, b) => (a === 'scale' ? -1 : b === 'scale' ? 1 : 0))
  const [family, setFamily] = useChartSource(metric, available)
  const series = family ? families[family] : []
  const startLine = useMemo(() => (start ? getStartValue(metric, start, input, { family }) : null), [metric, start, input, family])
  const meta = useMemo(() => latestScanMeta(input.measurements || [], metric), [input, metric])
  const refBand = family === 'evolt' && meta.range ? { lo: meta.range[0], hi: meta.range[1], label: 'Evolt reference range' } : null
  const last = series[series.length - 1]
  return (
    <TrendChart key={`${metric}-${family}`} metric={metric} chartType={chartType} title={title} unit={unit} dp={dp} series={series} events={events}
      defaultRange={defaultRange} startLine={startLine} refBand={refBand} testid={testid || `body-chart-${metric}`}
      current={last?.value ?? null} currentCaption={last ? `${format(parseISO(last.date), 'd MMM')}, ${last.sourceLabel}` : null}
      controls={<SourceToggle options={available} value={family} onChange={setFamily} />} note={note} onEditDate={onEditDate} />
  )
}
