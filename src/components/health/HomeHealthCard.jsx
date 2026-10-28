import { ChevronRight } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { useHealth } from '../../health/state'
import { useHealthLink } from '../../lib/healthLink'
import { rowFor } from '../../health/engine/model'
import useHealthModel from './useHealthModel'
import { ReadinessRing, minutesWords } from './atoms'
import { DeltaChip } from '../ui/Glance'
import { recoveryAnswer } from '../../lib/glance'
import { HEALTH_BANDS } from './bands'
import { saunaLastNight } from '../../sauna/sauna'

/**
 * One compact card at the bottom of Home: this morning's readiness, last
 *night's sleep, resting HR and HRV against usual.
 */
export default function HomeHealthCard({ goTo }) {
  const available = useHealth((s) => s.available)
  const connected = useStore((s) => s.healthSettings.connected)
  const setBodySegment = useHealthLink((s) => s.setBodySegment)
  const saunaSessions = useStore((s) => s.saunaSessions)
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
  const chip = r.chip || (saunaLastNight(saunaSessions, t) ? 'Sauna last night' : null)

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
          {r.status === 'ok' && <span className="mt-0.5 block text-sm font-medium" style={{ color: 'var(--text-2)' }} data-testid="home-health-answer">{recoveryAnswer({ hrv, rhr, sleep: rowFor(model, 'sleep', t) })}</span>}
        </span>
        <ChevronRight size={18} className="shrink-0" style={{ color: 'var(--text-3)' }} />
      </button>
      <div className="mt-3 grid grid-cols-3 gap-2" data-testid="home-health-stats">
        <MiniStat label="Sleep" value={night ? minutesWords(night.asleepMin) : '–'} />
        <MiniStat label="Resting HR" value={rhr.value != null ? Math.round(rhr.value) : '–'} unit="bpm"
          chip={rhr.delta != null ? <DeltaChip metric="rhr" delta={rhr.delta} /> : <span className="text-[13px]" style={{ color: 'var(--text-3)' }}>no usual yet</span>} />
        <MiniStat label="HRV" value={hrv.value != null ? Math.round(hrv.value) : '–'} unit="ms"
          chip={hrv.delta != null ? <DeltaChip metric="hrv" delta={hrv.delta} unit="ms" /> : <span className="text-[13px]" style={{ color: 'var(--text-3)' }}>no usual yet</span>} />
      </div>
      {chip && <p className="mt-2 truncate text-[13px] font-medium" style={{ color: 'var(--text-3)' }} data-testid="home-context-chip">{chip}</p>}
    </div>
  )
}

function MiniStat({ label, value, unit, chip }) {
  return (
    <div className="min-w-0 rounded-[10px] px-2.5 py-2" style={{ background: 'var(--surface-sunk)' }}>
      <p className="truncate text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className="whitespace-nowrap text-[17px] font-semibold tabular-nums">{value}{unit && <span className="ml-0.5 text-[12px] font-medium" style={{ color: 'var(--text-3)' }}>{unit}</span>}</p>
      {chip && <div className="mt-0.5">{chip}</div>}
    </div>
  )
}
