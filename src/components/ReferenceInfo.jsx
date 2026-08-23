import { motion } from 'framer-motion'
import { BadgeCheck, MessageCircle, ShieldAlert, Activity, Eye, FlaskConical } from 'lucide-react'
import { tierMeta, confidenceParts, confidenceTone, EVIDENCE_TIERS, FIELD_NOTES } from '../lib/reference'

// Evidence-tier badge + dose-confidence chip. Deliberately prominent: the whole
// point is that the weight behind each figure is visible.
export function TierBadge({ tier, confidence, compact }) {
  const t = tierMeta(tier)
  const { word } = confidenceParts(confidence)
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="rounded-[10px] px-2 py-1 text-xs font-black"
        style={{ background: `color-mix(in srgb, ${t.tone} 20%, transparent)`, color: t.tone }}
        title={EVIDENCE_TIERS[tier] || ''}>
        {t.label}
      </span>
      {!compact && (
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>
          {t.short}
        </span>
      )}
      {word && (
        <span className="rounded-[10px] px-2 py-1 text-xs font-bold"
          style={{ background: 'var(--surface-sunk)', color: confidenceTone(word) }}
          title="How much weight the dose figure deserves — not how well it works">
          dose conf: {word}
        </span>
      )}
    </span>
  )
}

function List({ items, color }) {
  return (
    <ul className="mt-1 space-y-1">
      {items.map((x, i) => (
        <li key={i} className="flex gap-2 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
          <span style={{ color }}>•</span><span>{x}</span>
        </li>
      ))}
    </ul>
  )
}

function Section({ icon: Icon, title, color, note, children }) {
  return (
    <div>
      <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide" style={{ color }}>
        <Icon size={12} /> {title}
      </p>
      {note && <p className="mt-1 text-xs font-medium italic" style={{ color: 'var(--text-2)' }}>{note}</p>}
      {children}
    </div>
  )
}

// Full reference block. `established` (evidence) and `reported` (community) are
// rendered as two visually distinct sections and are never merged.
export default function ReferenceInfo({ reference, excludedNote }) {
  if (!reference) return null
  const r = reference
  const { detail } = confidenceParts(r.confidence)
  const isTx = r.tier === 'TX'

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <TierBadge tier={r.tier} confidence={r.confidence} />
      </div>
      <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
        {EVIDENCE_TIERS[r.tier]}
      </p>
      {detail && (
        <p className="rounded-[10px] p-2 text-xs font-medium leading-relaxed"
          style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
          <span className="font-bold" style={{ color: 'var(--text)' }}>On the dose figure: </span>{detail}
        </p>
      )}

      {isTx && (
        <div className="rounded-[14px] p-3" style={{ background: 'color-mix(in srgb, var(--danger) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)' }}>
          <p className="flex items-center gap-2 text-xs font-black" style={{ color: 'var(--danger)' }}>
            <ShieldAlert size={14} /> Dosing deliberately not provided
          </p>
          <List items={r.safety} color="var(--danger)" />
          {excludedNote && <p className="mt-2 text-xs font-bold" style={{ color: 'var(--text)' }}>{excludedNote}</p>}
        </div>
      )}

      {r.mechanism && (
        <Section icon={FlaskConical} title="Mechanism" color="var(--info)">
          <p className="mt-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>{r.mechanism}</p>
        </Section>
      )}

      {r.humanData && (
        <Section icon={Activity} title="Human data" color="var(--text)">
          <p className="mt-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>{r.humanData}</p>
        </Section>
      )}

      {r.established?.length > 0 && (
        <div className="rounded-[14px] p-3" style={{ background: 'color-mix(in srgb, var(--good) 10%, transparent)' }}>
          <Section icon={BadgeCheck} title="Established (evidence)" color="var(--good)" note={FIELD_NOTES.established}>
            <List items={r.established} color="var(--good)" />
          </Section>
        </div>
      )}

      {r.reported?.length > 0 && (
        <div className="rounded-[14px] p-3" style={{ background: 'color-mix(in srgb, var(--warn) 10%, transparent)' }}>
          <Section icon={MessageCircle} title="Reported (community — not evidence)" color="var(--warn)" note={FIELD_NOTES.reported}>
            <List items={r.reported} color="var(--warn)" />
          </Section>
        </div>
      )}

      {!isTx && r.safety?.length > 0 && (
        <Section icon={ShieldAlert} title="Safety" color="var(--danger)">
          <List items={r.safety} color="var(--danger)" />
        </Section>
      )}

      {r.monitor?.length > 0 && (
        <Section icon={Eye} title="Monitor" color="var(--info)">
          <List items={r.monitor} color="var(--info)" />
        </Section>
      )}

      <p className="text-xs font-medium italic" style={{ color: 'var(--text-2)' }}>
        Starting reference only — everything above is editable and none of it is medical advice.
      </p>
    </motion.div>
  )
}
