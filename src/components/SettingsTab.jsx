import { useState } from 'react'
import { motion } from 'framer-motion'
import * as Icons from 'lucide-react'
import { Download, RotateCcw, Moon, Sun, Award, History } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore from '../store/useStore'
import { BADGES, levelProgress, rankForLevel } from '../lib/gamification'
import { formatDose } from '../lib/calc'

export default function SettingsTab() {
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
      <h1 className="text-2xl font-extrabold">More</h1>

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
                <span className="flex-1 truncate">{p?.name || l.peptideId} — {formatDose(l.doseValue, l.unit)} ({l.insulinUnits} u)</span>
                <button className="font-bold" style={{ color: 'var(--coral)' }} onClick={() => undoLog(l.id)}>undo</button>
              </div>
            )
          })}
        </div>
      </div>

      {/* data */}
      <div className="card space-y-3 p-4">
        <button onClick={exportJson} className="btn-violet flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-extrabold">
          <Download size={16} /> Export JSON
        </button>
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
      <p className="pb-2 text-center text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
        Peptide Command Center v1 · data lives in your browser only
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
