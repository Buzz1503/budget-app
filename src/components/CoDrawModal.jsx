import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { MapPin, Check, ShieldAlert, Ban, Eye, AlertTriangle } from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import Modal from './ui/Modal'
import BodyMap from './BodyMap'
import { suggestSite, SITE_BY_ID, daysSince } from '../lib/sites'
import { loadMatrix, LIB_TO_COMPOUND } from '../lib/mixMatrix'
import { currentRung } from '../lib/schedule'
import { toMg, doseToUnits, concentration, formatDose, formatUnits } from '../lib/calc'

const SEVERITY = { MIX: 0, CAUTION: 1, DONT_MIX: 2, NEVER: 3 }

// Co-draw = one shot into one site. Runs the Mix engine over every selected pair
// first: DONT_MIX/NEVER blocks, CAUTION gates on visual inspection, then one site.
export default function CoDrawModal({ open, onClose, peptides }) {
  const titration = useStore((s) => s.titration)
  const doseLogs = useStore((s) => s.doseLogs)
  const logCoDraw = useStore((s) => s.logCoDraw)
  const t = todayStr()

  const [matrix, setMatrix] = useState(null)
  const [phase, setPhase] = useState('loading') // loading | blocked | inspect | site
  const [picked, setPicked] = useState(null)

  useEffect(() => {
    if (!open) return
    setPhase('loading'); setPicked(null)
    let alive = true
    loadMatrix().then((m) => alive && setMatrix(m)).catch(() => alive && setMatrix(false))
    return () => { alive = false }
  }, [open, peptides])

  // evaluate all pairs once the matrix is ready
  const review = useMemo(() => {
    if (!matrix || !peptides?.length) return null
    const problems = [], cautions = []
    let worst = 'MIX'
    // Always-separate compounds (oil-based, different route) never reach the
    // chemistry matrix — they're excluded from co-draws before any pair is
    // considered, whatever they're paired with.
    for (const p of peptides) {
      if (!p.alwaysSeparate) continue
      worst = 'NEVER'
      for (const other of peptides) {
        if (other.id === p.id) continue
        problems.push({
          a: p.name, b: other.name, verdict: 'NEVER',
          reason: p.separateReason
            || `${p.name} is not a peptide and isn't in the compatibility matrix — draw and inject it on its own.`,
        })
      }
    }
    for (let i = 0; i < peptides.length; i++) {
      for (let j = i + 1; j < peptides.length; j++) {
        const a = peptides[i], b = peptides[j]
        const ca = LIB_TO_COMPOUND[a.id] || a.id
        const cb = LIB_TO_COMPOUND[b.id] || b.id
        const pair = matrix.lookup(ca, cb)
        // No chemistry data (e.g. a custom peptide) is NOT a pass — fall back to
        // caution so it still goes through the visual-inspection gate.
        const verdict = pair?.verdict || 'CAUTION'
        const reason = pair?.note || pair?.reason
          || 'No chemistry data for this pair — treat as unverified and inspect the drawn solution carefully.'
        if (SEVERITY[verdict] > SEVERITY[worst]) worst = verdict
        if (verdict === 'DONT_MIX' || verdict === 'NEVER') problems.push({ a: a.name, b: b.name, verdict, reason })
        else if (verdict === 'CAUTION') cautions.push({ a: a.name, b: b.name, reason })
      }
    }
    return { worst, problems, cautions }
  }, [matrix, peptides])

  useEffect(() => {
    if (!review) return
    if (review.problems.length) setPhase('blocked')
    else if (review.cautions.length) setPhase('inspect')
    else setPhase('site')
  }, [review])

  const suggestion = useMemo(() => suggestSite(doseLogs, t), [doseLogs, t])
  const chosen = picked || suggestion
  const chosenSite = SITE_BY_ID[chosen]
  const rested = daysSince(chosen, doseLogs, t)

  const confirm = () => {
    logCoDraw(peptides.map((p) => p.id), chosen)
    onClose()
  }

  const lines = (peptides || []).map((p) => {
    const { dose } = currentRung(p, titration[p.id])
    const units = doseToUnits(toMg(dose, p.ladder.unit), concentration(p.recon.vialMg, p.recon.bacMl))
    return { name: p.name, dose, unit: p.ladder.unit, units }
  })

  return (
    <Modal open={open} onClose={onClose} title={`Log together · ${peptides?.length || 0}`}>
      <div className="space-y-3">
        {/* combined draw summary */}
        <div className="rounded-xl p-3" style={{ background: 'var(--surface2)' }}>
          {lines.map((l) => (
            <div key={l.name} className="flex items-center justify-between py-0.5 text-sm">
              <span className="font-bold">{l.name}</span>
              <span className="font-semibold" style={{ color: 'var(--muted)' }}>
                {formatDose(l.dose, l.unit)} · <span style={{ color: 'var(--lime)' }}>{formatUnits(l.units)}</span>
              </span>
            </div>
          ))}
        </div>

        {phase === 'loading' && (
          <p className="py-6 text-center text-sm font-semibold" style={{ color: 'var(--muted)' }}>Checking compatibility…</p>
        )}

        {phase === 'blocked' && review && (
          <div className="rounded-2xl p-4" style={{ background: 'color-mix(in srgb, var(--coral) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--coral) 40%, transparent)' }}>
            <p className="flex items-center gap-1.5 text-sm font-extrabold" style={{ color: 'var(--coral)' }}>
              <Ban size={16} /> Don't co-draw these
            </p>
            <div className="mt-2 space-y-2">
              {review.problems.map((p, i) => (
                <div key={i} className="text-xs">
                  <p className="font-bold">{p.a} + {p.b} <span style={{ color: p.verdict === 'NEVER' ? 'var(--rose)' : 'var(--coral)' }}>· {p.verdict === 'NEVER' ? 'never' : "don't mix"}</span></p>
                  <p className="font-medium" style={{ color: 'var(--muted)' }}>{p.reason}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs font-semibold" style={{ color: 'var(--text)' }}>
              Inject these as separate shots instead — close this and log them one at a time.
            </p>
            <button onClick={onClose} className="btn-primary mt-3 w-full rounded-xl py-2.5 text-sm font-black">
              Got it — log separately
            </button>
          </div>
        )}

        {phase === 'inspect' && review && (
          <div className="rounded-2xl p-4" style={{ background: 'color-mix(in srgb, var(--amber) 16%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 40%, transparent)' }}>
            <p className="flex items-center gap-1.5 text-sm font-extrabold" style={{ color: 'var(--amber)' }}>
              <ShieldAlert size={16} /> Mix with caution
            </p>
            <div className="mt-1.5 space-y-1">
              {review.cautions.map((c, i) => (
                <p key={i} className="text-[11px] font-medium" style={{ color: 'var(--muted)' }}>
                  <span className="font-bold" style={{ color: 'var(--text)' }}>{c.a} + {c.b}:</span> {c.reason}
                </p>
              ))}
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold" style={{ color: 'var(--text)' }}>
              <Eye size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--amber)' }} />
              Draw them, then inspect — hazy, stringy, discoloured or particulate means discard. Only inject if it's clear.
            </p>
            <button onClick={() => setPhase('site')} className="mt-3 w-full rounded-xl py-2.5 text-sm font-black" style={{ background: 'var(--amber)', color: '#1a1200' }}>
              Confirm it's clear — continue
            </button>
          </div>
        )}

        {phase === 'site' && (
          <>
            {review?.cautions.length ? null : (
              <p className="flex items-center justify-center gap-1.5 text-xs font-bold" style={{ color: 'var(--lime)' }}>
                <Check size={13} /> All pairs compatible — one shot, one site
              </p>
            )}
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-xs font-bold">
                <MapPin size={13} style={{ color: 'var(--lime)' }} /> Pick one injection site for the co-draw
              </p>
              <BodyMap doseLogs={doseLogs} today={t} selected={picked} suggestion={suggestion} onPick={setPicked} />
            </div>
            <div className="rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--lime) 12%, transparent)' }}>
              <p className="text-xs font-bold" style={{ color: picked ? 'var(--text)' : 'var(--lime)' }}>
                {picked ? 'Selected: ' : 'Suggested: '}{chosenSite?.label}
                {rested == null ? ' — never used, fully rested' : ` — ${rested}d rested`}
              </p>
            </div>
            <motion.button whileTap={{ scale: 0.97 }} onClick={confirm}
              className="btn-primary flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-black">
              <Check size={18} strokeWidth={3} /> Log {peptides.length} together — {chosenSite?.label}
            </motion.button>
          </>
        )}
      </div>
    </Modal>
  )
}
