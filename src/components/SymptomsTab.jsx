import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { HeartPulse, Flame, Check, TrendingUp, X, Search, ChevronDown, Info } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import { addDaysStr } from '../lib/schedule'
import {
  SYMPTOM_TAGS, TAG_BY_ID, INJECTION_SITES, SEVERITY, findPatterns,
} from '../lib/symptoms'
import {
  stackSymptoms, stackSymptomIndex, attributeSymptom, symptomIcon, symptomLabel,
  ATTRIBUTION_CAVEAT, LIKELIHOOD_TONE, TIER_WORDS,
} from '../lib/attribution'
import Term from './ui/Term'
import CoachTip from './ui/CoachTip'

const SEV_COLOR = { mild: 'var(--amber)', moderate: 'var(--coral)', strong: 'var(--rose)' }

export default function SymptomsTab() {
  const symptomLogs = useStore((s) => s.symptomLogs)
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const doseLogs = useStore((s) => s.doseLogs)
  const gamification = useStore((s) => s.gamification)
  const logSymptomCheckin = useStore((s) => s.logSymptomCheckin)
  const t = todayStr()

  const todayLog = symptomLogs.find((l) => l.date === t)
  const [selected, setSelected] = useState(() => {
    const init = {}
    if (todayLog) for (const tg of todayLog.tags) init[tg.id] = tg.severity
    return init
  })
  const [note, setNote] = useState(todayLog?.note || '')
  const [site, setSite] = useState(todayLog?.site || null)

  // Only what the stack could plausibly cause. Showing the whole 66-symptom
  // catalogue to someone running five compounds buries the handful that apply.
  const stack = useMemo(() => stackSymptoms(peptides), [peptides])
  const stackIndex = useMemo(() => stackSymptomIndex(peptides), [peptides])
  const attributions = useMemo(() => {
    const ctx = { peptides, titration, doseLogs, todayStr: t }
    return Object.keys(selected)
      .filter((id) => stackIndex[id])
      .map((id) => attributeSymptom(id, ctx))
      .filter((a) => a.top)
  }, [selected, stackIndex, peptides, titration, doseLogs, t])

  const toggle = (id) => {
    setSelected((s) => {
      const next = { ...s }
      if (next[id]) delete next[id]
      else next[id] = 'moderate'
      return next
    })
  }
  const cycleSeverity = (id) => {
    setSelected((s) => {
      const cur = s[id]
      const i = SEVERITY.indexOf(cur)
      return { ...s, [id]: SEVERITY[(i + 1) % SEVERITY.length] }
    })
  }

  const submit = () => {
    // an id can come from the stack list or, on an older check-in being
    // updated, from the original fixed palette
    const tags = Object.entries(selected).map(([id, severity]) => {
      const meta = stackIndex[id] || TAG_BY_ID[id]
      return {
        id, severity,
        polarity: meta?.polarity || 'neg',
        label: meta?.label || symptomLabel(id),
      }
    })
    if (tags.length === 0) return
    logSymptomCheckin({ tags, note, site })
  }

  const patterns = useMemo(() => findPatterns(symptomLogs), [symptomLogs])
  const selectedCount = Object.keys(selected).length
  // ids on an existing check-in that predate the stack-relevant list
  const legacySelected = Object.keys(selected).filter((id) => !stackIndex[id] && TAG_BY_ID[id])

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Symptoms</h1>
          <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>How's the protocol treating you?</p>
        </div>
        <span className="chip !py-1.5 font-extrabold" style={{ color: 'var(--amber)' }}>
          <Flame size={13} /> {gamification.checkinStreak || 0} day check-in
        </span>
      </div>

      <CoachTip id="symptom-attribution" tone="violet">
        Tick anything you've noticed and the app names the compound in your stack most likely behind it —
        weighted towards whatever you <span className="font-black">started or stepped up recently</span>,
        because that's usually the thing that changed.
      </CoachTip>

      {/* check-in */}
      <div className="card p-4">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
          <HeartPulse size={15} style={{ color: 'var(--coral)' }} />
          {todayLog ? "Today's check-in" : 'Daily check-in'}
        </p>

        <p className="mb-2 text-[11px] font-semibold leading-relaxed" style={{ color: 'var(--muted)' }}>
          Only what your current stack is known for — good effects and issues both.
        </p>

        {stack.positive.length === 0 && stack.negative.length === 0 && (
          <p className="py-4 text-center text-xs font-semibold" style={{ color: 'var(--muted)' }}>
            Nothing in your stack has known effects on file yet. Add a compound from the list to see
            what to watch for.
          </p>
        )}

        {stack.positive.length > 0 && (
          <>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--lime)' }}>
              Good effects
            </p>
            <div className="flex flex-wrap gap-1.5">
              {stack.positive.map((tg) => (
                <Tag key={tg.id} tag={tg} sev={selected[tg.id]} onToggle={() => toggle(tg.id)} onSev={() => cycleSeverity(tg.id)} />
              ))}
            </div>
          </>
        )}

        {stack.negative.length > 0 && (
          <>
            <p className="mb-1.5 mt-3 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--coral)' }}>
              Issues
            </p>
            <div className="flex flex-wrap gap-1.5">
              {stack.negative.map((tg) => (
                <Tag key={tg.id} tag={tg} sev={selected[tg.id]} onToggle={() => toggle(tg.id)} onSev={() => cycleSeverity(tg.id)} />
              ))}
            </div>
          </>
        )}

        {/* anything already ticked from a check-in written before this list */}
        {legacySelected.length > 0 && (
          <>
            <p className="mb-1.5 mt-3 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Also on this check-in
            </p>
            <div className="flex flex-wrap gap-1.5">
              {legacySelected.map((id) => (
                <Tag key={id} tag={TAG_BY_ID[id]} sev={selected[id]} onToggle={() => toggle(id)} onSev={() => cycleSeverity(id)} />
              ))}
            </div>
          </>
        )}

        {/* injection site */}
        <p className="mb-1.5 mt-3 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Injection site (optional)</p>
        <div className="grid grid-cols-3 gap-1.5">
          {INJECTION_SITES.map((s) => (
            <button key={s.id} onClick={() => setSite(site === s.id ? null : s.id)}
              className="rounded-lg px-2 py-1.5 text-[11px] font-bold"
              style={site === s.id
                ? { backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff' }
                : { background: 'var(--surface2)', color: 'var(--muted)' }}>
              {s.label}
            </button>
          ))}
        </div>

        <textarea className="input mt-3" placeholder="Optional note…" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />

        <motion.button
          whileTap={{ scale: 0.97 }} onClick={submit} disabled={selectedCount === 0}
          className="btn-primary mt-3 w-full rounded-xl py-2.5 text-sm font-extrabold disabled:opacity-40"
        >
          {todayLog ? 'Update check-in' : `Log check-in${selectedCount ? ` · ${selectedCount} tag${selectedCount > 1 ? 's' : ''}` : ''}`}
        </motion.button>
        <p className="mt-1.5 text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
          Tip: tap a selected tag's dot to set severity (mild → moderate → strong).
        </p>
      </div>

      {/* what might be behind it */}
      <AnimatePresence>
        {attributions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="card space-y-3 p-4" data-testid="attribution-panel"
          >
            <p className="flex items-center gap-1.5 text-sm font-bold">
              <Search size={15} style={{ color: 'var(--violet)' }} /> What might be behind this?
            </p>
            {attributions.map((a) => <Attribution key={a.symptomId} result={a} />)}
            <p className="flex items-start gap-1.5 rounded-xl p-2.5 text-[10px] font-medium leading-relaxed"
              style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>
              <Info size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--amber)' }} />
              <span>{ATTRIBUTION_CAVEAT}</span>
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* timeline heatmap */}
      <Timeline logs={symptomLogs} peptides={peptides} today={t} />

      {/* patterns */}
      {patterns.length > 0 && (
        <div className="card p-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-bold"><TrendingUp size={15} style={{ color: 'var(--indigo)' }} /> Observations</p>
          <div className="space-y-1.5">
            {patterns.map((pat, i) => {
              const p = peptides.find((x) => x.id === pat.peptideId)
              const tg = TAG_BY_ID[pat.tagId]
              if (!p || !tg) return null
              return (
                <p key={i} className="text-xs font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
                  <span className="font-bold" style={{ color: 'var(--text)' }}>{tg.label}</span> logged {pat.count}× while <span className="font-bold" style={{ color: 'var(--text)' }}>{p.name}</span> was active.
                </p>
              )
            })}
          </div>
          <p className="mt-2 text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
            Observations from your own logs — associations, not medical conclusions.
          </p>
        </div>
      )}
    </div>
  )
}

// One symptom: the single most-likely compound headlined, everything else that
// could contribute listed underneath with its relative likelihood and how solid
// the evidence for that link actually is.
function Attribution({ result }) {
  const [open, setOpen] = useState(false)
  const { top, others } = result
  const pos = result.polarity === 'pos'

  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--surface2)' }}>
      <p className="text-[11px] font-bold" style={{ color: pos ? 'var(--lime)' : 'var(--coral)' }}>
        {result.icon} {result.label}
      </p>

      <div className="mt-1.5 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-black uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Most likely
          </p>
          <p className="truncate text-base font-black">{top.name}</p>
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
            {top.reasons.map((r) => (
              <span key={r} className="text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>· {r}</span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="rounded-full px-2 py-0.5 text-[10px] font-black"
            style={{ background: `color-mix(in srgb, ${LIKELIHOOD_TONE[top.likelihood]} 20%, transparent)`, color: LIKELIHOOD_TONE[top.likelihood] }}>
            {top.likelihood}
          </span>
          <TierChip tier={top.tier} />
        </div>
      </div>

      {others.length > 0 && (
        <>
          <button onClick={() => setOpen(!open)}
            className="mt-2 flex w-full items-center justify-between text-[11px] font-bold"
            style={{ color: 'var(--indigo)' }}>
            <span>{open ? 'Hide' : `${others.length} other${others.length === 1 ? '' : 's'} could contribute`}</span>
            <motion.span animate={{ rotate: open ? 180 : 0 }} style={{ display: 'inline-flex' }}>
              <ChevronDown size={14} />
            </motion.span>
          </button>
          {open && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-1.5 space-y-1.5">
              {others.map((c) => (
                <div key={c.peptideId} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold">{c.name}</span>
                    <span className="block text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
                      {c.reasons[0]}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="text-[10px] font-black" style={{ color: LIKELIHOOD_TONE[c.likelihood] }}>
                      {c.likelihood}
                    </span>
                    <TierChip tier={c.tier} />
                  </span>
                </div>
              ))}
            </motion.div>
          )}
        </>
      )}
    </div>
  )
}

// Evidence tier, tappable for what it actually means — T4 shouldn't read the
// same as T1 just because both are three characters.
function TierChip({ tier }) {
  const [open, setOpen] = useState(false)
  const strong = tier === 'T1' || tier === 'T2'
  return (
    <span className="relative inline-block">
      <button onClick={() => setOpen(!open)}
        aria-label={`What does evidence tier ${tier} mean?`}
        className="rounded px-1.5 py-0.5 text-[9px] font-black"
        style={{
          background: 'var(--surface-solid)',
          color: strong ? 'var(--lime)' : tier === 'T3' ? 'var(--amber)' : 'var(--muted)',
        }}>
        {tier}
      </button>
      {open && (
        <span role="tooltip" onClick={() => setOpen(false)}
          className="absolute right-0 top-full z-[60] mt-1 block w-44 rounded-xl p-2 text-right text-[10px] font-semibold leading-relaxed shadow-lg"
          style={{ background: 'var(--surface-solid)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
          <span className="block font-black" style={{ color: 'var(--text)' }}>{tier} · {TIER_WORDS[tier]}</span>
          How solid the link between this compound and this effect is — T1 is well established,
          T5 is one person's report.
        </span>
      )}
    </span>
  )
}

function Tag({ tag, sev, onToggle, onSev }) {
  const on = !!sev
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full py-1 pl-2 pr-1 text-xs font-bold"
      style={on
        ? { background: `color-mix(in srgb, ${tag.polarity === 'pos' ? 'var(--lime)' : SEV_COLOR[sev]} 22%, transparent)`, color: tag.polarity === 'pos' ? 'var(--lime)' : SEV_COLOR[sev] }
        : { background: 'var(--surface2)', color: 'var(--muted)' }}
    >
      <button onClick={onToggle} className="flex items-center gap-1">
        <span>{tag.icon}</span>{tag.label}
      </button>
      {on && (
        <button onClick={onSev} title="cycle severity"
          className="ml-0.5 rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase"
          style={{ background: 'var(--surface-solid)' }}>
          {tag.polarity === 'pos' ? '✓' : sev[0]}
        </button>
      )}
    </span>
  )
}

function Timeline({ logs, peptides, today }) {
  const [open, setOpen] = useState(null)
  const days = useMemo(() => {
    const out = []
    for (let i = 13; i >= 0; i--) {
      const date = addDaysStr(today, -i)
      const log = logs.find((l) => l.date === date)
      let tone = 'var(--surface2)', intensity = 0
      if (log) {
        const negs = log.tags.filter((t) => t.polarity === 'neg')
        if (negs.length === 0) { tone = 'var(--lime)'; intensity = 1 }
        else {
          const worst = negs.reduce((m, t) => Math.max(m, SEVERITY_RANK[t.severity] || 1), 0)
          tone = worst >= 3 ? 'var(--rose)' : worst === 2 ? 'var(--coral)' : 'var(--amber)'
          intensity = 0.5 + worst * 0.15
        }
      }
      out.push({ date, log, tone, intensity })
    }
    return out
  }, [logs, today])

  const openLog = open != null ? days[open] : null

  return (
    <div className="card p-4">
      <p className="mb-2 text-sm font-bold">Last 14 days</p>
      <div className="flex gap-1">
        {days.map((d, i) => (
          <button key={d.date} onClick={() => setOpen(open === i ? null : d.log ? i : null)}
            className="flex-1" title={format(parseISO(d.date), 'd MMM')}>
            <motion.div
              className="w-full rounded-md"
              initial={{ scaleY: 0.4, opacity: 0 }} animate={{ scaleY: 1, opacity: 1 }}
              transition={{ delay: i * 0.02 }}
              style={{ height: 34, background: d.tone, opacity: d.log ? d.intensity : 0.5, outline: open === i ? '2px solid var(--text)' : 'none' }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[9px] font-bold" style={{ color: 'var(--muted)' }}>
        <span>{format(parseISO(days[0].date), 'd MMM')}</span>
        <span>today</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-[9px] font-bold" style={{ color: 'var(--muted)' }}>
        <Legend color="var(--lime)" label="clear" />
        <Legend color="var(--amber)" label="mild" />
        <Legend color="var(--coral)" label="moderate" />
        <Legend color="var(--rose)" label="strong" />
      </div>

      <AnimatePresence>
        {openLog?.log && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 rounded-xl p-3" style={{ background: 'var(--surface2)' }}>
              <p className="text-xs font-bold">{format(parseISO(openLog.date), 'EEEE d MMM')}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {openLog.log.tags.map((tg) => (
                  <span key={tg.id} className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{ background: 'var(--surface-solid)', color: tg.polarity === 'pos' ? 'var(--lime)' : SEV_COLOR[tg.severity] }}>
                    {TAG_BY_ID[tg.id]?.icon || symptomIcon(tg.id)} {tg.label}{tg.polarity === 'neg' ? ` · ${tg.severity}` : ''}
                  </span>
                ))}
              </div>
              {/* what the suspects were on the day, not re-ranked against today's stack */}
              {openLog.log.tags.some((tg) => tg.attribution) && (
                <div className="mt-2 space-y-0.5">
                  {openLog.log.tags.filter((tg) => tg.attribution).map((tg) => (
                    <p key={tg.id} className="text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
                      {tg.label} → <span className="font-black" style={{ color: 'var(--text)' }}>{tg.attribution.top.name}</span>
                      {' '}({tg.attribution.top.likelihood} · {tg.attribution.top.tier})
                      {tg.attribution.others.length > 0 && ` +${tg.attribution.others.length} other${tg.attribution.others.length === 1 ? '' : 's'}`}
                    </p>
                  ))}
                  <p className="pt-0.5 text-[9px] font-medium italic" style={{ color: 'var(--muted)' }}>
                    Candidates recorded at the time — not a diagnosis.
                  </p>
                </div>
              )}
              {openLog.log.activePeptides?.length > 0 && (
                <p className="mt-2 text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
                  Active: {openLog.log.activePeptides.map((a) => `${a.name} (d${a.cycleDay})`).join(', ')}
                </p>
              )}
              {openLog.log.note && <p className="mt-1 text-[11px] font-medium italic" style={{ color: 'var(--muted)' }}>“{openLog.log.note}”</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const SEVERITY_RANK = { mild: 1, moderate: 2, strong: 3 }

function Legend({ color, label }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} /> {label}
    </span>
  )
}
