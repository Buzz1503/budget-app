import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { MapPin, Check, Ban, Clock } from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import Modal from './ui/Modal'
import SiteChooser from './SiteChooser'
import { SITE_BY_ID, lastShot, zoneForGroup } from '../lib/sites'
import { loadMatrix, LIB_TO_COMPOUND } from '../lib/mixMatrix'
import { currentRung } from '../lib/schedule'
import { toMg, doseToUnits, concentration, formatDose, formatUnits } from '../lib/calc'

const SEVERITY = { MIX: 0, CAUTION: 1, DONT_MIX: 2, NEVER: 3 }

// Plain-English reason a pair can't share a syringe.
const BLOCK_REASON = {
  CAUTION: 'The chemistry model flags a possible conflict for this pair. Only confirmed-compatible pairs share a syringe here.',
  DONT_MIX: null, // the matrix note says it better
  NEVER: null,
}

// Co-draw = one shot into one site. Runs the Mix engine over every selected pair
// first: only a confirmed MIX may share a syringe. CAUTION, DONT_MIX, NEVER and
// "no data" all block, and the user is told to inject those separately.
export default function CoDrawModal({ open, onClose, peptides }) {
  const titration = useStore((s) => s.titration)
  const doseLogs = useStore((s) => s.doseLogs)
  const logCoDraw = useStore((s) => s.logCoDraw)
  const t = todayStr()

  // One thigh-only compound in the syringe makes the whole shot thigh-only —
  // they go in together, so the strictest rule wins.
  const zone = zoneForGroup(peptides || [])

  const [matrix, setMatrix] = useState(null)
  const [phase, setPhase] = useState('loading') // loading | blocked | site
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
    const problems = []
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
        // Only a confirmed MIX shares a syringe. No chemistry data (e.g. a
        // custom peptide) is not a pass — it lands on CAUTION and blocks.
        const verdict = pair?.verdict || 'CAUTION'
        const reason = BLOCK_REASON[verdict] || pair?.note || pair?.reason
          || 'No chemistry data for this pair, so it has not been confirmed compatible.'
        if (SEVERITY[verdict] > SEVERITY[worst]) worst = verdict
        if (verdict !== 'MIX') problems.push({ a: a.name, b: b.name, verdict, reason })
      }
    }
    return { worst, problems }
  }, [matrix, peptides])

  useEffect(() => {
    if (!review) return
    setPhase(review.problems.length ? 'blocked' : 'site')
  }, [review])

  const last = useMemo(() => lastShot(doseLogs, t), [doseLogs, t])
  const [resolved, setResolved] = useState(null)
  const chosen = picked || resolved
  const chosenSite = SITE_BY_ID[chosen]

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
              <Ban size={16} /> Not one shot — inject these separately
            </p>
            <div className="mt-2 space-y-2">
              {review.problems.map((p, i) => (
                <div key={i} className="text-xs">
                  <p className="font-bold">{p.a} + {p.b}{' '}
                    <span style={{ color: p.verdict === 'NEVER' ? 'var(--rose)' : p.verdict === 'CAUTION' ? 'var(--amber)' : 'var(--coral)' }}>
                      · {p.verdict === 'NEVER' ? 'never' : p.verdict === 'CAUTION' ? 'not confirmed' : "don't mix"}
                    </span>
                  </p>
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

        {phase === 'site' && (
          <>
            <p className="flex items-center justify-center gap-1.5 text-xs font-bold" style={{ color: 'var(--lime)' }}>
              <Check size={13} /> Every pair is a confirmed mix — one shot, one site
            </p>
            {last && (
              <p className="flex items-center gap-1.5 rounded-xl p-2.5 text-xs font-bold" style={{ background: 'var(--surface2)' }}>
                <Clock size={13} className="shrink-0" style={{ color: 'var(--muted)' }} />
                Last shot: {last.when} — {last.label}.
              </p>
            )}
            <p className="flex items-center gap-1.5 text-xs font-bold">
              <MapPin size={13} style={{ color: 'var(--lime)' }} /> One shot, so pick one spot
            </p>
            <SiteChooser route="SubQ" zone={zone} picked={picked} onPick={setPicked} onResolve={setResolved} />
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
