import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Phone, ChevronRight, Plus, Copy, Check } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import { prettyDate } from '../../lib/schedule'
import { displayName } from '../../lib/naming'
import { ZONE_BY_ID, COINS, SIDE_SETS, SIDE_SET_IDS } from '../../lib/reactionZones'
import { allZoneStatus, zoneHistory, zoneVsOverall, reactionRateByZone } from '../../lib/reactionSites'
import { checkinsDue } from '../../lib/reactionCheckins'
import {
  activeSafety, reactionScore, onsetLabel, rsWords, RS_POSITIVE, durationWords,
} from '../../lib/reactionScore'
import { blobUrl } from '../../lib/blobStore'
import BodyMap from './BodyMap'
import ReactionSetup from './ReactionSetup'
import CheckinStack from './CheckinStack'
import LogInjection from './LogInjection'
import { SuspectBoard, Evidence, useReactionAnalysis } from './SuspectBoard'
import InvestigationPanel from './InvestigationPanel'
import ReactionReport from './ReactionReport'

/**
 * The lab, in the order the brief asks for it.
 *
 * Safety first and unconditionally, then what needs doing, then what is known,
 * then the method, then the map, then the working. Anything that is not
 * actionable or not yet true simply is not rendered — an empty section is worse
 * than no section, because it teaches people to scroll past.
 */
export default function ReactionLab() {
  const settings = useStore((s) => s.reactionSettings)
  const reactions = useStore((s) => s.reactions)
  const checkins = useStore((s) => s.reactionCheckins)
  const records = useStore((s) => s.injectionRecords)
  const peptides = useStore((s) => s.peptides)
  const t = todayStr()

  const [checkinOpen, setCheckinOpen] = useState(false)
  const [logFor, setLogFor] = useState(null)
  const [zoneOpen, setZoneOpen] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reactionOpen, setReactionOpen] = useState(null)
  const [view, setView] = useState('front')
  const [heatmap, setHeatmap] = useState(false)

  // the deep link from the Back Tap shortcut lands straight on the stack
  useEffect(() => {
    const check = () => {
      if (window.location.hash.includes('reaction-lab/checkins')) setCheckinOpen(true)
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [])

  const nowIso = new Date().toISOString()
  const due = useMemo(
    () => checkinsDue({ reactions, checkins, windows: settings?.windowTimes, nowIso }),
    [reactions, checkins, settings, nowIso]
  )
  const danger = useMemo(() => activeSafety({ reactions, checkins }), [reactions, checkins])
  const ctx = { records, reactions, todayStr: t, restDays: settings?.restDays ?? 3 }
  const statusByZone = useMemo(() => allZoneStatus(ctx), [records, reactions, t, settings]) // eslint-disable-line react-hooks/exhaustive-deps

  const a = useReactionAnalysis()
  const rateByZone = useMemo(
    () => reactionRateByZone({ records, reactions, positiveOf: a.positiveOf }),
    [records, reactions, a]
  )

  const dots = useMemo(() => reactions
    .filter((r) => r.status !== 'resolved')
    .map((r) => {
      const rec = records.find((x) => x.id === r.injectionRecordId)
      return rec?.zoneId ? { id: r.id, zoneId: rec.zoneId, point: rec.point } : null
    })
    .filter(Boolean), [reactions, records])

  if (!settings?.enabled) return <ReactionSetup onDone={() => { /* state flips in the store */ }} />

  return (
    <div className="space-y-3" data-testid="reaction-lab">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight">Reaction Lab</h1>
          <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
            Working out what is causing the redness
          </p>
        </div>
        <button onClick={() => setSettingsOpen(true)} data-testid="lab-settings"
          className="shrink-0 rounded-full px-3 py-2 text-xs font-black"
          style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
          Settings
        </button>
      </div>

      {/* 1 — safety, first and unconditional */}
      <SafetyBanner danger={danger} />

      {/* 2 — what needs doing */}
      {due.length > 0 && (
        <button onClick={() => setCheckinOpen(true)} data-testid="checkins-due"
          className="btn-primary flex w-full items-center justify-between gap-2 rounded-[14px] px-4 py-3 text-left">
          <span className="min-w-0">
            <span className="block text-sm font-black">
              {due.length} check-in{due.length === 1 ? '' : 's'} due
            </span>
            <span className="block text-xs font-bold opacity-80">
              {due.slice(0, 2).map((d) => ZONE_BY_ID[d.reaction.zoneId]?.short).filter(Boolean).join(', ')}
              {due.length > 2 ? ` and ${due.length - 2} more` : ''}
            </span>
          </span>
          <ChevronRight size={18} className="shrink-0" />
        </button>
      )}

      {/* 3 — one line */}
      <SummaryLine />

      {/* 4 — who, and how sure */}
      <SuspectBoard />

      {/* 5 — the method */}
      <InvestigationPanel />

      {/* log a shot */}
      <div className="card p-3">
        <p className="t-caption mb-1.5" style={{ color: 'var(--text-2)' }}>Log an injection</p>
        <div className="flex flex-wrap gap-1.5">
          {peptides.slice(0, 8).map((p) => (
            <button key={p.id} onClick={() => setLogFor(p.id)} data-testid="lab-log-compound"
              data-compound={p.id}
              className="flex min-h-[34px] items-center gap-1 rounded-full px-3 text-xs font-black"
              style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>
              <Plus size={11} /> {displayName(p)}
            </button>
          ))}
        </div>
      </div>

      {/* 6 — the map */}
      <div className="card p-3">
        <p className="t-caption mb-2" style={{ color: 'var(--text-2)' }}>Sites</p>
        <BodyMap
          view={view} onView={setView}
          heatmap={heatmap} onHeatmap={setHeatmap}
          rateByZone={rateByZone}
          statusByZone={statusByZone}
          onSelectZone={setZoneOpen}
          activeDots={dots}
          onOpenDot={(d) => setReactionOpen(d.id)}
        />
      </div>

      {/* 7 — the working */}
      <Evidence />

      <button onClick={() => setReportOpen(true)} data-testid="open-report"
        className="flex w-full items-center justify-center gap-2 rounded-full py-3 text-xs font-black"
        style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>
        Export report
      </button>

      <p className="px-1 pb-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
        This records what happened and compares it. It does not diagnose anything — a reaction that keeps
        happening, or any of the warnings above, belongs with a doctor.
      </p>

      <CheckinStack open={checkinOpen} onClose={() => setCheckinOpen(false)} />
      <LogInjection open={!!logFor} peptideId={logFor} onClose={() => setLogFor(null)} />
      <SiteDetail zoneId={zoneOpen} onClose={() => setZoneOpen(null)} onOpenReaction={setReactionOpen} />
      <ReactionTimeline reactionId={reactionOpen} onClose={() => setReactionOpen(null)} />
      <LabSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ReactionReport open={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  )
}

// ------------------------------------------------------------------ safety

export function SafetyBanner({ danger, compact = false }) {
  if (!danger) return null
  const emergency = danger.level === 'emergency'
  return (
    <div className="card p-3" data-testid="safety-banner" data-level={danger.level}
      style={{
        background: emergency ? 'var(--danger)' : 'color-mix(in srgb, var(--danger) 20%, transparent)',
        border: emergency ? 'none' : '1px solid var(--danger)',
      }}>
      <p className="flex items-center gap-2 text-sm font-black"
        style={{ color: emergency ? 'var(--accent-fg)' : 'var(--danger)' }}>
        {emergency ? <Phone size={15} /> : <AlertTriangle size={15} />} {danger.title}
      </p>
      <p className="mt-1 text-xs font-bold leading-relaxed"
        style={{ color: emergency ? 'var(--accent-fg)' : 'var(--text)' }}>
        {danger.reasons.join(' · ')}
      </p>
      {!compact && (
        <p className="mt-1 text-xs font-medium leading-relaxed"
          style={{ color: emergency ? 'var(--accent-fg)' : 'var(--text-2)' }}>
          {emergency
            ? 'This is not something to investigate. Ring 000.'
            : 'Stop injecting into this site and have someone look at it today.'}
        </p>
      )}
    </div>
  )
}

// ----------------------------------------------------------------- summary

export function SummaryLine() {
  const records = useStore((s) => s.injectionRecords)
  const reactions = useStore((s) => s.reactions)
  const t = todayStr()

  const open = reactions.filter((r) => r.status !== 'resolved')
  const sides = new Set(open.map((r) => {
    const rec = records.find((x) => x.id === r.injectionRecordId)
    return ZONE_BY_ID[rec?.zoneId]?.side
  }).filter(Boolean))

  // how long the other side has been quiet, which is the comparison that matters
  const clearSince = (side) => {
    const hits = reactions
      .filter((r) => {
        const rec = records.find((x) => x.id === r.injectionRecordId)
        return ZONE_BY_ID[rec?.zoneId]?.side === side
      })
      .map((r) => String(r.injectedAt).slice(0, 10))
      .sort()
    return hits.at(-1) || null
  }

  // Said even with nothing logged: "no sites reacting" is a fact worth stating
  // on the first evening, and a line that appears only once there is a problem
  // teaches people it means there is one.
  const other = sides.size === 1 ? (sides.has('L') ? 'R' : 'L') : null
  const otherLast = other ? clearSince(other) : null
  const days = otherLast ? Math.max(0, Math.round((new Date(t) - new Date(otherLast)) / 86400000)) : null

  return (
    <p className="px-1 text-xs font-bold" data-testid="summary-line">
      {open.length === 0
        ? 'No sites reacting.'
        : `${open.length} site${open.length === 1 ? '' : 's'} active${sides.size === 1 ? `, ${sides.has('L') ? 'left' : 'right'} side only` : ''}.`}
      {days != null && (
        <span style={{ color: 'var(--text-2)' }}>
          {' '}{other === 'L' ? 'Left' : 'Right'} side clear {days} day{days === 1 ? '' : 's'}.
        </span>
      )}
    </p>
  )
}

// ------------------------------------------------------------- site detail

function SiteDetail({ zoneId, onClose, onOpenReaction }) {
  const records = useStore((s) => s.injectionRecords)
  const reactions = useStore((s) => s.reactions)
  const checkins = useStore((s) => s.reactionCheckins)
  const a = useReactionAnalysis()
  if (!zoneId) return null
  const zone = ZONE_BY_ID[zoneId]
  const history = zoneHistory(zoneId, { records, reactions })
  const stats = zoneVsOverall(zoneId, { records, reactions, scoreOf: a.scoreOf })

  return (
    <Modal open onClose={onClose} wide title={zone?.label || 'Site'}>
      <div className="space-y-3" data-testid="site-detail" data-zone={zoneId}>
        <div className="card p-3">
          <p className="t-caption" style={{ color: 'var(--text-2)' }}>This site against the rest</p>
          <p className="t-metric-sm mt-1 tabular-nums">
            {stats.zone ?? '—'}
            <span className="ml-2 text-xs font-bold" style={{ color: 'var(--text-3)' }}>
              average score over {stats.n} shot{stats.n === 1 ? '' : 's'}
            </span>
          </p>
          <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-2)' }}>
            Everywhere else: {stats.overall ?? '—'} over {stats.nAll} shots
          </p>
        </div>

        <div className="card rows overflow-hidden" data-testid="site-history">
          {history.map(({ record, reaction }) => {
            const rs = reaction ? reactionScore(reaction, checkins) : null
            return (
              <button key={record.id} onClick={() => reaction && onOpenReaction?.(reaction.id)}
                data-testid="site-history-row" className="flex w-full items-baseline gap-2 px-3 py-2.5 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold tabular-nums">
                    {prettyDate(String(record.injectedAt).slice(0, 10))}
                  </span>
                  <span className="block truncate text-xs font-medium" style={{ color: 'var(--text-3)' }}>
                    {(record.compoundIds || []).map(a.nameOf).join(' + ') || 'control shot'}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-black tabular-nums"
                  style={{ color: rs && rs.score >= RS_POSITIVE ? 'var(--warn)' : 'var(--text-3)' }}>
                  {rs ? rs.score : '—'}
                </span>
              </button>
            )
          })}
          {history.length === 0 && (
            <p className="px-3 py-3 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
              Nothing recorded at this site.
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}

// -------------------------------------------------- one reaction over time

function ReactionTimeline({ reactionId, onClose }) {
  const reactions = useStore((s) => s.reactions)
  const checkins = useStore((s) => s.reactionCheckins)
  const photos = useStore((s) => s.reactionPhotos)
  const treatments = useStore((s) => s.reactionTreatments)
  const addTreatment = useStore((s) => s.addTreatment)
  const [i, setI] = useState(0)
  const [urls, setUrls] = useState({})

  const rx = reactions.find((r) => r.id === reactionId)
  const mine = useMemo(
    () => checkins.filter((c) => c.reactionId === reactionId && c.completedAt)
      .sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt))),
    [checkins, reactionId]
  )
  const shots = useMemo(
    () => photos.filter((p) => p.reactionId === reactionId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    [photos, reactionId]
  )

  useEffect(() => {
    let alive = true
    Promise.all(shots.map(async (p) => [p.id, await blobUrl(p.blobKey)]))
      .then((pairs) => { if (alive) setUrls(Object.fromEntries(pairs)) })
    return () => { alive = false }
  }, [shots])

  useEffect(() => { setI(Math.max(0, shots.length - 1)) }, [shots.length])

  if (!rx) return null
  const rs = reactionScore(rx, checkins)
  const onset = onsetLabel(rx, checkins)
  const shot = shots[i] || null
  const mineT = treatments.filter((t) => t.reactionId === reactionId)

  return (
    <Modal open onClose={onClose} wide title={ZONE_BY_ID[rx.zoneId]?.label || 'Reaction'}>
      <div className="space-y-3" data-testid="reaction-timeline">
        <ScoreCard rs={rs} onset={onset} />

        {shots.length > 0 && (
          <div className="space-y-2" data-testid="photo-timeline">
            <div className="relative overflow-hidden rounded-[14px]" style={{ background: 'var(--surface-sunk)' }}>
              {urls[shot?.id] && <img src={urls[shot.id]} alt="" className="w-full" />}
              <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${shot?.width || 100} ${shot?.height || 100}`}
                preserveAspectRatio="none">
                {shot?.tracePaths?.redness?.length > 2 && (
                  <polygon points={shot.tracePaths.redness.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none" stroke="var(--danger)" strokeWidth="3" />
                )}
              </svg>
            </div>
            {shots.length > 1 && (
              <>
                <input type="range" min="0" max={shots.length - 1} value={i} className="w-full"
                  aria-label="Scrub through the photos" data-testid="timelapse"
                  onChange={(e) => setI(Number(e.target.value))} />
                <p className="text-center text-xs font-bold tabular-nums" style={{ color: 'var(--text-2)' }}>
                  {i + 1} of {shots.length} · {shot ? prettyDate(String(shot.createdAt).slice(0, 10)) : ''}
                </p>
              </>
            )}
          </div>
        )}

        <div className="card rows overflow-hidden" data-testid="checkin-history">
          {mine.map((c) => (
            <div key={c.id} className="flex items-baseline gap-2 px-3 py-2" data-testid="checkin-row">
              <span className="min-w-0 flex-1 text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
                {new Date(c.completedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="shrink-0 text-xs font-bold tabular-nums">
                {c.present ? `${c.diameterMm ?? '—'} mm · itch ${c.itch}` : 'clear'}
              </span>
            </div>
          ))}
        </div>

        <div className="card p-3" data-testid="treatments">
          <p className="t-caption mb-1.5" style={{ color: 'var(--text-2)' }}>Treatments</p>
          <div className="flex flex-wrap gap-1.5">
            {[['hydrocortisone', 'Hydrocortisone'], ['antihistamine', 'Antihistamine'],
              ['cold', 'Cold compress'], ['warm', 'Warm compress'], ['other', 'Other']].map(([k, label]) => (
              <button key={k} onClick={() => addTreatment(reactionId, { type: k })} data-testid="add-treatment"
                data-type={k}
                className="flex min-h-[32px] items-center rounded-full px-2.5 text-xs font-black"
                style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                {label}
              </button>
            ))}
          </div>
          {mineT.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {mineT.map((t) => (
                <p key={t.id} className="text-xs font-medium tabular-nums" data-testid="treatment-row"
                  style={{ color: 'var(--text-3)' }}>
                  {t.type} · {new Date(t.appliedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              ))}
              <p className="mt-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--warn)' }}>
                Treatment can make a reaction look milder than it really was, so this one is flagged in the
                analysis.
              </p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** The score, with the arithmetic behind it one tap away. */
export function ScoreCard({ rs, onset }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="card p-3" data-testid="score-card">
      <button onClick={() => setOpen((v) => !v)} data-testid="score-breakdown-toggle"
        className="flex w-full items-baseline gap-2 text-left">
        <span className="t-metric tabular-nums">{rs.score}</span>
        <span className="min-w-0 flex-1 text-xs font-bold" style={{ color: 'var(--text-2)' }}>
          reaction score · {rsWords(rs.score)}
        </span>
        <ChevronRight size={14} className="shrink-0"
          style={{ color: 'var(--text-3)', transform: open ? 'rotate(90deg)' : undefined }} />
      </button>
      {onset && (
        <p className="mt-1 text-xs font-medium leading-relaxed" data-testid="onset-label" data-onset={onset.id}>
          <span className="font-black">{onset.label}.</span>{' '}
          <span style={{ color: 'var(--text-3)' }}>{onset.words}</span>
        </p>
      )}
      {open && (
        <div className="mt-2 space-y-0.5" data-testid="score-breakdown">
          {Object.entries(rs.parts).map(([k, p]) => (
            <div key={k} className="flex items-baseline gap-2" data-testid="score-part" data-part={k}>
              <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: 'var(--text-3)' }}>
                {p.detail}
              </span>
              <span className="shrink-0 text-xs font-black tabular-nums">
                +{Math.round(p.points * 10) / 10}
              </span>
            </div>
          ))}
          <p className="pt-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
            Worst check-in in the first 72 hours, plus how long it lasted. Capped at 10.
          </p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- settings

function LabSettings({ open, onClose }) {
  const settings = useStore((s) => s.reactionSettings)
  const update = useStore((s) => s.updateReactionSettings)
  const peptides = useStore((s) => s.peptides)
  const showToast = useStore((s) => s.showToast)
  const [copied, setCopied] = useState(false)
  if (!open) return null

  const link = `${window.location.origin}${window.location.pathname}#/reaction-lab/checkins`

  return (
    <Modal open onClose={onClose} wide title="Reaction Lab settings">
      <div className="space-y-3" data-testid="lab-settings-sheet">
        <div className="card space-y-2 p-3">
          <p className="t-caption" style={{ color: 'var(--text-2)' }}>Check-in windows</p>
          <div className="flex gap-2">
            {[['morning', 'Morning'], ['evening', 'Evening']].map(([k, label]) => (
              <label key={k} className="min-w-0 flex-1">
                <span className="t-caption mb-1 block" style={{ color: 'var(--text-3)' }}>{label}</span>
                <input type="time" className="input" aria-label={`${label} window`}
                  data-testid={`settings-window-${k}`}
                  value={settings.windowTimes?.[k] || ''}
                  onChange={(e) => update({ windowTimes: { ...settings.windowTimes, [k]: e.target.value } })} />
              </label>
            ))}
          </div>
        </div>

        <div className="card space-y-2 p-3">
          <p className="t-caption" style={{ color: 'var(--text-2)' }}>Calibration coin</p>
          <div className="flex flex-wrap gap-1.5">
            {COINS.map((c) => (
              <button key={c.id} onClick={() => update({ coin: c.id })} data-testid="settings-coin"
                data-coin={c.id} data-on={settings.coin === c.id ? 'true' : 'false'}
                className="flex min-h-[32px] items-center rounded-full px-2.5 text-xs font-black tabular-nums"
                style={settings.coin === c.id
                  ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                  : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card space-y-2 p-3">
          <p className="t-caption" style={{ color: 'var(--text-2)' }}>Rest between shots at one site</p>
          <div className="flex flex-wrap gap-1.5">
            {[2, 3, 4, 5, 7].map((n) => (
              <button key={n} onClick={() => update({ restDays: n })} data-testid="settings-rest"
                data-days={n} data-on={settings.restDays === n ? 'true' : 'false'}
                className="flex min-h-[32px] items-center rounded-full px-3 text-xs font-black tabular-nums"
                style={settings.restDays === n
                  ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                  : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                {n} days
              </button>
            ))}
          </div>
        </div>

        <div className="card space-y-2 p-3" data-testid="side-settings">
          <p className="t-caption" style={{ color: 'var(--text-2)' }}>Side assignment</p>
          <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
            Suspects keep to their own side. Everything else defaults to the thighs — widen it to Anywhere
            if you have more shots a night than thigh sites.
          </p>
          {[...(settings.suspects || []),
            ...peptides.map((p) => p.id).filter((id) => !(settings.suspects || []).includes(id))].map((id) => {
            const p = peptides.find((x) => x.id === id)
            return (
              <div key={id} data-testid="settings-side-row" data-compound={id}>
                <p className="text-xs font-bold">{p ? displayName(p) : id}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {SIDE_SET_IDS.map((setId) => (
                    <button key={setId} data-testid="settings-side-option" data-set={setId}
                      data-on={settings.sideAssignment?.[id] === setId ? 'true' : 'false'}
                      onClick={() => update({ sideAssignment: { ...settings.sideAssignment, [id]: setId } })}
                      className="flex min-h-[30px] items-center rounded-full px-2.5 text-xs font-black"
                      style={settings.sideAssignment?.[id] === setId
                        ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                        : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                      {SIDE_SETS[setId].label}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* the double-tap shortcut */}
        <div className="card space-y-2 p-3" data-testid="back-tap">
          <p className="t-caption" style={{ color: 'var(--text-2)' }}>Open check-ins with a double tap</p>
          <button onClick={() => {
            navigator.clipboard?.writeText(link).then(() => { setCopied(true); showToast('Link copied') }).catch(() => {})
          }} data-testid="copy-deeplink"
            className="flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-xs font-black"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>
            {copied ? <Check size={13} /> : <Copy size={13} />} Copy the link
          </button>
          <ol className="space-y-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
            <li>1. In Shortcuts, make a new shortcut with one action: Open URLs, pasting the link above.</li>
            <li>2. Settings, Accessibility, Touch, Back Tap, Double Tap.</li>
            <li>3. Choose that shortcut. Two taps on the back of the phone now opens your check-ins.</li>
          </ol>
        </div>
      </div>
    </Modal>
  )
}
