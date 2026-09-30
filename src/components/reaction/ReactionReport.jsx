import { useEffect, useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import { prettyDate } from '../../lib/schedule'
import { ZONE_BY_ID } from '../../lib/reactionZones'
import { reactionScore, onsetLabel, rsWords, durationWords } from '../../lib/reactionScore'
import { STEP_TYPES } from '../../lib/investigation'
import { blobUrl } from '../../lib/blobStore'
import { useReactionAnalysis } from './SuspectBoard'

/**
 * One page to hand to a doctor.
 *
 * Written to be read by somebody with four minutes and no context: what was
 * taken, what was tried, what came of it, and how confident the answer is —
 * with the three worst reactions shown, because a photograph with a traced
 * outline and a millimetre figure says more in one glance than any amount of
 * this text.
 *
 * Deliberately two columns at most and no table wider than that, so it is
 * readable on the phone it was made on as well as on paper.
 */
export default function ReactionReport({ open, onClose }) {
  const a = useReactionAnalysis()
  const steps = useStore((s) => s.investigationSteps)
  const reactions = useStore((s) => s.reactions)
  const checkins = useStore((s) => s.reactionCheckins)
  const photos = useStore((s) => s.reactionPhotos)
  const records = useStore((s) => s.injectionRecords)
  const treatments = useStore((s) => s.reactionTreatments)
  const [urls, setUrls] = useState({})
  const t = todayStr()

  const worst = useMemo(() => reactions
    .map((rx) => ({ rx, rs: reactionScore(rx, checkins) }))
    .sort((x, y) => y.rs.score - x.rs.score)
    .slice(0, 3), [reactions, checkins])

  const shotFor = (rxId) => photos
    .filter((p) => p.reactionId === rxId)
    .sort((x, y) => (y.tracePaths?.redness?.length || 0) - (x.tracePaths?.redness?.length || 0))[0] || null

  useEffect(() => {
    let alive = true
    Promise.all(worst.map(async ({ rx }) => {
      const p = shotFor(rx.id)
      return [rx.id, p ? await blobUrl(p.blobKey) : null]
    })).then((pairs) => { if (alive) setUrls(Object.fromEntries(pairs)) })
    return () => { alive = false }
  }, [worst]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const compounds = [...new Set(records.flatMap((r) => [...(r.compoundIds || []), ...(r.componentIds || [])]))]
  const done = steps.filter((s) => s.status === 'done' && s.result)
  const onsets = [...new Set(reactions.map((rx) => onsetLabel(rx, checkins)?.label).filter(Boolean))]

  return (
    <Modal open onClose={onClose} wide title="Report">
      <div className="space-y-3">
        <button onClick={() => window.print()} data-testid="print-report"
          className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-3 text-xs font-black">
          <Printer size={14} /> Print or save as PDF
        </button>

        <div id="reaction-report" className="space-y-3 rounded-[14px] p-3" data-testid="report"
          style={{ background: 'var(--surface-sunk)' }}>
          <div>
            <p className="text-sm font-black">Injection site reactions</p>
            <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
              Prepared {prettyDate(t)} · {records.length} injections · {reactions.length} reactions recorded
            </p>
          </div>

          <Section title="Compounds involved">
            <p className="text-xs font-medium leading-relaxed">
              {compounds.map(a.nameOf).join(', ') || 'none recorded'}
            </p>
          </Section>

          <Section title="What was tried">
            {done.length === 0 && (
              <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
                No steps completed yet.
              </p>
            )}
            {done.map((s) => (
              <div key={s.id} className="flex items-baseline gap-2" data-testid="report-step">
                <span className="w-24 shrink-0 text-xs font-bold">{STEP_TYPES[s.type]?.name || s.type}</span>
                <span className="min-w-0 flex-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
                  {s.result}
                </span>
              </div>
            ))}
          </Section>

          <Section title="Where it points">
            <p className="text-xs font-bold" data-testid="report-verdict">{a.board.verdict}</p>
            <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
              {a.board.confidence.label} confidence — {a.board.confidence.words}.
            </p>
            {a.board.top && (
              <p className="mt-0.5 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
                {a.board.top.evidence}.
              </p>
            )}
          </Section>

          {onsets.length > 0 && (
            <Section title="Patterns seen">
              <p className="text-xs font-medium leading-relaxed">{onsets.join(', ')}</p>
            </Section>
          )}

          <Section title="The three worst">
            {worst.map(({ rx, rs }) => {
              const rec = records.find((r) => r.id === rx.injectionRecordId)
              const shot = shotFor(rx.id)
              const treated = treatments.some((x) => x.reactionId === rx.id)
              return (
                <div key={rx.id} className="space-y-1" data-testid="report-reaction">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 text-xs font-bold">
                      {ZONE_BY_ID[rec?.zoneId]?.short || 'site'} · {(rec?.compoundIds || []).map(a.nameOf).join(' + ') || 'control'}
                    </span>
                    <span className="shrink-0 text-xs font-black tabular-nums">{rs.score}</span>
                  </div>
                  <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
                    {prettyDate(String(rx.injectedAt).slice(0, 10))} · {rsWords(rs.score)}
                    {rs.durationHours != null ? ` · ${durationWords(rs.durationHours)}` : ''}
                    {treated ? ' · treated' : ''}
                  </p>
                  {urls[rx.id] && (
                    <div className="relative overflow-hidden rounded-[10px]">
                      <img src={urls[rx.id]} alt="" className="w-full" />
                      {shot?.tracePaths?.redness?.length > 2 && (
                        <svg className="absolute inset-0 h-full w-full"
                          viewBox={`0 0 ${shot.width || 100} ${shot.height || 100}`} preserveAspectRatio="none">
                          <polygon points={shot.tracePaths.redness.map((p) => `${p.x},${p.y}`).join(' ')}
                            fill="none" stroke="#e5484d" strokeWidth="3" />
                        </svg>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {worst.length === 0 && (
              <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
                No reactions recorded.
              </p>
            )}
          </Section>

          <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
            A personal record, not a medical assessment. Measurements are taken from photographs calibrated
            against a coin of known size.
          </p>
        </div>
      </div>
    </Modal>
  )
}

function Section({ title, children }) {
  return (
    <div className="space-y-1" data-testid="report-section">
      <p className="t-caption" style={{ color: 'var(--text-2)' }}>{title}</p>
      {children}
    </div>
  )
}
