import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { HeartPulse, Flame, Check, TrendingUp, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import { addDaysStr } from '../lib/schedule'
import {
  SYMPTOM_TAGS, TAG_BY_ID, INJECTION_SITES, SEVERITY, findPatterns,
} from '../lib/symptoms'

const SEV_COLOR = { mild: 'var(--amber)', moderate: 'var(--coral)', strong: 'var(--rose)' }

export default function SymptomsTab() {
  const symptomLogs = useStore((s) => s.symptomLogs)
  const peptides = useStore((s) => s.peptides)
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
    const tags = Object.entries(selected).map(([id, severity]) => ({
      id, severity, polarity: TAG_BY_ID[id].polarity, label: TAG_BY_ID[id].label,
    }))
    if (tags.length === 0) return
    logSymptomCheckin({ tags, note, site })
  }

  const negs = SYMPTOM_TAGS.filter((tg) => tg.polarity === 'neg')
  const pos = SYMPTOM_TAGS.filter((tg) => tg.polarity === 'pos')
  const patterns = useMemo(() => findPatterns(symptomLogs), [symptomLogs])
  const selectedCount = Object.keys(selected).length

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

      {/* check-in */}
      <div className="card p-4">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
          <HeartPulse size={15} style={{ color: 'var(--coral)' }} />
          {todayLog ? "Today's check-in" : 'Daily check-in'}
        </p>

        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--lime)' }}>Positives</p>
        <div className="flex flex-wrap gap-1.5">
          {pos.map((tg) => <Tag key={tg.id} tag={tg} sev={selected[tg.id]} onToggle={() => toggle(tg.id)} onSev={() => cycleSeverity(tg.id)} />)}
        </div>

        <p className="mb-1.5 mt-3 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--coral)' }}>Negatives</p>
        <div className="flex flex-wrap gap-1.5">
          {negs.map((tg) => <Tag key={tg.id} tag={tg} sev={selected[tg.id]} onToggle={() => toggle(tg.id)} onSev={() => cycleSeverity(tg.id)} />)}
        </div>

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
                    {TAG_BY_ID[tg.id]?.icon} {tg.label}{tg.polarity === 'neg' ? ` · ${tg.severity}` : ''}
                  </span>
                ))}
              </div>
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
