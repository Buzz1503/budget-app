import { motion } from 'framer-motion'
import { SITES, SITE_BY_ID, siteStatus } from '../lib/sites'

// Front-view body map with recency-coloured injection sites.
const STATUS_COLOR = {
  fresh: 'var(--lime)',     // never used
  rested: 'var(--lime)',    // 5+ days
  warm: 'var(--amber)',     // 2–4 days
  blocked: 'var(--coral)',  // today / yesterday
}

export default function BodyMap({ doseLogs, today, selected, suggestion, onPick, compact }) {
  return (
    <div className="relative mx-auto w-full" style={{ maxWidth: compact ? 240 : 300 }}>
      <svg viewBox="0 0 100 112" className="w-full">
        {/* stylized front silhouette */}
        <g fill="var(--surface2)" stroke="var(--border)" strokeWidth="0.6">
          <circle cx="50" cy="9" r="7" />
          {/* torso */}
          <path d="M38 17 q12 -4 24 0 l3 10 q-3 3 -3 8 l-2 24 q-11 3 -22 0 l-2 -24 q0 -5 -3 -8 z" />
          {/* arms */}
          <path d="M38 18 q-8 3 -10 12 l-3 18 q3 1 5 0 l4 -16 q2 -8 5 -10 z" />
          <path d="M62 18 q8 3 10 12 l3 18 q-3 1 -5 0 l-4 -16 q-2 -8 -5 -10 z" />
          {/* legs */}
          <path d="M40 59 q10 3 20 0 l-1 20 -4 26 q-4 1 -6 0 l-2 -24 -2 24 q-3 1 -6 0 l-4 -26 z" />
        </g>

        {/* connective region hints */}
        {SITES.map((s) => {
          const st = siteStatus(s.id, doseLogs, today)
          const color = STATUS_COLOR[st.level]
          const isSel = selected === s.id
          const isSug = suggestion === s.id && !selected
          return (
            <g key={s.id} onClick={() => onPick?.(s.id)} style={{ cursor: onPick ? 'pointer' : 'default' }}>
              {isSug && (
                <motion.circle
                  cx={s.x} cy={s.y} r={4}
                  fill="none" stroke="var(--lime)" strokeWidth="0.8"
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                  animate={{ scale: [0.7, 1.6, 0.7], opacity: [0.9, 0.2, 0.9] }}
                  transition={{ duration: 1.6, repeat: Infinity }}
                />
              )}
              <motion.circle
                cx={s.x} cy={s.y} r={isSel ? 4 : 2.6}
                fill={color}
                stroke={isSel ? 'var(--text)' : 'transparent'} strokeWidth="1"
                style={{ transformBox: 'fill-box', transformOrigin: 'center', filter: isSel || isSug ? `drop-shadow(0 0 3px ${color})` : 'none' }}
                whileTap={{ scale: 0.8 }}
                animate={isSel ? { scale: [1, 1.3, 1] } : { scale: 1 }}
              />
            </g>
          )
        })}
      </svg>

      {/* legend */}
      {!compact && (
        <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[9px] font-bold" style={{ color: 'var(--muted)' }}>
          <Legend c="var(--lime)" l="rested / fresh" />
          <Legend c="var(--amber)" l="2–4d" />
          <Legend c="var(--coral)" l="just used" />
        </div>
      )}
    </div>
  )
}

function Legend({ c, l }) {
  return <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: c }} /> {l}</span>
}

export { SITE_BY_ID }
