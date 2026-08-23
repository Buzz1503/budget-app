import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as Icons from 'lucide-react'
import {
  Search, ChevronDown, Info, Check, X, Sparkles, History as HistoryIcon,
  Plus, MessageSquare, MapPin,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import { addDaysStr } from '../lib/schedule'
import { TAG_BY_ID, INJECTION_SITES, SEVERITY, findPatterns } from '../lib/symptoms'
import {
  stackSymptoms, stackSymptomIndex, groupedSymptoms, searchSymptoms,
  likelyNow, recentlyLogged, attributeSymptom, symptomLabel, categoryOf,
  CATEGORY_BY_ID, ATTRIBUTION_CAVEAT, LIKELIHOOD_TONE, TIER_WORDS,
} from '../lib/attribution'
import CoachTip from './ui/CoachTip'

const SEV_COLOR = { mild: 'var(--amber)', moderate: 'var(--coral)', strong: 'var(--rose)' }
const SEV_SHORT = { mild: 'Mild', moderate: 'Moderate', strong: 'Strong' }

/**
 * Logging first, everything else second.
 *
 * The old screen put ~50 emoji chips in two alphabetical columns and hid
 * severity behind a tip nobody read. This one starts from "what am I looking
 * for": search, then the handful my protocol makes likely right now, then
 * categories you open only if you need them.
 */
export default function SymptomsTab() {
  const symptomLogs = useStore((s) => s.symptomLogs)
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const doseLogs = useStore((s) => s.doseLogs)
  const logSymptomCheckin = useStore((s) => s.logSymptomCheckin)
  const t = todayStr()

  const todayLog = symptomLogs.find((l) => l.date === t)
  const [selected, setSelected] = useState(() => {
    const init = {}
    if (todayLog) for (const tg of todayLog.tags) init[tg.id] = tg.severity
    return init
  })
  const [note, setNote] = useState(todayLog?.note || '')
  const [showNote, setShowNote] = useState(!!todayLog?.note)
  const [site, setSite] = useState(todayLog?.site || null)
  const [showSite, setShowSite] = useState(!!todayLog?.site)
  const [query, setQuery] = useState('')
  const [polarity, setPolarity] = useState('neg')
  const [openCats, setOpenCats] = useState(() => new Set())

  const ctx = useMemo(
    () => ({ peptides, titration, doseLogs, todayStr: t }),
    [peptides, titration, doseLogs, t]
  )
  const stackIndex = useMemo(() => stackSymptomIndex(peptides), [peptides])
  const stack = useMemo(() => stackSymptoms(peptides), [peptides])
  const groups = useMemo(() => groupedSymptoms(peptides, polarity), [peptides, polarity])
  const results = useMemo(() => searchSymptoms(peptides, query), [peptides, query])
  const likely = useMemo(() => likelyNow(ctx, { limit: 6, polarity }), [ctx, polarity])
  const recent = useMemo(
    () => recentlyLogged(symptomLogs, { limit: 6, exclude: new Set(likely.map((s) => s.id)) }),
    [symptomLogs, likely]
  )

  const selectedIds = Object.keys(selected)
  // Unattributed symptoms are kept, not filtered out: "nothing you're running is
  // a known cause of this" is a real answer, and hiding the row would look like
  // the app simply failed to consider it.
  const attributions = useMemo(() => selectedIds
    .filter((id) => stackIndex[id])
    .map((id) => attributeSymptom(id, ctx)), [selectedIds.join('|'), stackIndex, ctx]) // eslint-disable-line react-hooks/exhaustive-deps
  const attributed = attributions.filter((a) => a.top)
  const unattributed = attributions.filter((a) => !a.top)

  const toggle = (id) => setSelected((s) => {
    const next = { ...s }
    if (next[id]) delete next[id]
    else next[id] = 'moderate'
    return next
  })
  const setSeverity = (id, sev) => setSelected((s) => ({ ...s, [id]: sev }))
  const cycleSeverity = (id) => setSelected((s) => {
    const i = SEVERITY.indexOf(s[id])
    return { ...s, [id]: SEVERITY[(i + 1) % SEVERITY.length] }
  })

  // an injection-site reaction is the only thing the site picker is for
  const siteRelevant = selectedIds.some((id) => categoryOf(id) === 'injection_site')

  const submit = () => {
    const tags = selectedIds.map((id) => {
      const meta = stackIndex[id] || TAG_BY_ID[id]
      return {
        id, severity: selected[id],
        polarity: meta?.polarity || 'neg',
        label: meta?.label || symptomLabel(id),
      }
    })
    if (!tags.length) return
    logSymptomCheckin({ tags, note, site: siteRelevant ? site : null })
  }

  const legacySelected = selectedIds.filter((id) => !stackIndex[id] && TAG_BY_ID[id])
  const empty = stack.positive.length === 0 && stack.negative.length === 0

  return (
    <div className="space-y-2.5">
      <div>
        <h1 className="text-2xl font-black tracking-tight">How are you feeling?</h1>
        <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          {todayLog ? "Updating today's check-in" : 'Tap anything you’ve noticed today'}
        </p>
      </div>

      {/* search first */}
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
        <input className="input !pl-9" placeholder="Search symptoms…" value={query}
          aria-label="Search symptoms"
          onChange={(e) => setQuery(e.target.value)} />
        {query && (
          <button onClick={() => setQuery('')} aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1"
            style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>
            <X size={12} />
          </button>
        )}
      </div>

      {empty && (
        <p className="py-6 text-center text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          Nothing in my protocol has known effects on file yet. Add a compound to see what to watch for.
        </p>
      )}

      {/* search results replace the browse UI entirely while typing */}
      {query ? (
        <div data-testid="symptom-search-results">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            {results.length} match{results.length === 1 ? '' : 'es'}
          </p>
          {results.length === 0 ? (
            <p className="py-4 text-center text-xs font-semibold" style={{ color: 'var(--muted)' }}>
              Nothing in my protocol matches “{query}”.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {results.map((s) => (
                <Chip key={s.id} symptom={s} sev={selected[s.id]}
                  onToggle={() => toggle(s.id)} onSev={() => cycleSeverity(s.id)} />
              ))}
            </div>
          )}
        </div>
      ) : !empty && (
        <>
          {/* good / issues */}
          <div className="flex rounded-full p-1" style={{ background: 'var(--surface2)' }}>
            {[['neg', 'Issues'], ['pos', 'Good effects']].map(([id, label]) => (
              <button key={id} onClick={() => setPolarity(id)} aria-label={label}
                className="relative flex-1 rounded-full py-2 text-xs font-black">
                {polarity === id && (
                  <motion.span layoutId="sym-polarity-pill" className="absolute inset-0 rounded-full"
                    style={{
                      backgroundImage: id === 'neg'
                        ? 'linear-gradient(135deg, var(--coral), var(--rose))'
                        : 'linear-gradient(135deg, var(--lime), var(--lime-deep))',
                    }} />
                )}
                <span className="relative" style={{ color: polarity === id ? '#fff' : 'var(--muted)' }}>
                  {label}
                </span>
              </button>
            ))}
          </div>

          {/* the short list that matters right now */}
          {likely.length > 0 && (
            <div data-testid="likely-now">
              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--violet)' }}>
                <Sparkles size={12} /> Likely for you right now
              </p>
              <div className="flex flex-wrap gap-1.5">
                {likely.map((s) => (
                  <Chip key={s.id} symptom={s} sev={selected[s.id]}
                    onToggle={() => toggle(s.id)} onSev={() => cycleSeverity(s.id)} />
                ))}
              </div>
              <p className="mt-1 text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
                Weighted towards what you started or stepped up recently.
              </p>
            </div>
          )}

          {/* one tap to log the same thing again */}
          {recent.length > 0 && (
            <div data-testid="recently-logged">
              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                <HistoryIcon size={12} /> Recently logged
              </p>
              <div className="flex flex-wrap gap-1.5">
                {recent.map((s) => (
                  <Chip key={s.id} symptom={s} sev={selected[s.id]}
                    onToggle={() => toggle(s.id)} onSev={() => cycleSeverity(s.id)} />
                ))}
              </div>
            </div>
          )}

          {/* everything else, folded away */}
          <div className="space-y-1.5" data-testid="symptom-categories">
            {groups.map((g) => {
              const open = openCats.has(g.id)
              const chosen = g.symptoms.filter((s) => selected[s.id]).length
              const Icon = Icons[g.icon] || Icons.CircleDot
              return (
                <div key={g.id} className="rounded-2xl"
                  style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-sm)' }}>
                  <button
                    onClick={() => setOpenCats((s) => {
                      const next = new Set(s)
                      if (next.has(g.id)) next.delete(g.id); else next.add(g.id)
                      return next
                    })}
                    aria-label={`${g.label} category`}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 p-2.5 text-left">
                    <Icon size={14} style={{ color: 'var(--muted)' }} />
                    <span className="flex-1 text-xs font-black">{g.label}</span>
                    {chosen > 0 && (
                      <span className="rounded-full px-1.5 py-0.5 text-[10px] font-black"
                        style={{ background: 'var(--lime)', color: '#fff' }}>{chosen}</span>
                    )}
                    <span className="text-[10px] font-bold" style={{ color: 'var(--muted)' }}>{g.symptoms.length}</span>
                    <motion.span animate={{ rotate: open ? 180 : 0 }} style={{ display: 'inline-flex' }}>
                      <ChevronDown size={14} style={{ color: 'var(--muted)' }} />
                    </motion.span>
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden">
                        <div className="flex flex-wrap gap-1.5 p-2.5 pt-0">
                          {g.symptoms.map((s) => (
                            <Chip key={s.id} symptom={s} sev={selected[s.id]}
                              onToggle={() => toggle(s.id)} onSev={() => cycleSeverity(s.id)} />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>

          {legacySelected.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                Also on this check-in
              </p>
              <div className="flex flex-wrap gap-1.5">
                {legacySelected.map((id) => (
                  <Chip key={id} symptom={{ id, label: TAG_BY_ID[id]?.label || id, polarity: TAG_BY_ID[id]?.polarity }}
                    sev={selected[id]} onToggle={() => toggle(id)} onSev={() => cycleSeverity(id)} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* what's selected, with severity out in the open */}
      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-2" data-testid="selected-panel">
            <div className="h-px" style={{ background: 'var(--border)' }} />
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Logging {selectedIds.length}
            </p>
            {selectedIds.map((id) => {
              const meta = stackIndex[id] || TAG_BY_ID[id] || { label: symptomLabel(id), polarity: 'neg' }
              const pos = meta.polarity === 'pos'
              return (
                <div key={id} className="flex items-center gap-2 rounded-2xl p-2.5" style={{ background: 'var(--surface2)' }}>
                  <span className="min-w-0 flex-1 truncate text-xs font-black leading-tight"
                    style={{ color: pos ? 'var(--lime)' : 'var(--text)' }}>{meta.label}</span>
                  {pos ? (
                    <span className="text-[10px] font-bold" style={{ color: 'var(--lime)' }}>noted</span>
                  ) : (
                    <div className="flex shrink-0 rounded-lg p-0.5" style={{ background: 'var(--surface-solid)' }}>
                      {SEVERITY.map((sv) => (
                        <button key={sv} onClick={() => setSeverity(id, sv)}
                          aria-label={`${meta.label}: ${SEV_SHORT[sv]}`}
                          className="rounded-md px-2 py-1 text-[10px] font-black"
                          style={selected[id] === sv
                            ? { background: SEV_COLOR[sv], color: '#fff' }
                            : { color: 'var(--muted)' }}>
                          {SEV_SHORT[sv]}
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={() => toggle(id)} aria-label={`Remove ${meta.label}`}
                    className="shrink-0 rounded-full p-1" style={{ background: 'var(--surface-solid)', color: 'var(--muted)' }}>
                    <X size={12} />
                  </button>
                </div>
              )
            })}

            {/* only asked for when it could matter */}
            {siteRelevant && (
              <div>
                {showSite ? (
                  <div className="grid grid-cols-3 gap-1.5">
                    {INJECTION_SITES.map((s) => (
                      <button key={s.id} onClick={() => setSite(site === s.id ? null : s.id)}
                        className="rounded-full px-2 py-1.5 text-[11px] font-bold"
                        style={site === s.id
                          ? { backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff' }
                          : { background: 'var(--surface2)', color: 'var(--muted)' }}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button onClick={() => setShowSite(true)}
                    className="flex items-center gap-1 text-[11px] font-black" style={{ color: 'var(--indigo)' }}>
                    <MapPin size={12} /> Which site?
                  </button>
                )}
              </div>
            )}

            {showNote ? (
              <textarea className="input" placeholder="Anything worth remembering…" rows={2}
                aria-label="Check-in note" value={note} onChange={(e) => setNote(e.target.value)} />
            ) : (
              <button onClick={() => setShowNote(true)}
                className="flex items-center gap-1 text-[11px] font-black" style={{ color: 'var(--indigo)' }}>
                <MessageSquare size={12} /> Add note
              </button>
            )}

            <motion.button whileTap={{ scale: 0.97 }} onClick={submit}
              className="btn-primary w-full rounded-full py-3 text-sm font-black">
              {todayLog ? 'Update check-in' : `Log ${selectedIds.length}`}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* what might be behind it */}
      <AnimatePresence>
        {attributions.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-2.5" data-testid="attribution-panel">
            <div className="h-px" style={{ background: 'var(--border)' }} />
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--violet)' }}>
              <Search size={12} /> What might be behind this?
            </p>
            {attributed.map((a) => <Attribution key={a.symptomId} result={a} />)}

            {/* logged all the same — the app just has nothing to point at */}
            {unattributed.length > 0 && (
              <div className="card p-3" data-testid="unattributed-note">
                <p className="text-[11px] font-bold">
                  {unattributed.map((a) => a.label).join(' · ')}
                </p>
                <p className="mt-1 text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
                  Not a known effect of my current protocol — logged anyway. Plenty of things
                  outside this app cause symptoms, and a record of it is still worth having.
                </p>
              </div>
            )}

            {attributed.length > 0 && (
              <p className="flex items-start gap-1.5 text-[10px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
                <Info size={12} className="mt-0.5 shrink-0" style={{ color: 'var(--amber)' }} />
                <span>{ATTRIBUTION_CAVEAT}</span>
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <CoachTip id="symptom-attribution" tone="violet">
        Log anything you notice — the Issues list is the full catalogue, not just my protocol.
        Where something in my protocol is a known cause, the app names the most likely candidate,
        weighted towards whatever you started or stepped up recently.
      </CoachTip>
    </div>
  )
}

// A chip with no emoji: label, a selected state, and a severity dot you can see.
function Chip({ symptom, sev, onToggle, onSev }) {
  const on = !!sev
  const pos = symptom.polarity === 'pos'
  const tone = pos ? 'var(--lime)' : SEV_COLOR[sev] || 'var(--coral)'
  return (
    <span className="inline-flex items-center overflow-hidden rounded-full"
      style={on
        ? { background: `color-mix(in srgb, ${tone} 20%, transparent)`, boxShadow: `inset 0 0 0 1px ${tone}` }
        : { background: 'var(--surface2)' }}>
      <button onClick={onToggle}
        aria-label={`${on ? 'Remove' : 'Log'} ${symptom.label}`}
        className="py-1.5 pl-3 pr-2 text-xs font-bold"
        style={{ color: on ? tone : 'var(--muted)' }}>
        {symptom.label}
      </button>
      {on && !pos && (
        <button onClick={onSev} aria-label={`${symptom.label} severity: ${SEV_SHORT[sev]}`}
          className="py-1.5 pr-2.5 text-[9px] font-black uppercase tracking-wide"
          style={{ color: tone }}>
          {SEV_SHORT[sev]}
        </button>
      )}
      {on && pos && <Check size={12} className="mr-2.5" style={{ color: tone }} />}
    </span>
  )
}

function Attribution({ result }) {
  const [open, setOpen] = useState(false)
  const { top, others } = result
  return (
    <div className="rounded-2xl p-3" style={{ background: 'var(--surface2)' }}>
      <p className="text-[11px] font-bold" style={{ color: result.polarity === 'pos' ? 'var(--lime)' : 'var(--coral)' }}>
        {result.label}
      </p>
      <div className="mt-1 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-black uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Most likely</p>
          <p className="truncate text-base font-black leading-tight">{top.name}</p>
          <p className="text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>{top.reasons.join(' · ')}</p>
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
            className="mt-2 flex w-full items-center justify-between text-[11px] font-bold" style={{ color: 'var(--indigo)' }}>
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
                    <span className="block truncate text-xs font-bold leading-tight">{c.name}</span>
                    <span className="block text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>{c.reasons[0]}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="text-[10px] font-black" style={{ color: LIKELIHOOD_TONE[c.likelihood] }}>{c.likelihood}</span>
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

function TierChip({ tier }) {
  const [open, setOpen] = useState(false)
  const strong = tier === 'T1' || tier === 'T2'
  return (
    <span className="relative inline-block">
      <button onClick={() => setOpen(!open)} aria-label={`What does evidence tier ${tier} mean?`}
        className="rounded px-1.5 py-0.5 text-[9px] font-black"
        style={{ background: 'var(--surface-solid)', color: strong ? 'var(--lime)' : tier === 'T3' ? 'var(--amber)' : 'var(--muted)' }}>
        {tier}
      </button>
      {open && (
        <span role="tooltip" onClick={() => setOpen(false)}
          className="absolute right-0 top-full z-[60] mt-1 block w-44 rounded-2xl p-2 text-right text-[10px] font-semibold leading-relaxed shadow-lg"
          style={{ background: 'var(--surface-solid)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
          <span className="block font-black" style={{ color: 'var(--text)' }}>{tier} · {TIER_WORDS[tier]}</span>
          How solid the link between this compound and this effect is — T1 is well established,
          T5 is one person's report.
        </span>
      )}
    </span>
  )
}

// ---------- history (its own section, off the logging screen) ----------

const SEVERITY_RANK = { mild: 1, moderate: 2, strong: 3 }

/** The 14-day heatmap and the co-occurrence observations, for the History tab. */
export function SymptomHistory() {
  const symptomLogs = useStore((s) => s.symptomLogs)
  const peptides = useStore((s) => s.peptides)
  const t = todayStr()
  const [open, setOpen] = useState(null)

  const patterns = useMemo(() => findPatterns(symptomLogs), [symptomLogs])
  const days = useMemo(() => {
    const out = []
    for (let i = 13; i >= 0; i--) {
      const date = addDaysStr(t, -i)
      const log = symptomLogs.find((l) => l.date === date)
      let tone = 'var(--surface2)', intensity = 0
      if (log) {
        const negs = log.tags.filter((x) => x.polarity === 'neg')
        if (negs.length === 0) { tone = 'var(--lime)'; intensity = 1 }
        else {
          const worst = negs.reduce((m, x) => Math.max(m, SEVERITY_RANK[x.severity] || 1), 0)
          tone = worst >= 3 ? 'var(--rose)' : worst === 2 ? 'var(--coral)' : 'var(--amber)'
          intensity = 0.5 + worst * 0.15
        }
      }
      out.push({ date, log, tone, intensity })
    }
    return out
  }, [symptomLogs, t])

  const openLog = open != null ? days[open] : null
  if (symptomLogs.length === 0) return null

  return (
    <div className="space-y-2.5" data-testid="symptom-history">
      <div className="card p-3">
        <p className="mb-2 text-sm font-bold">Symptoms · last 14 days</p>
        <div className="flex gap-1">
          {days.map((d, i) => (
            <button key={d.date} onClick={() => setOpen(open === i ? null : d.log ? i : null)}
              className="flex-1" title={format(parseISO(d.date), 'd MMM')}>
              <motion.div className="w-full rounded-md"
                initial={{ scaleY: 0.4, opacity: 0 }} animate={{ scaleY: 1, opacity: 1 }}
                transition={{ delay: i * 0.02 }}
                style={{ height: 34, background: d.tone, opacity: d.log ? d.intensity : 0.5, outline: open === i ? '2px solid var(--text)' : 'none' }} />
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
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden">
              <div className="mt-3 rounded-2xl p-3" style={{ background: 'var(--surface2)' }}>
                <p className="text-xs font-bold">{format(parseISO(openLog.date), 'EEEE d MMM')}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {openLog.log.tags.map((tg) => (
                    <span key={tg.id} className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{ background: 'var(--surface-solid)', color: tg.polarity === 'pos' ? 'var(--lime)' : SEV_COLOR[tg.severity] }}>
                      {tg.label}{tg.polarity === 'neg' ? ` · ${tg.severity}` : ''}
                    </span>
                  ))}
                </div>
                {openLog.log.tags.some((tg) => tg.attribution) && (
                  <div className="mt-2 space-y-0.5">
                    {openLog.log.tags.filter((tg) => tg.attribution).map((tg) => (
                      <p key={tg.id} className="text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
                        {tg.label} → <span className="font-black" style={{ color: 'var(--text)' }}>{tg.attribution.top.name}</span>
                        {' '}({tg.attribution.top.likelihood} · {tg.attribution.top.tier})
                      </p>
                    ))}
                    <p className="pt-0.5 text-[9px] font-medium italic" style={{ color: 'var(--muted)' }}>
                      Candidates recorded at the time — not a diagnosis.
                    </p>
                  </div>
                )}
                {openLog.log.note && <p className="mt-1 text-[11px] font-medium italic" style={{ color: 'var(--muted)' }}>“{openLog.log.note}”</p>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {patterns.length > 0 && (
        <div className="card p-3">
          <p className="mb-2 text-sm font-bold">Observations</p>
          <div className="space-y-1.5">
            {patterns.map((pat, i) => {
              const p = peptides.find((x) => x.id === pat.peptideId)
              const label = symptomLabel(pat.tagId)
              if (!p) return null
              return (
                <p key={i} className="text-xs font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
                  <span className="font-bold" style={{ color: 'var(--text)' }}>{label}</span> logged {pat.count}× while{' '}
                  <span className="font-bold" style={{ color: 'var(--text)' }}>{p.name}</span> was active.
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

function Legend({ color, label }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} /> {label}
    </span>
  )
}
