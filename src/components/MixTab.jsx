import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, ShieldQuestion, Pin } from 'lucide-react'
import useStore from '../store/useStore'
import { mixVerdict, pairKey, FIXED_SEPARATE } from '../lib/mixing'

const RULES = [
  'Mixing = draw from separate reconstituted vials into ONE syringe right before injecting — never store two peptides in one vial.',
  'Match diluent (both in BAC water).',
  'SubQ-only mixes with SubQ.',
  'Keep any single injection site under ~1.5 mL.',
]

export default function MixTab() {
  const peptides = useStore((s) => s.peptides)
  const knownGood = useStore((s) => s.knownGoodMixes)
  const markKnownGood = useStore((s) => s.markKnownGood)
  const unmarkKnownGood = useStore((s) => s.unmarkKnownGood)
  const [a, setA] = useState(null)
  const [b, setB] = useState(null)

  const toggle = (id) => {
    if (a === id) return setA(null)
    if (b === id) return setB(null)
    if (!a) return setA(id)
    if (!b) return setB(id)
    setB(id) // replace second pick
  }

  const pa = peptides.find((p) => p.id === a)
  const pb = peptides.find((p) => p.id === b)
  const verdict = pa && pb ? mixVerdict(pa.name, pb.name, knownGood) : null
  const key = pa && pb ? pairKey(pa.name, pb.name) : null

  const styles = {
    green: { color: 'var(--lime)', bg: 'color-mix(in srgb, var(--lime) 14%, transparent)', Icon: Check },
    red: { color: 'var(--coral)', bg: 'color-mix(in srgb, var(--coral) 14%, transparent)', Icon: X },
    amber: { color: 'var(--amber)', bg: 'color-mix(in srgb, var(--amber) 14%, transparent)', Icon: ShieldQuestion },
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Will they mix?</h1>

      <div className="card p-4">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide" style={{ color: 'var(--indigo)' }}>
          <Pin size={12} /> Golden rules
        </p>
        <ul className="space-y-1.5 text-xs font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
          {RULES.map((r, i) => <li key={i}>• {r}</li>)}
        </ul>
      </div>

      <p className="text-xs font-bold" style={{ color: 'var(--muted)' }}>Tap two peptides:</p>
      <div className="grid grid-cols-3 gap-2">
        {peptides.map((p) => {
          const active = a === p.id || b === p.id
          const fixed = FIXED_SEPARATE.includes(p.name)
          return (
            <motion.button key={p.id} whileTap={{ scale: 0.93 }} onClick={() => toggle(p.id)}
              className="rounded-xl px-2 py-2.5 text-xs font-bold"
              style={active
                ? { backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff' }
                : { background: 'var(--surface2)', color: fixed ? 'var(--coral)' : 'var(--text)' }}>
              {p.name}
            </motion.button>
          )
        })}
      </div>

      <AnimatePresence mode="wait">
        {verdict && (
          <motion.div
            key={key + verdict.verdict}
            initial={{ opacity: 0, scale: 0.92, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="card p-5 text-center"
            style={{ background: styles[verdict.verdict].bg }}
          >
            <motion.div
              initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 350, damping: 14, delay: 0.08 }}
              className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full"
              style={{ background: styles[verdict.verdict].color, color: verdict.verdict === 'green' ? '#0c1200' : '#fff' }}
            >
              {(() => { const I = styles[verdict.verdict].Icon; return <I size={28} strokeWidth={3} /> })()}
            </motion.div>
            <p className="text-sm font-bold" style={{ color: 'var(--muted)' }}>{pa.name} + {pb.name}</p>
            <p className="text-xl font-extrabold" style={{ color: styles[verdict.verdict].color }}>{verdict.title}</p>
            <p className="mx-auto mt-1 max-w-xs text-xs font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>{verdict.reason}</p>
            {verdict.overridable && (
              <button className="btn-primary mt-3 rounded-xl px-4 py-2 text-xs font-extrabold" onClick={() => markKnownGood(key)}>
                I've verified this pair — mark known-good
              </button>
            )}
            {verdict.verdict === 'green' && knownGood.includes(key) && (
              <button className="mt-3 rounded-xl px-4 py-2 text-xs font-bold" style={{ background: 'var(--surface2)' }}
                onClick={() => unmarkKnownGood(key)}>
                Un-verify — back to separate
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="card p-4">
        <p className="mb-2 text-xs font-extrabold uppercase tracking-wide" style={{ color: 'var(--lime)' }}>Known-good co-draws</p>
        {knownGood.length === 0 && <p className="text-xs" style={{ color: 'var(--muted)' }}>None yet.</p>}
        <div className="flex flex-wrap gap-2">
          {knownGood.map((k) => (
            <span key={k} className="chip" style={{ color: 'var(--lime)' }}>
              <Check size={12} /> {k.replace('|', ' + ')}
            </span>
          ))}
        </div>
        <p className="mt-3 text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
          Always separate: {FIXED_SEPARATE.join(', ')}.
        </p>
      </div>
    </div>
  )
}
