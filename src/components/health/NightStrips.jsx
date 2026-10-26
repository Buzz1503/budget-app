import { W } from './SleepCharts'
import { NO_RECORDING_LINE } from '../../sleep/prompts'

const L = 44
const R = 8
const ROW = 22

/**
 * Under the hypnogram, on the same time axis: Watch movement, snoring and
 * other sounds, heart rate through the night, blood oxygen readings, audio in
 * bed, and nightmare event markers. Each row only when it was recorded.
 */
export default function NightStrips({ night, overnight, restless, soundSessions, events = [], noRecording = false }) {
  const t0 = night.start
  const t1 = night.end
  const x = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R)
  const rows = []

  if (restless?.series?.length) {
    const start = restless.start
    const max = Math.max(0.2, ...restless.series)
    rows.push({
      key: 'move', label: 'Move',
      draw: (y) => restless.series.map((v, i) => {
        const t = start + i * 60000
        if (t < t0 || t > t1 || v <= 0) return null
        const h = Math.max(1, (v / max) * (ROW - 6))
        return <rect key={i} x={x(t)} y={y + ROW - 3 - h} width={Math.max(1, x(t + 60000) - x(t))} height={h} fill="var(--series-sleep)" opacity="0.8" />
      }),
      testid: 'strip-move',
    })
  }

  const sounds = (soundSessions || []).flatMap((s) => s.events || [])
  const gaps = (soundSessions || []).flatMap((s) => s.gaps || []).filter((g) => g.e > t0 && g.s < t1)
  if ((soundSessions || []).length) {
    rows.push({
      key: 'sound', label: 'Sound',
      draw: (y) => [
        // stretches with no audio (a call, Siri, an alarm) are shaded, so a quiet row is never mistaken for a silent room
        ...gaps.map((g, i) => (
          <rect key={`g${i}`} x={x(Math.max(g.s, t0))} y={y + 3} width={Math.max(1.5, x(Math.min(g.e, t1)) - x(Math.max(g.s, t0)))} height={ROW - 8} fill="var(--text-3)" opacity="0.25" data-testid="strip-gap"><title>No audio captured</title></rect>
        )),
        ...sounds.filter((e) => e.e > t0 && e.s < t1).map((e, i) => (
        e.label === 'snoring'
          ? <rect key={i} x={x(Math.max(e.s, t0))} y={y + 6} width={Math.max(1.5, x(Math.min(e.e, t1)) - x(Math.max(e.s, t0)))} height={ROW - 12} rx="1.5" fill="var(--text-2)" data-testid="strip-snore" />
          : <circle key={i} cx={x(e.s)} cy={y + ROW / 2} r="2.5" fill="none" stroke="var(--text-2)" strokeWidth="1.2"><title>{e.label === 'cough' ? 'Cough' : 'Talking'}</title></circle>
        )),
      ],
      testid: 'strip-sound',
    })
  }

  if (overnight?.hr?.length > 2) {
    const v = overnight.hr.map((p) => p[1])
    const lo = Math.min(...v) - 2
    const hi = Math.max(...v) + 2
    const pts = overnight.hr.map(([m, b]) => `${x(t0 + m * 60000).toFixed(1)},${(ROW - 2 - ((b - lo) / (hi - lo)) * (ROW - 4)).toFixed(1)}`).join(' ')
    rows.push({
      key: 'hr', label: `HR ${Math.round(Math.min(...v))}`,
      draw: (y) => <polyline points={pts} transform={`translate(0 ${y})`} fill="none" stroke="var(--text-2)" strokeWidth="1.2" strokeLinejoin="round" />,
      testid: 'strip-hr',
    })
  }

  if (overnight?.spo2?.length) {
    rows.push({
      key: 'spo2', label: 'SpO2',
      draw: (y) => overnight.spo2.map(([m, p], i) => (
        <circle key={i} cx={x(t0 + m * 60000)} cy={y + ROW / 2} r="2.5" fill={p < 90 ? 'var(--warn)' : 'var(--text-3)'}><title>{`${p}%`}</title></circle>
      )),
      testid: 'strip-spo2',
    })
  }

  if (overnight?.audio) {
    const a = overnight.audio
    const from = Math.max(t0, overnight.inBedStart ?? t0)
    rows.push({
      key: 'audio', label: 'Audio',
      draw: (y) => <rect x={x(from)} y={y + 7} width={Math.max(2, x(Math.min(a.stoppedAt, t1)) - x(from))} height={ROW - 14} rx="3" fill="var(--text-3)" opacity="0.7" />,
      testid: 'strip-audio',
    })
  }

  if (events.length) {
    rows.push({
      key: 'events', label: 'Events',
      draw: (y) => events.map((e, i) => (
        <path key={i} d={`M${x(e.t)} ${y + 4} l4 7 h-8 z`} fill={e.level === 'likely' ? 'var(--text)' : 'var(--text-3)'} data-testid="strip-event"><title>{e.label}</title></path>
      )),
      testid: 'strip-events',
    })
  }

  if (!rows.length && !noRecording) return null
  const H = rows.length * ROW + 4
  return (
    <div className="mt-3" data-testid="night-strips">
      {rows.length > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Movement, sounds, heart rate, blood oxygen and audio through the night">
          {rows.map((r, i) => (
            <g key={r.key} data-testid={r.testid}>
              <line x1={L} x2={W - R} y1={i * ROW + ROW - 1} y2={i * ROW + ROW - 1} stroke="var(--border)" strokeWidth="1" />
              <text x={L - 6} y={i * ROW + ROW / 2 + 3} fontSize="9" fontWeight="700" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{r.label}</text>
              {r.draw(i * ROW)}
            </g>
          ))}
        </svg>
      )}
      {noRecording && (
        <p className="text-[11px] font-medium" style={{ color: 'var(--text-3)' }} data-testid="strip-no-move">{NO_RECORDING_LINE}</p>
      )}
    </div>
  )
}
