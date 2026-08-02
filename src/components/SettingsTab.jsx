import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import * as Icons from 'lucide-react'
import {
  Download, RotateCcw, Moon, Sun, Award, History, ShieldCheck, Upload, CalendarPlus, Check, AlertTriangle, Wand2,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import { BADGES, levelProgress, rankForLevel } from '../lib/gamification'
import { formatDose } from '../lib/calc'
import { buildBackup, restoreBackup, validateBackup, describeBackup, backupFilename } from '../lib/backup'
import { buildIcs } from '../lib/calendar'
import { deliveryEvents } from '../lib/restock'
import { addDaysStr } from '../lib/schedule'

export default function SettingsTab({ goTo }) {
  const settings = useStore((s) => s.settings)
  const gamification = useStore((s) => s.gamification)
  const doseLogs = useStore((s) => s.doseLogs)
  const peptides = useStore((s) => s.peptides)
  const updateSettings = useStore((s) => s.updateSettings)
  const resetAll = useStore((s) => s.resetAll)
  const undoLog = useStore((s) => s.undoLog)
  const [confirmReset, setConfirmReset] = useState(false)

  const lp = levelProgress(gamification.xp)

  const exportJson = () => {
    try {
      const state = useStore.getState()
      const data = {
        exportedAt: new Date().toISOString(),
        peptides: state.peptides, vials: state.vials, doseLogs: state.doseLogs,
        knownGoodMixes: state.knownGoodMixes, titration: state.titration,
        openVials: state.openVials, gamification: state.gamification, settings: state.settings,
        mixExplored: state.mixExplored, symptomLogs: state.symptomLogs,
        measurements: state.measurements, photos: state.photos, bodyGoals: state.bodyGoals,
        bodyRefs: state.bodyRefs,
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `peptide-command-center-${format(new Date(), 'yyyy-MM-dd')}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(`Export failed: ${e.message}`)
    }
  }

  const recentLogs = [...doseLogs].reverse().slice(0, 10)

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Settings</h1>

      {/* badges shelf */}
      <div className="card p-4">
        <p className="mb-1 flex items-center gap-1.5 text-sm font-bold">
          <Award size={15} style={{ color: 'var(--violet)' }} /> Badges
          <span className="ml-auto text-xs font-semibold" style={{ color: 'var(--muted)' }}>
            Lvl {lp.level} · {rankForLevel(lp.level)} · {gamification.xp} XP
          </span>
        </p>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {BADGES.map((b) => {
            const earned = gamification.badges.includes(b.id)
            const Icon = Icons[b.icon] || Award
            return (
              <motion.div key={b.id} whileTap={{ scale: 0.94 }} title={`${b.name} — ${b.desc}`}
                className="flex flex-col items-center gap-1 rounded-2xl p-2 text-center"
                style={{ background: 'var(--surface2)', opacity: earned ? 1 : 0.35 }}>
                <div className="flex h-9 w-9 items-center justify-center rounded-full"
                  style={earned
                    ? { backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff' }
                    : { background: 'var(--surface)', color: 'var(--muted)' }}>
                  <Icon size={16} />
                </div>
                <p className="text-[8.5px] font-bold leading-tight">{b.name}</p>
              </motion.div>
            )
          })}
        </div>
        <p className="mt-2 text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
          Best streak: {gamification.bestStreak} days · {gamification.totalLogs || 0} doses logged
        </p>
      </div>

      {/* settings */}
      <div className="card space-y-3 p-4">
        <Row label="Theme">
          <button onClick={() => updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
            className="chip !py-1.5 font-bold">
            {settings.theme === 'dark' ? <Moon size={13} /> : <Sun size={13} />} {settings.theme}
          </button>
        </Row>
        <Row label="Currency">
          <input className="input !w-20 text-center" value={settings.currency}
            onChange={(e) => updateSettings({ currency: e.target.value.toUpperCase().slice(0, 3) })} />
        </Row>
        <Row label="Restock lead time (days)">
          <input type="number" className="input !w-20 text-center" value={settings.restockLeadDays} min="1"
            onChange={(e) => updateSettings({ restockLeadDays: Math.max(1, Math.round(+e.target.value || 30)) })} />
        </Row>
        <Row label="Haptics">
          <button onClick={() => updateSettings({ haptics: !settings.haptics })}
            className="chip !py-1.5 font-bold" style={{ color: settings.haptics ? 'var(--lime)' : 'var(--muted)' }}>
            {settings.haptics ? 'On' : 'Off'}
          </button>
        </Row>
        <Row label="Celebration sound">
          <button onClick={() => updateSettings({ sound: !settings.sound })}
            className="chip !py-1.5 font-bold" style={{ color: settings.sound ? 'var(--lime)' : 'var(--muted)' }}>
            {settings.sound ? 'On' : 'Off'}
          </button>
        </Row>
        <Row label="Disclaimer">
          <button className="chip !py-1.5 font-bold" onClick={() => updateSettings({ disclaimerDismissed: false })}>
            Show again
          </button>
        </Row>
      </div>

      {/* recent history */}
      <div className="card p-4">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-bold"><History size={15} style={{ color: 'var(--lime)' }} /> Recent logs</p>
        {recentLogs.length === 0 && <p className="text-xs" style={{ color: 'var(--muted)' }}>Nothing logged yet.</p>}
        <div className="space-y-1.5">
          {recentLogs.map((l) => {
            const p = peptides.find((x) => x.id === l.peptideId)
            return (
              <div key={l.id} className="flex items-center gap-2 text-xs font-semibold">
                <span className="w-14 shrink-0" style={{ color: 'var(--muted)' }}>{format(parseISO(l.date), 'd MMM')}</span>
                <span className="flex-1 truncate">{p?.name || l.peptideId} — {formatDose(l.doseValue, l.unit)}{l.insulinUnits ? ` (${l.insulinUnits} u)` : ''}</span>
                <button className="font-bold" style={{ color: 'var(--coral)' }} onClick={() => undoLog(l.id)}>undo</button>
              </div>
            )
          })}
        </div>
      </div>

      <BackupCard />
      <CalendarCard />

      {/* data */}
      <div className="card space-y-3 p-4">
        <button onClick={exportJson} className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-extrabold"
          style={{ background: 'var(--surface2)' }}>
          <Download size={16} /> Export JSON (data only)
        </button>
        <p className="-mt-1 text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
          Structured data without photos. For a complete copy use Full backup above.
        </p>
        {confirmReset ? (
          <div className="space-y-2 text-center">
            <p className="text-xs font-bold" style={{ color: 'var(--coral)' }}>Wipe everything and restore seed data?</p>
            <div className="flex gap-2">
              <button className="flex-1 rounded-xl py-2 text-sm font-extrabold" style={{ background: 'var(--coral)', color: '#fff' }}
                onClick={() => { resetAll(); setConfirmReset(false) }}>
                Yes, reset
              </button>
              <button className="flex-1 rounded-xl py-2 text-sm font-extrabold" style={{ background: 'var(--surface2)' }}
                onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirmReset(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold"
            style={{ background: 'var(--surface2)', color: 'var(--coral)' }}>
            <RotateCcw size={15} /> Reset all data
          </button>
        )}
      </div>
      <button onClick={() => goTo?.('wizard')}
        className="btn-violet flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-black">
        <Wand2 size={16} /> Build / rebuild my schedule
      </button>

      <p className="pb-2 text-center text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
        Pepito + · data lives in your browser only
      </p>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-semibold">{label}</span>
      {children}
    </div>
  )
}

// ---------- Full backup & restore ----------
function BackupCard() {
  const backupMeta = useStore((s) => s.backupMeta)
  const markBackedUp = useStore((s) => s.markBackedUp)
  const [busy, setBusy] = useState(null)
  const [progress, setProgress] = useState(null)
  const [pending, setPending] = useState(null) // parsed bundle awaiting confirm
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const fileRef = useRef(null)

  const doBackup = async () => {
    setBusy('backup'); setError(null); setDone(null); setProgress(null)
    try {
      const bundle = await buildBackup((d, total) => total && setProgress(`Packing photos ${d}/${total}`))
      const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = backupFilename()
      a.click()
      URL.revokeObjectURL(url)
      markBackedUp(bundle.createdAt)
      const mb = (blob.size / 1e6).toFixed(2)
      setDone(`Backed up — ${bundle.counts.blobs} photo/scan file${bundle.counts.blobs === 1 ? '' : 's'} included (${mb} MB)`)
    } catch (e) {
      setError(`Backup failed: ${e.message}`)
    } finally {
      setBusy(null); setProgress(null)
    }
  }

  const pickFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null); setDone(null)
    try {
      const bundle = JSON.parse(await file.text())
      const problem = validateBackup(bundle)
      if (problem) { setError(problem); return }
      setPending(bundle)
    } catch {
      setError("That file couldn't be read as a backup.")
    }
  }

  const doRestore = async () => {
    setBusy('restore'); setError(null)
    try {
      await restoreBackup(pending, (d, total) => total && setProgress(`Restoring photos ${d}/${total}`))
      setPending(null)
      // reload so the store rehydrates cleanly from the restored data
      window.location.reload()
    } catch (e) {
      setError(`Restore failed: ${e.message}`)
      setBusy(null); setProgress(null)
    }
  }

  const info = pending ? describeBackup(pending) : null

  return (
    <div className="card space-y-3 p-4">
      <p className="flex items-center gap-1.5 text-sm font-bold">
        <ShieldCheck size={15} style={{ color: 'var(--lime)' }} /> Full backup
      </p>
      <p className="text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
        Everything lives in this browser. One file saves all your data <span className="font-bold" style={{ color: 'var(--text)' }}>including progress photos and scans</span> — keep a copy somewhere safe.
      </p>

      <button onClick={doBackup} disabled={!!busy}
        className="btn-primary flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-black disabled:opacity-50">
        <Download size={16} /> {busy === 'backup' ? (progress || 'Packing…') : 'Back up everything'}
      </button>

      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={pickFile} />
      <button onClick={() => fileRef.current?.click()} disabled={!!busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold disabled:opacity-50"
        style={{ background: 'var(--surface2)' }}>
        <Upload size={15} /> Restore from backup
      </button>

      <p className="text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
        {backupMeta?.lastBackupAt
          ? `Last backup ${format(parseISO(backupMeta.lastBackupAt), 'd MMM yyyy, HH:mm')}`
          : 'Never backed up'}
      </p>

      {done && <p className="text-[11px] font-bold" style={{ color: 'var(--lime)' }}><Check size={12} className="mr-1 inline" />{done}</p>}
      {error && <p className="text-[11px] font-bold" style={{ color: 'var(--coral)' }}>{error}</p>}

      {pending && (
        <div className="rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--amber) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--amber) 40%, transparent)' }}>
          <p className="flex items-center gap-1.5 text-xs font-black" style={{ color: 'var(--amber)' }}>
            <AlertTriangle size={14} /> Replace all current data?
          </p>
          <p className="mt-1 text-[11px] font-medium" style={{ color: 'var(--muted)' }}>
            From {info.createdAt ? format(parseISO(info.createdAt), 'd MMM yyyy, HH:mm') : 'unknown date'} —
            {' '}{info.peptides} peptides, {info.doseLogs} dose logs, {info.measurements} measurements,
            {' '}{info.symptomLogs} check-ins, {info.blobs} photo/scan files.
            <span className="font-bold" style={{ color: 'var(--text)' }}> This overwrites everything currently in the app.</span>
          </p>
          <div className="mt-2 flex gap-2">
            <button onClick={doRestore} disabled={busy === 'restore'}
              className="flex-1 rounded-xl py-2 text-xs font-black disabled:opacity-50"
              style={{ background: 'var(--amber)', color: '#1a1200' }}>
              {busy === 'restore' ? (progress || 'Restoring…') : 'Yes, restore'}
            </button>
            <button onClick={() => setPending(null)} disabled={busy === 'restore'}
              className="flex-1 rounded-xl py-2 text-xs font-black" style={{ background: 'var(--surface2)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- Calendar (.ics) export ----------
function CalendarCard() {
  const restock = useStore((s) => s.restock)
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const [mode, setMode] = useState('ongoing')
  const [months, setMonths] = useState(3)
  const [includeDose, setIncludeDose] = useState(true)
  const [result, setResult] = useState(null)

  const doExport = () => {
    try {
      const from = new Date()
      const until = mode === 'range' ? new Date(addDaysStr(todayStr(), months * 30) + 'T23:59:59') : null
      const deliveries = deliveryEvents(restock, peptides)
      const { ics, eventCount } = buildIcs(peptides, titration, { from, until, includeDose, deliveries })
      if (eventCount === 0) {
        setResult({ ok: false, msg: 'No scheduled peptides to export — set a protocol first.' })
        return
      }
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `peptide-schedule-${todayStr()}.ics`
      a.click()
      URL.revokeObjectURL(url)
      setResult({ ok: true, msg: `${eventCount} recurring events exported — open the file to add them to your calendar.` })
    } catch (e) {
      setResult({ ok: false, msg: `Export failed: ${e.message}` })
    }
  }

  return (
    <div className="card space-y-3 p-4">
      <p className="flex items-center gap-1.5 text-sm font-bold">
        <CalendarPlus size={15} style={{ color: 'var(--indigo)' }} /> Calendar export
      </p>
      <p className="text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
        This app can't send notifications. Export your schedule to your phone's calendar and let it remind you.
      </p>

      <div className="flex gap-1.5">
        {[['ongoing', 'Ongoing'], ['range', 'Date range']].map(([m, label]) => (
          <button key={m} onClick={() => setMode(m)}
            className="flex-1 rounded-lg py-1.5 text-xs font-black"
            style={mode === m
              ? { backgroundImage: 'linear-gradient(135deg, var(--indigo), var(--violet))', color: '#fff' }
              : { background: 'var(--surface2)', color: 'var(--muted)' }}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'range' && (
        <Row label="Length">
          <div className="flex gap-1">
            {[1, 3, 6, 12].map((m) => (
              <button key={m} onClick={() => setMonths(m)}
                className="rounded-lg px-2.5 py-1 text-xs font-black"
                style={months === m ? { background: 'var(--indigo)', color: '#fff' } : { background: 'var(--surface2)', color: 'var(--muted)' }}>
                {m}mo
              </button>
            ))}
          </div>
        </Row>
      )}

      <Row label="Include dose in title">
        <button onClick={() => setIncludeDose(!includeDose)} className="chip !py-1.5 font-bold"
          style={{ color: includeDose ? 'var(--lime)' : 'var(--muted)' }}>
          {includeDose ? 'On' : 'Off'}
        </button>
      </Row>

      <button onClick={doExport} className="btn-violet flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-black">
        <CalendarPlus size={16} /> Download .ics
      </button>

      {result && (
        <p className="text-[11px] font-bold" style={{ color: result.ok ? 'var(--lime)' : 'var(--coral)' }}>{result.msg}</p>
      )}
      <p className="text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
        This is a <span className="font-bold" style={{ color: 'var(--text)' }}>snapshot</span> — titration changes won't update
        events already in your calendar. Re-export after you change your protocol.
      </p>
    </div>
  )
}
