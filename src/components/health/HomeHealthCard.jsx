import { ChevronRight } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { useHealth } from '../../health/state'
import { useHealthLink } from '../../lib/healthLink'
import { rowFor } from '../../health/engine/model'
import useHealthModel from './useHealthModel'
import { ReadinessRing, Delta, minutesWords } from './atoms'
import { HEALTH_BANDS } from './bands'

/**
 * One compact card at the bottom of Home: this morning's readiness, last
 *night's sleep, resting HR and HRV against usual.
 */
export default function HomeHealthCard({ goTo }) {
  const available = useHealth((s) => s.available)
  const connected = useStore((s) => s.healthSettings.connected)
  const setBodySegment = useHealthLink((s) => s.setBodySegment)
  const model = useHealthModel()
  const t = todayStr()
  if (!available) return null

  const openRecovery = () => { setBodySegment('recovery'); goTo?.('body') }

  if (!connected) {
    return (
      <button onClick={() => goTo?.('health')} className="card flex w-full items-center gap-3 p-4 text-left" data-testid="home-health-connect">
        <span className="min-w-0 flex-1">
          <span className="t-label block">Recovery from Apple Health</span>
          <span className="block text-xs font-medium" style={{ color: 'var(--text-3)' }}>Connect to see readiness, sleep and training next to your protocol.</span>
        </span>
        <ChevronRight size={18} style={{ color: 'var(--text-3)' }} />
      </button>
    )
  }

  const r = model.readiness(t)
  const night = model.nightBy.get(t)
  const rhr = rowFor(model, 'rhr', t)
  const hrv = rowFor(model, 'hrv', t)

  return (
    <div className="card p-4" data-testid="home-health-card">
      <button onClick={openRecovery} className="flex w-full items-center gap-3 text-left" data-testid="home-health-open">
        <ReadinessRing score={r.score} band={r.band} />
        <span className="min-w-0 flex-1">
          <span className="t-caption block" style={{ color: 'var(--text-3)' }}>Readiness</span>
          {r.status === 'ok' && (
            <span className="block text-base font-black" style={{ color: HEALTH_BANDS[r.band].tone }} data-testid="home-health-band">{r.bandLabel}</span>
          )}
          {r.status === 'building' && (
            <span className="block text-sm font-bold" data-testid="home-health-building">Building baseline: day {r.buildingDay} of 14</span>
          )}
          {r.status === 'insufficient' && (
            <span className="block text-sm font-bold" data-testid="home-health-insufficient">Not enough data from last night</span>
          )}
          <span className="mt-1 block text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
            Sleep {night ? minutesWords(night.asleepMin) : '–'}
          </span>
          <span className="block text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
            RHR {rhr.value != null ? Math.round(rhr.value) : '–'} · <Delta value={rhr.delta} dp={1} />
          </span>
          <span className="block text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
            HRV {hrv.value != null ? Math.round(hrv.value) : '–'} ms · <Delta value={hrv.delta} />
          </span>
        </span>
        <ChevronRight size={18} className="shrink-0" style={{ color: 'var(--text-3)' }} />
      </button>
      <button onClick={() => goTo?.('sleep')} className="mt-3 flex w-full items-center gap-2 border-t pt-3 text-left" style={{ borderColor: 'var(--border)' }} data-testid="home-sleep-open">
        <span className="min-w-0 flex-1 text-xs font-bold" style={{ color: 'var(--text-2)' }}>Last night, tonight's plan and sleep trends</span>
        <span className="text-xs font-bold" style={{ color: 'var(--text)' }}>Sleep</span>
        <ChevronRight size={16} className="shrink-0" style={{ color: 'var(--text-3)' }} />
      </button>
    </div>
  )
}
