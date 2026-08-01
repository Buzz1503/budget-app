import { motion } from 'framer-motion'
import { SITES, SITE_BY_ID, siteStatus, NAVEL, KEEP_CLEAR_R } from '../lib/sites'

// Front-view body map, drawn as if you're looking down at your own body, with
// the landmarks a first-timer actually navigates by: belly button, waistline,
// hip bones, knees. Spots are big numbered targets, and the shaded ring around
// the navel is the "don't inject here" zone.
const STATUS_COLOR = {
  fresh: 'var(--lime)',     // never used
  rested: 'var(--lime)',    // 5+ days
  warm: 'var(--amber)',     // 2–4 days
  blocked: 'var(--coral)',  // today / yesterday
}

const SKIN = 'var(--surface2)'
const LINE = 'var(--border)'

export default function BodyMap({
  doseLogs, today, selected, suggestion, onPick, compact,
  sites = SITES, view = '0 0 100 130', landmarks = true, zoom = false,
}) {
  // 3.4 is the largest radius that keeps all 16 whole-body targets from
  // touching; the zoomed view has room for proportionally bigger ones.
  const r = zoom ? 3.2 : 3.4
  const fs = zoom ? 3 : 3.2
  const labelFs = 2.9

  return (
    <div className="relative mx-auto w-full" style={{ maxWidth: compact ? 250 : 320 }}>
      <svg viewBox={view} className="w-full" role="img" aria-label="Injection site map">
        {/* ---- body ---- */}
        <g fill={SKIN} stroke={LINE} strokeWidth="0.7" strokeLinejoin="round">
          {/* head + neck */}
          <circle cx="50" cy="12" r="8" />
          <path d="M46.5 19 h7 v5.5 h-7 z" />
          {/* torso: shoulders → waist → hips */}
          <path d="M33 24 Q50 19 67 24 L70 35 Q67 40 66 47 L65 60.5 L66 75 Q50 79.5 34 75 L35 60.5 L34 47 Q33 40 30 35 Z" />
          {/* arms */}
          <path d="M33 24 q-8 4 -10.5 13.5 l-4 26 q3.2 1 6.5 0 l4.5 -24.5 q2 -10 6 -13.5 z" />
          <path d="M67 24 q8 4 10.5 13.5 l4 26 q-3.2 1 -6.5 0 l-4.5 -24.5 q-2 -10 -6 -13.5 z" />
          {/* legs, hip to ankle — drawn separately so each thigh is its own shape */}
          <path d="M34.5 74.5 L49 74.5 L48 100 L46.5 126 Q42 127.5 37.5 126 L36 100 Z" />
          <path d="M51 74.5 L65.5 74.5 L64 100 L62.5 126 Q58 127.5 53.5 126 L52 100 Z" />
        </g>

        {landmarks && (
          <g>
            {/* keep-clear zone: ~5 cm / 2 in around the navel */}
            <circle cx={NAVEL.x} cy={NAVEL.y} r={KEEP_CLEAR_R}
              fill="color-mix(in srgb, var(--coral) 18%, transparent)"
              stroke="var(--coral)" strokeWidth="0.55" strokeDasharray="1.6 1.4" />
            {/* the navel itself */}
            <circle cx={NAVEL.x} cy={NAVEL.y} r="1.8" fill="var(--text)" opacity="0.8" />
            <circle cx={NAVEL.x} cy={NAVEL.y} r="0.8" fill="var(--bg)" />

            {/* waistline */}
            <line x1="30" y1="60.5" x2="70" y2="60.5" stroke={LINE} strokeWidth="0.4" strokeDasharray="1.2 1.2" />
            {/* hip bones */}
            <path d="M35.5 70 l-4 -2.2" stroke={LINE} strokeWidth="0.7" strokeLinecap="round" />
            <path d="M64.5 70 l4 -2.2" stroke={LINE} strokeWidth="0.7" strokeLinecap="round" />
            {/* knee line */}
            <line x1="35" y1="107" x2="65" y2="107" stroke={LINE} strokeWidth="0.4" strokeDasharray="1.2 1.2" />

            {!zoom && (
              <g fontSize={labelFs} fontWeight="700" style={{ pointerEvents: 'none' }}>
                {/* belly button is labelled from BELOW: above the navel is where
                    the INJECT HERE flag lands whenever a belly spot is suggested */}
                <line x1="50" y1="63.2" x2="50" y2="70" stroke="var(--muted)" strokeWidth="0.35" />
                <text x="50" y="72.5" textAnchor="middle" fill="var(--text)">belly button</text>
                {/* the rest are leadered out past the arms, where there's clear space */}
                <line x1="70" y1="60.5" x2="82" y2="58.5" stroke="var(--muted)" strokeWidth="0.3" />
                <text x="83" y="59.5" fill="var(--muted)">waist</text>
                <line x1="68.5" y1="67.8" x2="82" y2="66" stroke="var(--muted)" strokeWidth="0.3" />
                <text x="83" y="67" fill="var(--muted)">hip bone</text>
                <line x1="65" y1="107" x2="75" y2="107" stroke="var(--muted)" strokeWidth="0.3" />
                <text x="76" y="108" fill="var(--muted)">knee</text>
              </g>
            )}
          </g>
        )}

        {/* ---- injection spots ---- */}
        {sites.map((s) => {
          const st = siteStatus(s.id, doseLogs, today)
          const color = STATUS_COLOR[st.level]
          const isSel = selected === s.id
          const isSug = suggestion === s.id && !selected
          return (
            <g key={s.id} onClick={() => onPick?.(s.id)}
              style={{ cursor: onPick ? 'pointer' : 'default' }}
              role={onPick ? 'button' : undefined}
              aria-label={`${s.label} — ${st.days == null ? 'never used' : `${st.days} days ago`}`}
            >
              {isSug && (
                <motion.circle
                  cx={s.x} cy={s.y} r={r + 2.4}
                  fill="none" stroke="var(--lime)" strokeWidth="1"
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                  animate={{ scale: [0.75, 1.55, 0.75], opacity: [1, 0.15, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              )}
              {/* generous invisible hit area — the printed dot is smaller than the tap target */}
              <circle cx={s.x} cy={s.y} r={r + 3} fill="transparent" />
              <motion.circle
                cx={s.x} cy={s.y} r={isSel ? r + 1.4 : r}
                fill={color}
                stroke={isSel || isSug ? 'var(--text)' : 'transparent'} strokeWidth={isSel ? 1 : 0.6}
                style={{
                  transformBox: 'fill-box', transformOrigin: 'center',
                  filter: isSel || isSug ? `drop-shadow(0 0 3px ${color})` : 'none',
                }}
                whileTap={{ scale: 0.85 }}
                animate={isSel ? { scale: [1, 1.25, 1] } : { scale: 1 }}
              />
              {s.n != null && (
                <text x={s.x} y={s.y + fs * 0.35} textAnchor="middle" fontSize={fs} fontWeight="900"
                  fill="#0c1200" style={{ pointerEvents: 'none' }}>{s.n}</text>
              )}
            </g>
          )
        })}

        {/* "INJECT HERE" flag on the recommended spot */}
        {suggestion && !selected && sites.some((s) => s.id === suggestion) && (
          <InjectHereFlag site={SITE_BY_ID[suggestion]} zoom={zoom} />
        )}
      </svg>

      {!compact && <ColourKey />}
    </div>
  )
}

function InjectHereFlag({ site, zoom }) {
  if (!site) return null
  const w = zoom ? 22 : 27
  const h = zoom ? 6 : 7.5
  const fs = zoom ? 3 : 3.8
  // sit the flag above the spot, or below it when that would leave the frame
  const above = site.y > 26
  const y = above ? site.y - (zoom ? 8 : 10) - h : site.y + (zoom ? 8 : 10)
  const x = Math.max(2, Math.min(100 - w - 2, site.x - w / 2))
  return (
    <motion.g
      style={{ pointerEvents: 'none', transformBox: 'fill-box', transformOrigin: 'center' }}
      animate={{ scale: [1, 1.06, 1] }}
      transition={{ duration: 1.5, repeat: Infinity }}
    >
      <rect x={x} y={y} width={w} height={h} rx={h / 2} fill="var(--lime)" />
      <text x={x + w / 2} y={y + h * 0.7} textAnchor="middle" fontSize={fs} fontWeight="900" fill="#0c1200">
        INJECT HERE
      </text>
      <path
        d={above
          ? `M${site.x} ${y + h} l-1.6 0 l1.6 2.4 l1.6 -2.4 z`
          : `M${site.x} ${y} l-1.6 0 l1.6 -2.4 l1.6 2.4 z`}
        fill="var(--lime)"
      />
    </motion.g>
  )
}

// The colours are spelled out rather than left to a bare legend.
function ColourKey() {
  return (
    <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] font-bold" style={{ color: 'var(--muted)' }}>
      <Key c="var(--lime)" l="Good to use — rested or never used" />
      <Key c="var(--amber)" l="Used 2–4 days ago — okay, but rest it if you can" />
      <Key c="var(--coral)" l="Used today or yesterday — skip this one" />
      <span className="mt-0.5 flex items-start gap-2">
        <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full"
          style={{ background: 'color-mix(in srgb, var(--coral) 25%, transparent)', border: '1.5px dashed var(--coral)' }} />
        <span>Shaded ring = keep clear. Stay at least 2 in / 5 cm from your belly button.</span>
      </span>
    </div>
  )
}

function Key({ c, l }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: c }} />
      <span>{l}</span>
    </span>
  )
}

export { SITE_BY_ID }
