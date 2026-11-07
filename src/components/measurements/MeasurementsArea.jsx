import { useMemo, useState } from 'react'
import { ChevronLeft, Plus, Ruler, GitCompareArrows, Scale, Images, Settings2, ListOrdered } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore from '../../store/useStore'
import { AnswerLine, DeltaChip, StatRow, SectionTitle, InfoButton } from '../ui/Glance'
import TrendChart from '../charts/TrendChart'
import useChartEvents from '../charts/useChartEvents'
import Sparkline from '../charts/Sparkline'
import LongList from '../ui/LongList'
import AlignedPhoto, { PhotoFrame } from '../photos/AlignedPhoto'
import { PhotoPicker } from '../photos/PhotoCompare'
import { evoltScans, heightFor } from '../../body/composition'
import {
  TAPE_SITES, TAPE_SITE_BY_KEY, siteRows, siteCounts, siteSeries, totalChange, changeWords, compareDates,
  quickPairs, tapeDates, nearestByDate, ratios, betterFor, toneOf,
} from '../../body/tape'
import TapeLogSheet from './TapeLogSheet'

const soft = { color: 'var(--text-2)' }
const muted = { color: 'var(--text-3)' }
const day = (d) => format(parseISO(d), 'd MMM yyyy')
const short = (d) => format(parseISO(d), 'd MMM')
/** "+0.4" / "−1.2" for a chip */
export const signed = (v) => (v == null ? '' : Math.abs(v) < 0.05 ? '0.0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`)
const POSES = ['front', 'side', 'back']

/** Body › Measurements: tape measurements, answer first. */
export default function MeasurementsArea({ onEditEntry }) {
  const measurements = useStore((s) => s.measurements)
  const settings = useStore((s) => s.tapeSettings)
  const [logging, setLogging] = useState(false)
  const [site, setSite] = useState(null)
  const rows = useMemo(() => siteRows(measurements, settings), [measurements, settings])
  const total = useMemo(() => totalChange(measurements), [measurements])

  if (site) return <SiteChart siteKey={site} onBack={() => setSite(null)} />

  return (
    <div className="space-y-3" data-testid="measurements-area">
      <section className="card p-5" data-testid="tape-answer">
        <div className="flex items-start gap-3">
          <p className="t-caption min-w-0 flex-1" style={muted}>Tape measurements</p>
          <button onClick={() => setLogging(true)} className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="tape-log">
            <Plus size={13} /> Tape
          </button>
        </div>
        {total ? (
          <>
            <AnswerLine className="mt-1" testid="tape-total">{`${changeWords(total.total)} in total since ${day(total.since)}`}</AnswerLine>
            <p className="mt-1 text-sm font-medium tabular-nums" style={soft} data-testid="tape-last-time">
              {total.lastTime != null && total.prevDate
                ? `Since last time (${short(total.prevDate)} to ${short(total.lastDate)}): ${changeWords(total.lastTime).toLowerCase()}.`
                : `Last measured ${day(total.lastDate)}.`}
            </p>
            <p className="mt-1 text-[13px] font-medium" style={muted}>All girth changes added up, {total.sites} {total.sites === 1 ? 'site' : 'sites'}, each from its own first entry.</p>
          </>
        ) : (
          <p className="mt-1 text-sm font-medium" style={soft} data-testid="tape-empty">
            {rows.length ? 'Log a second time to see what changed.' : 'No tape measurements yet. Log your first to see changes here.'}
          </p>
        )}
      </section>

      {rows.length > 0 && <BodyDiagram rows={rows} onOpen={setSite} />}

      {rows.length > 0 && (
        <section className="card px-4 pb-1 pt-3" data-testid="tape-sites">
          <SectionTitle icon={Ruler} title="Sites" />
          <div className="rows">
            {rows.map((r) => (
              <button key={r.key} onClick={() => setSite(r.key)} className="flex w-full items-center gap-3 py-3 text-left" data-testid={`tape-site-${r.key}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{r.site.label}</span>
                  <span className="block truncate text-[13px] font-medium tabular-nums" style={muted}>
                    {r.sinceFirst != null ? `${signed(r.sinceFirst)} cm since first` : 'Measured once'}
                  </span>
                </span>
                <Sparkline values={r.series.slice(-12).map((p) => p.value)} width={40} height={18} />
                <span className="w-[64px] shrink-0 text-right text-[17px] font-semibold tabular-nums">{r.latest.value.toFixed(1)}<span className="ml-0.5 text-[13px] font-medium" style={muted}>cm</span></span>
                <span className="w-[52px] shrink-0 text-right">{r.sinceLast != null && <DeltaChip text={signed(r.sinceLast)} tone={r.tone} />}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {tapeDates(measurements).length >= 2 && <TapeCompare />}
      <Ratios />
      <AllEntries onEditEntry={onEditEntry} />
      <TapeSettingsCard />
      <TapeLogSheet open={logging} onClose={() => setLogging(false)} />
    </div>
  )
}

// ------------------------------------------------------------- body diagram

// where each site sits on the figure, and which side its label goes (front view: your right is on the left)
const ANCHOR = {
  neck: [180, 74], chest: [180, 112], waist: [180, 168], hips: [180, 204],
  armR: [124, 126], armL: [236, 126], forearmR: [108, 182], forearmL: [252, 182],
  thighR: [162, 262], thighL: [198, 262], calfR: [160, 346], calfL: [200, 346],
}
const LABEL = {
  neck: ['L', 50], armR: ['L', 110], waist: ['L', 168], forearmR: ['L', 226], thighR: ['L', 286], calfR: ['L', 352],
  chest: ['R', 86], armL: ['R', 136], hips: ['R', 192], forearmL: ['R', 242], thighL: ['R', 296], calfL: ['R', 352],
}
const TONE = { better: 'var(--accent)', worse: 'var(--amber)', same: 'var(--text-3)' }

/** A plain front view with each measured site's latest value and its change since last. */
export function BodyDiagram({ rows, onOpen }) {
  const shown = rows.filter((r) => ANCHOR[r.key])
  return (
    <section className="card p-3" data-testid="tape-diagram">
      <svg viewBox="0 0 360 400" className="w-full" role="img" aria-label="Latest measurements on a body diagram">
        <g fill="none" stroke="var(--border)" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="180" cy="40" r="20" strokeWidth="2" fill="var(--surface-sunk)" />
          <path d="M150 88 Q180 80 210 88 L222 170 Q218 200 214 216 L146 216 Q142 200 138 170 Z" strokeWidth="2" fill="var(--surface-sunk)" />
          <path d="M150 92 L124 130 L108 190" strokeWidth="14" stroke="var(--surface-sunk)" />
          <path d="M210 92 L236 130 L252 190" strokeWidth="14" stroke="var(--surface-sunk)" />
          <path d="M164 216 L160 300 L160 380" strokeWidth="18" stroke="var(--surface-sunk)" />
          <path d="M196 216 L200 300 L200 380" strokeWidth="18" stroke="var(--surface-sunk)" />
          <line x1="180" y1="60" x2="180" y2="86" strokeWidth="10" stroke="var(--surface-sunk)" />
        </g>
        {shown.map((r) => {
          const [ax, ay] = ANCHOR[r.key]
          const [side, ly] = LABEL[r.key]
          const left = side === 'L'
          const lx = left ? 6 : 354
          const edge = left ? 96 : 264
          const chip = r.sinceLast != null ? signed(r.sinceLast) : null
          return (
            <g key={r.key} onClick={() => onOpen?.(r.key)} style={{ cursor: 'pointer' }} data-testid={`diagram-${r.key}`} data-tone={r.tone}>
              <line x1={edge} y1={ly - 4} x2={ax} y2={ay} stroke="var(--text-3)" strokeWidth="1" strokeOpacity="0.5" />
              <circle cx={ax} cy={ay} r="3" fill="var(--text-2)" />
              <text x={lx} y={ly - 10} fontSize="12" fontWeight="600" fill="var(--text-3)" textAnchor={left ? 'start' : 'end'}>{r.site.short}</text>
              <text x={lx} y={ly + 6} fontSize="15" fontWeight="700" fill="var(--text)" textAnchor={left ? 'start' : 'end'} className="tabular-nums">
                {r.latest.value.toFixed(1)}
                {chip && <tspan dx="5" fontSize="12" fontWeight="700" fill={TONE[r.tone]}>{chip}</tspan>}
              </text>
            </g>
          )
        })}
      </svg>
      <p className="px-1 text-[13px] font-medium" style={muted}>Latest in cm, with the change since last time. Tap a site for its chart.</p>
    </section>
  )
}

// --------------------------------------------------------------- site chart

function SiteChart({ siteKey, onBack }) {
  const measurements = useStore((s) => s.measurements)
  const settings = useStore((s) => s.tapeSettings)
  const events = useChartEvents()
  const site = TAPE_SITE_BY_KEY[siteKey]
  const better = betterFor(siteKey, settings)
  const series = useMemo(() => siteSeries(measurements, siteKey).map((p) => ({ ...p, source: 'manual', sourceLabel: 'Tape' })), [measurements, siteKey])
  // the waist chart can show Evolt's abdominal circumference as a second line
  const evolt = useMemo(() => (siteKey === 'waist'
    ? evoltScans(measurements).filter((m) => typeof m.abdominalCircumference === 'number').map((m) => ({ date: m.date, value: m.abdominalCircumference }))
    : []), [measurements, siteKey])
  const [showEvolt, setShowEvolt] = useState(true)
  const name = site.label.toLowerCase().replace(', left', ' (left)').replace(', right', ' (right)')
  const question = `Is my ${name} getting ${better === 'down' ? 'smaller' : 'bigger'}?`
  return (
    <div className="space-y-3" data-testid="tape-site-chart">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold" style={soft} data-testid="tape-back"><ChevronLeft size={16} /> Measurements</button>
      <TrendChart metric={siteKey} chartType={`tape-${siteKey}`} title={site.label} question={question} unit="cm" dp={1}
        series={series} events={events} better={better} defaultRange="All" testid="tape-chart"
        second={evolt.length && showEvolt ? { label: 'Evolt estimate', series: evolt } : null} />
      {evolt.length > 0 && (
        <label className="flex items-center gap-2 px-1 text-sm font-medium" style={soft}>
          <input type="checkbox" checked={showEvolt} onChange={(e) => setShowEvolt(e.target.checked)} data-testid="tape-evolt-toggle" />
          Show Evolt abdominal circumference (Evolt estimate)
        </label>
      )}
      <section className="card px-4 pb-1 pt-3">
        <SectionTitle title="Every entry" />
        <div className="rows">
          {[...series].reverse().map((p, i, arr) => {
            const prev = arr[i + 1]
            const d = prev ? Math.round((p.value - prev.value) * 10) / 10 : null
            return <StatRow key={p.date} label={day(p.date)} value={p.value} dp={1} unit="cm" chipText={d != null ? signed(d) : undefined} chipTone={toneOf(d, better)} testid="tape-entry" />
          })}
        </div>
      </section>
    </div>
  )
}

// ------------------------------------------------------------------ compare

function TapeCompare() {
  const measurements = useStore((s) => s.measurements)
  const settings = useStore((s) => s.tapeSettings)
  const photos = useStore((s) => s.photos)
  const dates = useMemo(() => tapeDates(measurements), [measurements])
  const quick = useMemo(() => quickPairs(measurements), [measurements])
  const [mode, setMode] = useState('previous')
  const [pick, setPick] = useState(() => quick.latestVsPrevious || [dates[0], dates[dates.length - 1]])
  const [a, b] = mode === 'previous' ? quick.latestVsPrevious : mode === 'first' ? quick.latestVsFirst : pick
  const rows = useMemo(() => compareDates(measurements, a, b, settings), [measurements, a, b, settings])
  const [pose, setPose] = useState('front')
  const scans = useMemo(() => evoltScans(measurements), [measurements])
  const opt = (id, label) => (
    <button key={id} onClick={() => setMode(id)} aria-pressed={mode === id} data-testid={`tape-compare-${id}`}
      className="min-h-[34px] flex-1 rounded-full text-xs font-bold"
      style={mode === id ? { background: 'var(--surface2)', color: 'var(--text)' } : { color: 'var(--text-3)' }}>{label}</button>
  )
  return (
    <section className="card px-4 pb-3 pt-3" data-testid="tape-compare">
      <SectionTitle icon={GitCompareArrows} title="Compare" />
      <p className="mt-1 text-[13px] font-medium" style={muted}>The latest against</p>
      <div className="mt-1 flex gap-1 rounded-full p-1" style={{ background: 'var(--surface-sunk)' }}>
        {opt('previous', 'The one before')}{opt('first', 'The first')}{opt('pick', 'Any two dates')}
      </div>
      {mode === 'pick' && (
        <div className="mt-2 flex items-center gap-2">
          {[0, 1].map((i) => (
            <select key={i} className="input flex-1 !py-2" value={pick[i]} onChange={(e) => setPick((p) => (i ? [p[0], e.target.value] : [e.target.value, p[1]]))} data-testid={`tape-pick-${i}`}>
              {dates.map((d) => <option key={d} value={d}>{day(d)}</option>)}
            </select>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-3 text-[13px] font-semibold tabular-nums" style={muted}>
        <span className="min-w-0 flex-1">Site</span><span>{short(a)} → {short(b)}</span>
      </div>
      <div className="rows">
        {rows.map((r) => (
          <StatRow key={r.key} label={r.site.label} from={r.before != null ? r.before.toFixed(1) : null} to={r.after != null ? r.after.toFixed(1) : null} unit="cm"
            chipText={r.change != null ? signed(r.change) : undefined} chipTone={r.tone} testid={`tape-cmp-${r.key}`} />
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Images size={15} style={muted} />
        <p className="min-w-0 flex-1 text-[15px] font-semibold">Photos nearest each date</p>
        <div className="flex gap-1">
          {POSES.map((p) => (
            <button key={p} onClick={() => setPose(p)} aria-pressed={pose === p} className="min-h-[30px] rounded-full px-2.5 text-xs font-bold capitalize"
              style={pose === p ? { background: 'var(--surface2)', color: 'var(--text)' } : { color: 'var(--text-3)' }} data-testid={`tape-pose-${p}`}>{p}</button>
          ))}
        </div>
      </div>
      {photos.some((p) => p.pose === pose) ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <NearPhoto photos={photos} pose={pose} date={a} />
          <NearPhoto photos={photos} pose={pose} date={b} />
        </div>
      ) : <p className="mt-1 text-[13px] font-medium" style={muted} data-testid="tape-no-photos">No {pose} photos yet. Take them in Composition › Photos.</p>}

      <div className="mt-4 flex items-center gap-2"><Scale size={15} style={muted} /><p className="text-[15px] font-semibold">Evolt scan nearest each date</p></div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <NearScan scans={scans} date={a} />
        <NearScan scans={scans} date={b} />
      </div>
    </section>
  )
}

const away = (days) => (days === 0 ? 'same day' : `${days} ${days === 1 ? 'day' : 'days'} away`)

function NearPhoto({ photos, pose, date }) {
  const posed = useMemo(() => photos.filter((p) => p.pose === pose), [photos, pose])
  const near = nearestByDate(posed, date)
  const [chosen, setChosen] = useState(null)
  const [picking, setPicking] = useState(false)
  const photo = (chosen && posed.find((p) => p.id === chosen)) || near?.item || null
  if (!photo) return <div className="flex aspect-[3/4] items-center justify-center rounded-[14px] px-3 text-center text-[13px] font-medium" style={{ background: 'var(--surface-sunk)', color: 'var(--text-3)' }}>No {pose} photo</div>
  const days = Math.round(Math.abs(Date.parse(photo.date) - Date.parse(date)) / 86400000)
  return (
    <div>
      <button onClick={() => setPicking(true)} className="block w-full" data-testid="tape-near-photo" aria-label="Choose another photo">
        <PhotoFrame maxWidth={999}><AlignedPhoto photo={photo} thumb /></PhotoFrame>
      </button>
      <p className="mt-1 text-center text-[13px] font-medium tabular-nums" style={muted}>{day(photo.date)}, {away(days)}</p>
      <PhotoPicker open={picking} title={`${pose[0].toUpperCase()}${pose.slice(1)} photos`} photos={posed} selected={photo.id} onPick={(p) => setChosen(p.id)} onClose={() => setPicking(false)} />
    </div>
  )
}

function NearScan({ scans, date }) {
  const near = nearestByDate(scans, date)
  if (!near) return <p className="rounded-[14px] p-3 text-[13px] font-medium" style={{ background: 'var(--surface-sunk)', color: 'var(--text-3)' }}>No Evolt scan</p>
  const s = near.item
  const v = (x, u) => (typeof x === 'number' ? `${x.toFixed(1)} ${u}` : '–')
  return (
    <div className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid="tape-near-scan">
      <p className="text-[13px] font-semibold tabular-nums" style={soft}>{day(s.date)}</p>
      <p className="text-[13px] font-medium" style={muted}>{away(near.days)}</p>
      <dl className="mt-1 space-y-0.5 text-[13px] font-medium tabular-nums">
        <div className="flex justify-between"><dt style={muted}>Weight</dt><dd>{v(s.weight, 'kg')}</dd></div>
        <div className="flex justify-between"><dt style={muted}>Body fat</dt><dd>{v(s.bodyFat, '%')}</dd></div>
        <div className="flex justify-between"><dt style={muted}>Fat mass</dt><dd>{v(s.fatMass, 'kg')}</dd></div>
      </dl>
    </div>
  )
}

// ------------------------------------------------------------------- ratios

function Ratios() {
  const measurements = useStore((s) => s.measurements)
  const heightSetting = useStore((s) => s.bodyProfile?.heightCm)
  const height = heightFor(heightSetting, measurements)
  const list = useMemo(() => ratios(measurements, height), [measurements, height])
  if (!list.length) return null
  return (
    <section className="card px-4 pb-1 pt-3" data-testid="tape-ratios">
      <SectionTitle title="Ratios" info={<p>Plain descriptions of your numbers, from the latest tape and your height. Not a judgement or advice.</p>} />
      <div className="rows">
        {list.map((r) => (
          <div key={r.key} className="py-3" data-testid={`tape-ratio-${r.key}`}>
            <div className="flex items-baseline gap-3">
              <p className="min-w-0 flex-1 text-[15px] font-medium">{r.label}</p>
              <p className="shrink-0 text-[17px] font-semibold tabular-nums">{r.value}</p>
            </div>
            <p className="mt-0.5 text-[13px] font-medium" style={muted}>{r.meaning}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

// -------------------------------------------------------------- all entries

function AllEntries({ onEditEntry }) {
  const measurements = useStore((s) => s.measurements)
  const entries = useMemo(() => measurements.filter((m) => TAPE_SITES.some((s) => typeof m[s.key] === 'number' && m[s.key] > 0)).slice().reverse(), [measurements])
  if (!entries.length) return null
  return (
    <section className="card px-4 pb-2 pt-3" data-testid="tape-entries">
      <SectionTitle icon={ListOrdered} title={`All entries (${entries.length})`} />
      <LongList items={entries} keyOf={(m) => m.id || m.date} rowHeight={52} testid="tape-entry-list" renderItem={(m) => {
        const sites = TAPE_SITES.filter((s) => typeof m[s.key] === 'number' && m[s.key] > 0)
        return (
          <button onClick={() => onEditEntry?.(m.id)} className="flex w-full items-start gap-3 py-2.5 text-left" data-testid={`tape-all-${m.id}`}>
            <span className="w-[86px] shrink-0 text-[13px] font-semibold tabular-nums" style={soft}>{day(m.date)}</span>
            <span className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-0.5 text-[13px] font-medium tabular-nums" style={{ color: 'var(--text)' }}>
              {sites.map((s) => <span key={s.key} className="whitespace-nowrap"><span style={muted}>{s.short}</span> {m[s.key]}</span>)}
            </span>
          </button>
        )
      }} />
      <p className="pt-1 text-[13px] font-medium" style={muted}>Tap an entry to correct it.</p>
    </section>
  )
}

// ----------------------------------------------------------------- settings

function TapeSettingsCard() {
  const measurements = useStore((s) => s.measurements)
  const settings = useStore((s) => s.tapeSettings)
  const set = useStore((s) => s.setTapeSettings)
  const counts = useMemo(() => siteCounts(measurements), [measurements])
  const measured = TAPE_SITES.filter((s) => counts[s.key])
  const [open, setOpen] = useState(false)
  return (
    <section className="card px-4 pb-3 pt-3" data-testid="tape-settings">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left" data-testid="tape-settings-open">
        <Settings2 size={15} style={muted} />
        <span className="flex-1 text-[15px] font-semibold">Measurement settings</span>
        <span className="text-xs font-bold" style={muted}>{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          <label className="flex items-center gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Remind me every 2 weeks</span>
              <span className="block text-[13px] font-medium" style={muted}>A notification 14 days after your last tape entry.</span>
            </span>
            <input type="checkbox" checked={!!settings?.reminder} onChange={(e) => set({ reminder: e.target.checked })} data-testid="tape-reminder" />
          </label>
          <div>
            <p className="text-sm font-semibold">Which way is better</p>
            <div className="rows">
              {TAPE_SITES.filter((s) => !s.legacy || counts[s.key]).map((s) => {
                const b = betterFor(s.key, settings)
                return (
                  <div key={s.key} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.label}</span>
                    {['down', 'up'].map((dir) => (
                      <button key={dir} onClick={() => set({ better: { ...(settings?.better || {}), [s.key]: dir } })} aria-pressed={b === dir}
                        className="min-h-[30px] rounded-full px-2.5 text-xs font-bold" data-testid={`tape-better-${s.key}-${dir}`}
                        style={b === dir ? { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' } : { color: 'var(--text-3)' }}>
                        {dir === 'down' ? 'Smaller' : 'Bigger'}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
          <div data-testid="tape-counts">
            <div className="flex items-center gap-2">
              <p className="flex-1 text-sm font-semibold">Entries found</p>
              <InfoButton title="Entries found">Every tape value on record, counted per site. Nothing is merged or dropped.</InfoButton>
            </div>
            {measured.length
              ? <p className="text-[13px] font-medium tabular-nums" style={soft}>{measured.map((s) => `${s.label} ${counts[s.key]}`).join(', ')}</p>
              : <p className="text-[13px] font-medium" style={muted}>None yet.</p>}
          </div>
        </div>
      )}
    </section>
  )
}
