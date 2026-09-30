import { useMemo, useState } from 'react'
import { ChevronRight, Syringe } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { displayName } from '../../lib/naming'
import { ZONE_BY_ID } from '../../lib/reactionZones'
import { nextBestSite } from '../../lib/reactionSites'
import { checkinsDue } from '../../lib/reactionCheckins'
import { currentStep, STEP_TYPES } from '../../lib/investigation'
import { isDueToday } from '../../lib/daily'
import { dueWithPushes } from '../../lib/pushes'
import LogInjection from './LogInjection'
import CheckinStack from './CheckinStack'
import { SummaryLine } from './ReactionLab'

/**
 * Tonight, in one line per shot.
 *
 * The instruction is generated rather than remembered: the site comes from the
 * rules, the syringe rule from the step, and the temperature from whatever the
 * step is holding still. Somebody following this card is running the experiment
 * correctly without having to hold any of it in their head, which is the only
 * way an investigation survives contact with a Tuesday evening.
 */
export default function TonightCard({ goTo }) {
  const settings = useStore((s) => s.reactionSettings)
  const peptides = useStore((s) => s.peptides)
  const records = useStore((s) => s.injectionRecords)
  const reactions = useStore((s) => s.reactions)
  const checkins = useStore((s) => s.reactionCheckins)
  const steps = useStore((s) => s.investigationSteps)
  const pushes = useStore((s) => s.pushes)
  const doseLogs = useStore((s) => s.doseLogs)
  const t = todayStr()

  const [logFor, setLogFor] = useState(null)
  const [checkinOpen, setCheckinOpen] = useState(false)

  const step = currentStep(steps)
  const nowIso = new Date().toISOString()
  const due = useMemo(
    () => checkinsDue({ reactions, checkins, windows: settings?.windowTimes, nowIso }),
    [reactions, checkins, settings, nowIso]
  )

  const scheduled = useMemo(() => peptides.filter((p) => dueWithPushes(p, pushes, t)), [peptides, pushes, t])
  const loggedToday = useMemo(
    () => new Set(records.filter((r) => String(r.injectedAt).slice(0, 10) === t).map((r) => r.compoundIds?.[0])),
    [records, t]
  )

  // Worked out one after another, carrying the sites already spoken for: asking
  // each compound independently sends the whole evening to the same spot,
  // because they all see the same "least recently used" answer.
  const lines = useMemo(() => {
    const taken = []
    return scheduled
      .filter((p) => !loggedToday.has(p.id))
      .map((p) => {
      const site = nextBestSite(p.id, {
        records, reactions, todayStr: t,
        restDays: settings?.restDays ?? 3,
        sideAssignment: settings?.sideAssignment || {},
        excludeZones: taken,
      })
      if (site.zoneId) taken.push(site.zoneId)
      const parts = [displayName(p)]
      if (site.zoneId) parts.push(ZONE_BY_ID[site.zoneId]?.label.toLowerCase())
      // the step's own rules, said out loud rather than left to memory
      if (step?.lockedVars?.includes('sharedSyringe')) parts.push('own syringe')
      if (step?.lockedVars?.includes('technique')) parts.push('same technique as last time')
      if (step?.lockedVars?.includes('diluent')) parts.push('sterile water')
      parts.push('warm to room temp')
      return { peptide: p, site, text: parts.join(', ') }
      })
  }, [scheduled, loggedToday, records, reactions, t, settings, step])

  if (!settings?.enabled) return null
  if (!lines.length && !due.length) return null

  return (
    <div className="space-y-2" data-testid="tonight-card">
      {due.length > 0 && (
        <button onClick={() => setCheckinOpen(true)} data-testid="today-checkins-badge"
          className="flex w-full items-center justify-between gap-2 rounded-[14px] px-3 py-2.5 text-left"
          style={{ background: 'color-mix(in srgb, var(--danger) 16%, transparent)' }}>
          <span className="text-xs font-black" style={{ color: 'var(--danger)' }}>
            {due.length} site check-in{due.length === 1 ? '' : 's'} due
          </span>
          <ChevronRight size={15} style={{ color: 'var(--danger)' }} />
        </button>
      )}

      {lines.length > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-baseline justify-between gap-2 px-3 pb-1 pt-3">
            <p className="t-caption" style={{ color: 'var(--text-2)' }}>
              Tonight{step ? ` · ${STEP_TYPES[step.type]?.name.toLowerCase()}` : ''}
            </p>
          </div>
          <div className="rows">
            {lines.map(({ peptide, site, text }) => (
              <button key={peptide.id} onClick={() => setLogFor(peptide.id)} data-testid="tonight-line"
                data-compound={peptide.id}
                className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left">
                <Syringe size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--text-3)' }} />
                <span className="min-w-0 flex-1 text-xs font-bold leading-snug">
                  {text}
                  {!site.zoneId && (
                    <span className="block font-medium" style={{ color: 'var(--warn)' }}>
                      No site free — {site.reason}
                    </span>
                  )}
                </span>
                <ChevronRight size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--text-3)' }} />
              </button>
            ))}
          </div>
          <div className="px-3 pb-3 pt-1">
            <SummaryLine />
          </div>
        </div>
      )}

      <LogInjection open={!!logFor} peptideId={logFor} onClose={() => setLogFor(null)} />
      <CheckinStack open={checkinOpen} onClose={() => setCheckinOpen(false)} />
    </div>
  )
}
