// Schematic "where does the tape go" illustrations. Deliberately crude line
// figures — they exist to disambiguate the words next to them (is the tape at
// the navel or the narrowest point?), not to look anatomical.
const STROKE = { fill: 'none', stroke: 'var(--muted)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
const TAPE = { fill: 'none', stroke: 'var(--lime)', strokeWidth: 3, strokeLinecap: 'round' }
const MARK = { fill: 'none', stroke: 'var(--indigo)', strokeWidth: 1.6, strokeLinecap: 'round', strokeDasharray: '3 3' }

// A head-to-hip torso with arms — shared by neck / chest / waist / hips.
function Torso({ tapeY, rx, navel, feetTogether }) {
  return (
    <>
      <circle cx="40" cy="14" r="8" {...STROKE} />
      <path d="M40 22 V30" {...STROKE} />
      <path d="M26 32 Q40 27 54 32 L57 58 Q40 63 23 58 Z" {...STROKE} />
      <path d="M26 33 L18 56" {...STROKE} />
      <path d="M54 33 L62 56" {...STROKE} />
      {feetTogether && <><path d="M34 62 L34 76" {...STROKE} /><path d="M46 62 L46 76" {...STROKE} /></>}
      {navel && <circle cx="40" cy="52" r="1.8" fill="var(--indigo)" />}
      <ellipse cx="40" cy={tapeY} rx={rx} ry="3.2" {...TAPE} />
    </>
  )
}

// A limb with the saved reference distance drawn as a dashed measure.
function Limb({ jointY, tapeY, label }) {
  return (
    <>
      {/* upper segment */}
      <path d="M40 6 L40 74" {...STROKE} strokeWidth="12" stroke="var(--surface2)" />
      <path d="M40 6 L40 74" {...STROKE} />
      {/* joint landmark */}
      <path d={`M30 ${jointY} L50 ${jointY}`} {...STROKE} strokeWidth="1.6" />
      <text x="53" y={jointY + 3} fontSize="7" fontWeight="700" fill="var(--muted)">{label}</text>
      {/* the saved distance */}
      <path d={`M24 ${jointY} L24 ${tapeY}`} {...MARK} />
      <path d={`M21 ${jointY} L27 ${jointY} M21 ${tapeY} L27 ${tapeY}`} {...MARK} strokeDasharray="none" />
      <ellipse cx="40" cy={tapeY} rx="9" ry="2.8" {...TAPE} />
    </>
  )
}

const GUIDES = {
  weight: (
    <>
      <circle cx="40" cy="18" r="8" {...STROKE} />
      <path d="M40 26 V44 M40 32 L30 40 M40 32 L50 40 M40 44 L33 60 M40 44 L47 60" {...STROKE} />
      <rect x="20" y="62" width="40" height="12" rx="3" {...STROKE} />
      <path d="M32 68 H48" {...TAPE} />
    </>
  ),
  neck: <Torso tapeY={28} rx="7" />,
  chest: <Torso tapeY={38} rx="16" />,
  waist: <Torso tapeY={52} rx="17" navel />,
  hips: <Torso tapeY={60} rx="18" feetTogether />,
  arm: <Limb jointY={52} tapeY={28} label="elbow" />,
  forearm: (
    <>
      <path d="M40 6 L40 74" {...STROKE} strokeWidth="12" stroke="var(--surface2)" />
      <path d="M40 6 L40 74" {...STROKE} />
      <path d="M30 24 L50 24" {...STROKE} strokeWidth="1.6" />
      <text x="53" y="27" fontSize="7" fontWeight="700" fill="var(--muted)">elbow</text>
      <ellipse cx="40" cy="38" rx="10" ry="2.8" {...TAPE} />
      <text x="53" y="41" fontSize="7" fontWeight="700" fill="var(--lime)">widest</text>
    </>
  ),
  thigh: <Limb jointY={62} tapeY={32} label="kneecap" />,
  calf: (
    <>
      <path d="M40 6 L40 74" {...STROKE} strokeWidth="12" stroke="var(--surface2)" />
      <path d="M40 6 L40 74" {...STROKE} />
      <path d="M30 18 L50 18" {...STROKE} strokeWidth="1.6" />
      <text x="53" y="21" fontSize="7" fontWeight="700" fill="var(--muted)">knee</text>
      <ellipse cx="40" cy="36" rx="10" ry="2.8" {...TAPE} />
      <text x="53" y="39" fontSize="7" fontWeight="700" fill="var(--lime)">widest</text>
    </>
  ),
}

export default function MeasureGuide({ id, size = 68 }) {
  const art = GUIDES[id]
  if (!art) return null
  return (
    <svg viewBox="0 0 80 80" width={size} height={size} role="img" aria-hidden="true" className="shrink-0">
      {art}
    </svg>
  )
}

export function hasGuide(id) {
  return !!GUIDES[id]
}
