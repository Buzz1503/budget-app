import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Check, X, ShieldAlert, Ban, FlaskConical, Search, Award, Eye, Pin, Beaker, Sparkles,
} from 'lucide-react'
import useStore from '../store/useStore'
import {
  loadMatrix, LIB_TO_COMPOUND, VERDICT_META, reasonFx, confidenceFor,
  compoundColor, key as pairKey, PROVEN_BLENDS,
} from '../lib/mixMatrix'
import { burstSmall } from '../lib/celebrate'
import ReactionChamber from './ReactionChamber'

const TONE_VAR = { lime: 'var(--lime)', amber: 'var(--amber)', coral: 'var(--coral)', rose: 'var(--rose)' }
const VERDICT_ICON = { Check, ShieldAlert, X, Ban }

export default function MixTab() {
  const peptides = useStore((s) => s.peptides)
  const mixExplored = useStore((s) => s.mixExplored)
  const exploreMixPair = useStore((s) => s.exploreMixPair)
  const haptics = useStore((s) => s.settings.haptics)

  const [matrix, setMatrix] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [browseAll, setBrowseAll] = useState(false)
  const [query, setQuery] = useState('')
  const [a, setA] = useState(null)
  const [b, setB] = useState(null)
  const [playKey, setPlayKey] = useState('')
  const [inspected, setInspected] = useState(false)

  // Lazy-load the matrix only when this tab mounts.
  useEffect(() => {
    let alive = true
    loadMatrix().then((m) => alive && setMatrix(m)).catch(() => alive && setLoadError(true))
    return () => { alive = false }
  }, [])

  // Compounds that are never co-drawn with a peptide — oil-based injectables and
  // anything else on a different vehicle/route. They have no matrix entry by
  // design, so they're surfaced here as their own cards whose verdict is fixed.
  const separateCompounds = useMemo(() => peptides.filter((p) => p.alwaysSeparate).map((p) => ({
    id: p.id,
    name: p.name,
    class: p.vehicle === 'oil' ? 'OIL' : 'SEPARATE',
    charge: 'non-aqueous',
    flags: [p.vehicle === 'oil' ? 'oil vehicle' : 'always separate', p.route === 'IM' ? 'IM' : null].filter(Boolean),
    alwaysSeparate: true,
    separateReason: p.separateReason
      || `${p.name} is not a peptide and isn't in the compatibility matrix — draw and inject it on its own.`,
  })), [peptides])

  const separateIds = useMemo(() => new Set(separateCompounds.map((c) => c.id)), [separateCompounds])

  // Protocol compounds present in the matrix.
  const matrixStack = useMemo(() => {
    if (!matrix) return []
    return peptides
      .filter((p) => !p.alwaysSeparate)
      .map((p) => matrix.byId.get(LIB_TO_COMPOUND[p.id] || p.id))
      .filter(Boolean)
  }, [matrix, peptides])

  const stackCompounds = useMemo(
    () => [...matrixStack, ...separateCompounds],
    [matrixStack, separateCompounds]
  )

  // Codex progress counts real chemistry pairs only — a fixed "separate" verdict
  // isn't a discovery.
  const stackIds = useMemo(() => new Set(matrixStack.map((c) => c.id)), [matrixStack])

  const compoundById = (id) =>
    (matrix ? matrix.byId.get(id) : null) || separateCompounds.find((c) => c.id === id) || null

  // Compatibility Codex: how many of my protocol's pairs have been revealed.
  const stackPairKeys = useMemo(() => {
    const ids = [...stackIds]
    const keys = []
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) keys.push(pairKey(ids[i], ids[j]))
    return keys
  }, [stackIds])
  const mappedCount = stackPairKeys.filter((k) => mixExplored.includes(k)).length

  const list = useMemo(() => {
    if (!matrix) return []
    const base = browseAll ? [...separateCompounds, ...matrix.compounds] : stackCompounds
    if (!query.trim()) return base
    const q = query.toLowerCase()
    return base.filter((c) => c.name.toLowerCase().includes(q) || c.class.toLowerCase().includes(q))
  }, [matrix, browseAll, stackCompounds, separateCompounds, query])

  const ca = a && matrix ? compoundById(a) : null
  const cb = b && matrix ? compoundById(b) : null
  // One always-separate side settles it before the matrix is consulted at all.
  const forcedSeparate = ca && cb && (ca.alwaysSeparate || cb.alwaysSeparate)
    ? (ca.alwaysSeparate ? ca : cb)
    : null
  const pair = ca && cb && !forcedSeparate ? matrix.lookup(ca.id, cb.id) : null

  const select = (id) => {
    setInspected(false)
    if (a === id) return setA(null)
    if (b === id) return setB(null)
    if (!a) return setA(id)
    if (!b) { finish(a, id); return setB(id) }
    // both filled → start a new pair from this pick
    setA(id); setB(null)
  }

  const finish = (idA, idB) => {
    const k = pairKey(idA, idB)
    setPlayKey(`${k}-${Date.now()}`)
    if (haptics && navigator.vibrate) { try { navigator.vibrate(15) } catch { /* ignore */ } }
    const m = matrix
    const found = m?.lookup(idA, idB)
    if (found?.verdict === 'MIX') burstSmall(0.5, 0.45)
    // codex discovery (only for protocol pairs, to keep the count meaningful)
    if (stackIds.has(idA) && stackIds.has(idB)) exploreMixPair(k)
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-black">Mix Lab</h1>
        <div className="card p-6 text-center text-sm font-medium" style={{ color: 'var(--muted)' }}>
          Couldn't load the chemistry database. Reopen the tab to retry.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Mix Lab</h1>
        <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          Reaction chamber · {matrix ? matrix.compounds.length : 86} compounds · single-syringe chemistry only
        </p>
      </div>

      {/* standing honesty reminder */}
      <div className="card flex items-start gap-2 p-3" style={{ background: 'color-mix(in srgb, var(--indigo) 12%, var(--surface))' }}>
        <Pin size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--indigo)' }} />
        <p className="text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
          A <span className="font-bold" style={{ color: 'var(--lime)' }}>“safe to mix”</span> result means no chemical conflict was found — <span className="font-bold" style={{ color: 'var(--text)' }}>not proof of compatibility</span>. Always inspect the drawn solution before injecting.
        </p>
      </div>

      {/* Codex progress */}
      <div className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-bold">
            <Beaker size={15} style={{ color: 'var(--violet)' }} /> Compatibility Codex
          </p>
          <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--muted)' }}>
            {mappedCount}/{stackPairKeys.length} pairs
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full" style={{ background: 'var(--surface2)' }}>
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundImage: 'linear-gradient(90deg, var(--violet), var(--indigo))' }}
            initial={false}
            animate={{ width: `${stackPairKeys.length ? (mappedCount / stackPairKeys.length) * 100 : 0}%` }}
            transition={{ type: 'spring', stiffness: 60, damping: 15 }}
          />
        </div>
        <p className="mt-1.5 text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
          Tap two compounds to run a reaction and map their pair. +8 XP per new discovery.
        </p>
      </div>

      {/* picker header */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
          <input
            className="input !pl-9" placeholder={browseAll ? 'Search all 86 compounds…' : 'Search my protocol…'}
            value={query} onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          onClick={() => { setBrowseAll(!browseAll); setQuery('') }}
          className="shrink-0 rounded-xl px-3 py-2 text-xs font-bold"
          style={browseAll
            ? { backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff' }
            : { background: 'var(--surface2)', color: 'var(--text)' }}
        >
          {browseAll ? 'All 86' : 'My protocol'}
        </button>
      </div>

      {/* selected slots */}
      <div className="grid grid-cols-2 gap-2">
        <Slot compound={ca} label="Compound A" onClear={() => { setA(null); setInspected(false) }} />
        <Slot compound={cb} label="Compound B" onClear={() => { setB(null); setInspected(false) }} />
      </div>

      {/* chemistry card grid */}
      {!matrix ? (
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card h-20 animate-pulse" style={{ opacity: 0.4 }} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {list.map((c) => (
            <CompoundCard
              key={c.id} compound={c}
              selected={a === c.id || b === c.id}
              inStack={stackIds.has(c.id) || separateIds.has(c.id)}
              proven={[...PROVEN_BLENDS].some((k) => k.split('|').includes(c.id))}
              onSelect={() => select(c.id)}
            />
          ))}
          {list.length === 0 && (
            <p className="col-span-2 py-6 text-center text-sm font-medium" style={{ color: 'var(--muted)' }}>No compounds match “{query}”.</p>
          )}
        </div>
      )}

      {/* result */}
      <AnimatePresence mode="wait">
        {ca && cb && (
          <VerdictPanel
            key={playKey || `${ca.id}-${cb.id}`}
            ca={ca} cb={cb} pair={pair} playKey={playKey || `${ca.id}-${cb.id}`}
            reasonCodes={matrix.reasonCodes} classes={matrix.classes}
            forcedSeparate={forcedSeparate}
            inspected={inspected} setInspected={setInspected}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function Slot({ compound, label, onClear }) {
  return (
    <button
      onClick={compound ? onClear : undefined}
      className="card flex items-center gap-2 p-3 text-left"
      style={{ minHeight: 56, borderStyle: compound ? 'solid' : 'dashed' }}
    >
      {compound ? (
        <>
          <span className="h-6 w-6 shrink-0 rounded-full" style={{ background: compoundColor(compound), boxShadow: `0 0 12px ${compoundColor(compound)}` }} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">{compound.name}</span>
            <span className="block text-[10px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>{compound.class} · tap to clear</span>
          </span>
        </>
      ) : (
        <span className="text-xs font-bold" style={{ color: 'var(--muted)' }}>{label}</span>
      )}
    </button>
  )
}

function CompoundCard({ compound, selected, inStack, proven, onSelect }) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={onSelect}
      className="card relative overflow-hidden p-3 text-left"
      style={selected
        ? { borderColor: compoundColor(compound), boxShadow: `0 0 0 1.5px ${compoundColor(compound)}, var(--shadow)` }
        : undefined}
    >
      <div className="flex items-center gap-2">
        <span className="h-5 w-5 shrink-0 rounded-full" style={{ background: compoundColor(compound) }} />
        <span className="min-w-0 flex-1 truncate text-sm font-bold leading-tight">{compound.name}</span>
        {proven && <Award size={13} className="shrink-0" style={{ color: '#f5c451' }} />}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>{compound.class}</span>
        <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'var(--surface2)', color: chargeColor(compound.charge) }}>{compound.charge}</span>
        {(compound.flags || []).slice(0, 1).map((f) => (
          <span key={f} className="rounded-md px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>{f}</span>
        ))}
      </div>
      {inStack && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full" style={{ background: 'var(--lime)' }} title="in my protocol" />}
    </motion.button>
  )
}

function chargeColor(charge) {
  if (charge === 'cationic') return 'var(--amber)'
  if (charge === 'anionic') return 'var(--indigo)'
  return 'var(--muted)'
}

function VerdictPanel({ ca, cb, pair, playKey, reasonCodes, classes, forcedSeparate, inspected, setInspected }) {
  // A different vehicle/route is not a chemistry question — there is no verdict
  // to compute and no override to offer.
  if (forcedSeparate) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 280, damping: 24 }}
        className="card overflow-hidden p-5"
        style={{ background: 'color-mix(in srgb, var(--rose) 10%, var(--surface))' }}
      >
        <div className="text-center">
          <p className="text-sm font-bold" style={{ color: 'var(--muted)' }}>{ca.name} + {cb.name}</p>
          <div className="mt-1 flex items-center justify-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: 'var(--rose)', color: '#fff' }}>
              <Ban size={18} strokeWidth={3} />
            </span>
            <span className="text-xl font-black" style={{ color: 'var(--rose)' }}>Inject separately</span>
          </div>
          <span className="chip mt-2 !py-1 font-bold" style={{ color: 'var(--rose)' }}>Always separate</span>
        </div>
        <p className="mx-auto mt-3 max-w-sm text-center text-xs font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
          {forcedSeparate.separateReason}
        </p>
        <p className="mx-auto mt-2 max-w-sm text-center text-[11px] font-bold" style={{ color: 'var(--text)' }}>
          Two shots, two syringes — never draw it into the same barrel as a peptide.
        </p>
      </motion.div>
    )
  }

  if (!pair) {
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="card p-5 text-center">
        <p className="text-sm font-bold">No data for this pair</p>
        <p className="mt-1 text-xs font-medium" style={{ color: 'var(--muted)' }}>{ca.name} + {cb.name} isn't in the matrix.</p>
      </motion.div>
    )
  }
  const meta = VERDICT_META[pair.verdict]
  const tone = TONE_VAR[meta.tone]
  const Icon = VERDICT_ICON[meta.icon] || Check
  const fx = reasonFx(pair.reason_code)
  const conf = confidenceFor(ca.id, cb.id)
  const gateRequired = pair.verdict === 'CAUTION'

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 280, damping: 24 }}
      className="card overflow-hidden p-5"
      style={{ background: `color-mix(in srgb, ${tone} 10%, var(--surface))` }}
    >
      <ReactionChamber
        verdict={pair.verdict} reasonCode={pair.reason_code}
        colorA={compoundColor(ca)} colorB={compoundColor(cb)} playKey={playKey}
      />

      <div className="mt-3 text-center">
        <p className="text-sm font-bold" style={{ color: 'var(--muted)' }}>{ca.name} + {cb.name}</p>
        <div className="mt-1 flex items-center justify-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: tone, color: '#0c1200' }}>
            <Icon size={18} strokeWidth={3} />
          </span>
          <span className="text-xl font-black" style={{ color: tone }}>{meta.label}</span>
        </div>

        {/* confidence + reason code chips */}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
          {conf.level === 'proven' ? (
            <span className="chip !py-1 font-bold" style={{ background: 'color-mix(in srgb, #f5c451 22%, transparent)', color: '#f5c451' }}>
              <Award size={12} /> Proven blend
            </span>
          ) : (
            <span className="chip !py-1 font-bold" style={{ color: 'var(--muted)' }}>
              <FlaskConical size={12} /> Chemistry model
            </span>
          )}
          <span className="chip !py-1 font-bold" style={{ color: tone }}>{pair.reason_code}</span>
        </div>
      </div>

      {/* plain-English note */}
      <p className="mx-auto mt-3 max-w-sm text-center text-xs font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
        {pair.note || pair.reason}
      </p>
      {fx.teach && (
        <p className="mx-auto mt-1.5 max-w-sm text-center text-[11px] font-semibold" style={{ color: tone }}>
          <Sparkles size={11} className="mr-1 inline" />{fx.teach}
        </p>
      )}

      {/* mandatory visual-inspection gate */}
      {gateRequired && (
        <div className="mt-4 rounded-2xl p-3" style={{ background: 'color-mix(in srgb, var(--amber) 16%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 40%, transparent)' }}>
          <p className="flex items-center gap-1.5 text-xs font-extrabold" style={{ color: 'var(--amber)' }}>
            <Eye size={14} /> Visual inspection required
          </p>
          {!inspected ? (
            <>
              <p className="mt-1 text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
                Inspect the drawn solution — <span className="font-bold" style={{ color: 'var(--text)' }}>hazy, stringy, discoloured or particulate means discard.</span> Only inject if it's clear.
              </p>
              <button
                onClick={() => setInspected(true)}
                className="mt-2 w-full rounded-xl py-2 text-xs font-extrabold"
                style={{ background: 'var(--amber)', color: '#1a1200' }}
              >
                Confirm it's clear
              </button>
            </>
          ) : (
            <p className="mt-1 flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--lime)' }}>
              <Check size={14} /> Confirmed clear — safe to draw. Discard immediately if it changes.
            </p>
          )}
        </div>
      )}

      <p className="mt-3 text-center text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
        {reasonCodes[pair.reason_code]?.slice(0, 120)}
      </p>
    </motion.div>
  )
}
