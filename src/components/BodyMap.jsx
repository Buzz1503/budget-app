import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { SITES, SITE_BY_ID, NAVEL, KEEP_CLEAR_R } from '../lib/sites'
import { SITE_STATUS } from '../lib/rotation'

// Front and back body maps, drawn as if you're looking down at your own body —
// left on the picture is your left, on both views, so a site never swaps sides
// when you flip. Landmarks a first-timer navigates by: belly button, waistline,
// hip bones, knees; spine and glute crease on the back.
//
// A site's colour is its *heat*: 1 the moment it's used, easing to 0 across its
// rest days. That's a continuous value, so the map visibly heals between opens
// rather than snapping between three bands.

const SKIN = 'var(--surface2)'
const LINE = 'var(--border)'

// heat 1 → coral, 0.5 → amber, 0 → lime. Colour-mix keeps it theme-aware.
export function heatColor(heat) {
  if (heat <= 0) return 'var(--lime)'
  if (heat >= 1) return 'var(--coral)'
  if (heat > 0.5) {
    const t = Math.round((heat - 0.5) * 200)
    return `color-mix(in srgb, var(--coral) ${t}%, var(--amber))`
  }
  const t = Math.round(heat * 200)
  return `color-mix(in srgb, var(--amber) ${t}%, var(--lime))`
}

export function statusColor(state) {
  if (!state) return 'var(--lime)'
  if (state.resting) return SITE_STATUS.resting.tone
  if (state.overworn) return SITE_STATUS.overworn.tone
  return heatColor(state.heat)
}

export default function BodyMap({
  states = {}, selected, suggestion, onPick, compact,
  sites = SITES, view = '0 0 100 130', landmarks = true, zoom = false,
  face = 'front', pinAt = null, dimUnselected = true,
}) {
  const r = zoom ? 3.2 : 3.4
  const fs = zoom ? 3 : 3.2
  const labelFs = 2.9

  return (
    <div className="relative mx-auto w-full" style={{ maxWidth: compact ? 250 : 320 }}>
      <svg viewBox={view} className="w-full" role="img"
        aria-label={`Injection site map — ${face} view`}>
        <defs>
          {/* soft heat halo, reused by every hot site */}
          <radialGradient id="siteGlow">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.55" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>

        {face === 'back' ? <BackBody landmarks={landmarks} zoom={zoom} labelFs={labelFs} />
          : <FrontBody landmarks={landmarks} zoom={zoom} labelFs={labelFs} />}

        {/* ---- injection spots ---- */}
        {sites.map((s) => {
          const st = states[s.id]
          const color = statusColor(st)
          const heat = st?.heat ?? 0
          const isSel = selected === s.id
          const isSug = suggestion === s.id && !selected
          const parked = !!(st && !st.usable)
          // Unselected, uninteresting spots recede so the recommendation reads
          // instantly. They stay tappable and keep their number — receding is
          // about volume, not about hiding the map from a beginner.
          const quiet = dimUnselected && !isSel && !isSug && !parked && heat === 0
          return (
            <g key={s.id} onClick={() => onPick?.(s.id)}
              style={{ cursor: onPick ? 'pointer' : 'default', color }}
              role={onPick ? 'button' : undefined}
              data-site={s.id}
              aria-label={`${s.label} — ${st ? SITE_STATUS[st.status].words : 'unknown'}`}
            >
              {/* healing halo — fades away exactly as the site cools */}
              {heat > 0.02 && (
                <motion.circle
                  cx={s.x} cy={s.y} r={r + 6} fill="url(#siteGlow)"
                  initial={false}
                  animate={{ opacity: 0.25 + heat * 0.75, scale: 0.8 + heat * 0.35 }}
                  transition={{ duration: 0.6 }}
                  style={{ transformBox: 'fill-box', transformOrigin: 'center', pointerEvents: 'none' }}
                />
              )}

              {isSug && (
                <motion.circle
                  cx={s.x} cy={s.y} r={r + 2.4}
                  fill="none" stroke="var(--lime)" strokeWidth="1"
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                  animate={{ scale: [0.75, 1.55, 0.75], opacity: [1, 0.15, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              )}

              {/* generous invisible hit area */}
              <circle cx={s.x} cy={s.y} r={r + 3} fill="transparent" />

              <motion.circle
                cx={s.x} cy={s.y}
                fill={color}
                stroke={isSel || isSug ? 'var(--text)' : 'transparent'}
                strokeWidth={isSel ? 1 : 0.6}
                strokeDasharray={parked ? '1.2 1' : undefined}
                initial={false}
                animate={{
                  r: isSel ? r + 1.4 : quiet ? r - 0.5 : r,
                  opacity: quiet ? 0.45 : 1,
                }}
                transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                style={{
                  transformBox: 'fill-box', transformOrigin: 'center',
                  filter: isSel || isSug ? `drop-shadow(0 0 3px ${color})` : 'none',
                }}
                whileTap={{ scale: 0.85 }}
              />

              {/* a parked site gets a slash, so "don't use this" survives greyscale */}
              {parked && (
                <line x1={s.x - r * 0.8} y1={s.y + r * 0.8} x2={s.x + r * 0.8} y2={s.y - r * 0.8}
                  stroke="var(--bg)" strokeWidth="0.9" strokeLinecap="round" style={{ pointerEvents: 'none' }} />
              )}

              {s.n != null && !parked && (
                <text x={s.x} y={s.y + fs * 0.35} textAnchor="middle" fontSize={fs} fontWeight="900"
                  fill="#0c1200" opacity={quiet ? 0.55 : 1} style={{ pointerEvents: 'none' }}>{s.n}</text>
              )}
            </g>
          )
        })}

        {/* pin-drop ripple on the spot just chosen */}
        <AnimatePresence>
          {pinAt && sites.some((s) => s.id === pinAt.id) && (
            <PinDrop key={pinAt.nonce} site={SITE_BY_ID[pinAt.id]} />
          )}
        </AnimatePresence>

        {suggestion && !selected && sites.some((s) => s.id === suggestion) && (
          <InjectHereFlag site={SITE_BY_ID[suggestion]} zoom={zoom} />
        )}
      </svg>
    </div>
  )
}

// ---- bodies ----

function FrontBody({ landmarks, zoom, labelFs }) {
  return (
    <>
      <g fill={SKIN} stroke={LINE} strokeWidth="0.7" strokeLinejoin="round">
        <circle cx="50" cy="12" r="8" />
        <path d="M46.5 19 h7 v5.5 h-7 z" />
        <path d="M33 24 Q50 19 67 24 L70 35 Q67 40 66 47 L65 60.5 L66 75 Q50 79.5 34 75 L35 60.5 L34 47 Q33 40 30 35 Z" />
        <path d="M33 24 q-8 4 -10.5 13.5 l-4 26 q3.2 1 6.5 0 l4.5 -24.5 q2 -10 6 -13.5 z" />
        <path d="M67 24 q8 4 10.5 13.5 l4 26 q-3.2 1 -6.5 0 l-4.5 -24.5 q-2 -10 -6 -13.5 z" />
        <path d="M34.5 74.5 L49 74.5 L48 100 L46.5 126 Q42 127.5 37.5 126 L36 100 Z" />
        <path d="M51 74.5 L65.5 74.5 L64 100 L62.5 126 Q58 127.5 53.5 126 L52 100 Z" />
      </g>

      {landmarks && (
        <g>
          <circle cx={NAVEL.x} cy={NAVEL.y} r={KEEP_CLEAR_R}
            fill="color-mix(in srgb, var(--coral) 18%, transparent)"
            stroke="var(--coral)" strokeWidth="0.55" strokeDasharray="1.6 1.4" />
          <circle cx={NAVEL.x} cy={NAVEL.y} r="1.8" fill="var(--text)" opacity="0.8" />
          <circle cx={NAVEL.x} cy={NAVEL.y} r="0.8" fill="var(--bg)" />
          <line x1="30" y1="60.5" x2="70" y2="60.5" stroke={LINE} strokeWidth="0.4" strokeDasharray="1.2 1.2" />
          <path d="M35.5 70 l-4 -2.2" stroke={LINE} strokeWidth="0.7" strokeLinecap="round" />
          <path d="M64.5 70 l4 -2.2" stroke={LINE} strokeWidth="0.7" strokeLinecap="round" />
          <line x1="35" y1="107" x2="65" y2="107" stroke={LINE} strokeWidth="0.4" strokeDasharray="1.2 1.2" />

          {!zoom && (
            <g fontSize={labelFs} fontWeight="700" style={{ pointerEvents: 'none' }}>
              <line x1="50" y1="63.2" x2="50" y2="70" stroke="var(--muted)" strokeWidth="0.35" />
              <text x="50" y="72.5" textAnchor="middle" fill="var(--text)">belly button</text>
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
    </>
  )
}

// Back view: same silhouette turned around, with the landmarks that orient you
// from behind — spine, shoulder blades, the crease under each buttock.
function BackBody({ landmarks, zoom, labelFs }) {
  return (
    <>
      <g fill={SKIN} stroke={LINE} strokeWidth="0.7" strokeLinejoin="round">
        <circle cx="50" cy="12" r="8" />
        <path d="M46.5 19 h7 v5.5 h-7 z" />
        <path d="M33 24 Q50 19 67 24 L70 35 Q67 40 66 47 L65 58 L67 78 Q50 84 33 78 L35 58 L34 47 Q33 40 30 35 Z" />
        <path d="M33 24 q-8 4 -10.5 13.5 l-4 26 q3.2 1 6.5 0 l4.5 -24.5 q2 -10 6 -13.5 z" />
        <path d="M67 24 q8 4 10.5 13.5 l4 26 q-3.2 1 -6.5 0 l-4.5 -24.5 q-2 -10 -6 -13.5 z" />
        <path d="M34 77 L49 77 L48 100 L46.5 126 Q42 127.5 37.5 126 L36 100 Z" />
        <path d="M51 77 L66 77 L64 100 L62.5 126 Q58 127.5 53.5 126 L52 100 Z" />
      </g>

      {landmarks && (
        <g>
          {/* spine */}
          <line x1="50" y1="26" x2="50" y2="62" stroke={LINE} strokeWidth="0.5" strokeDasharray="1.4 1.2" />
          {/* shoulder blades */}
          <path d="M40 32 q-3 5 -1 10" fill="none" stroke={LINE} strokeWidth="0.5" />
          <path d="M60 32 q3 5 1 10" fill="none" stroke={LINE} strokeWidth="0.5" />
          {/* glute split + crease under each cheek */}
          <line x1="50" y1="62" x2="50" y2="78" stroke={LINE} strokeWidth="0.5" />
          <path d="M35 77 q7 3.5 14 0" fill="none" stroke={LINE} strokeWidth="0.55" />
          <path d="M51 77 q7 3.5 14 0" fill="none" stroke={LINE} strokeWidth="0.55" />

          {!zoom && (
            <g fontSize={labelFs} fontWeight="700" style={{ pointerEvents: 'none' }}>
              <line x1="67" y1="62" x2="80" y2="60" stroke="var(--muted)" strokeWidth="0.3" />
              <text x="81" y="61" fill="var(--muted)">hip</text>
              <line x1="50" y1="26" x2="50" y2="22" stroke="var(--muted)" strokeWidth="0.3" />
              <text x="50" y="21" textAnchor="middle" fill="var(--muted)">spine</text>
              <line x1="66" y1="78" x2="79" y2="80" stroke="var(--muted)" strokeWidth="0.3" />
              <text x="80" y="81" fill="var(--muted)">crease</text>
              <text x="50" y="90" textAnchor="middle" fill="var(--text)">upper-outer quarter only</text>
            </g>
          )}
        </g>
      )}
    </>
  )
}

// The moment of choosing: a pin lands and a ring rushes outward, then the spot
// seals. Short, once, and never on a re-render — keyed on a nonce.
function PinDrop({ site }) {
  if (!site) return null
  return (
    <g style={{ pointerEvents: 'none' }}>
      <motion.circle
        cx={site.x} cy={site.y} r={4}
        fill="none" stroke="var(--lime)" strokeWidth="1.4"
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        initial={{ scale: 0.2, opacity: 1 }}
        animate={{ scale: 4.5, opacity: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.65, ease: 'easeOut' }}
      />
      <motion.circle
        cx={site.x} cy={site.y} r={3}
        fill="var(--lime)"
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        initial={{ scale: 2.4, opacity: 0 }}
        animate={{ scale: [2.4, 0.85, 1], opacity: [0, 1, 1] }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      />
    </g>
  )
}

function InjectHereFlag({ site, zoom }) {
  if (!site) return null
  const w = zoom ? 22 : 27
  const h = zoom ? 6 : 7.5
  const fs = zoom ? 3 : 3.8
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

// The colours, spelled out. Kept as words next to the swatch — nobody should
// have to decode a hue to answer "can I use this one".
export function ColourKey({ compact }) {
  return (
    <div className={`grid gap-1 ${compact ? 'text-[10px]' : 'text-[11px]'} font-bold`} style={{ color: 'var(--muted)' }}>
      <Key c="var(--lime)" l="Healed — good to use" />
      <Key c="var(--amber)" l="Still cooling down" />
      <Key c="var(--coral)" l="Just used — let it heal" />
      <Key c="var(--rose)" l="Reacting — resting until you clear it" />
      <Key c="var(--violet)" l="Used more than its turn — extended rest" />
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
