import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Syringe, Wind, Wand2, Package, AlertTriangle, Share2, ChevronRight, Plus, Pill,
} from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import CompoundSheet from './CompoundSheet'
import { currentRung, cycleInfo, prettyDate } from '../lib/schedule'
import { formatDose, isNasal } from '../lib/calc'
import { scheduledWeekdaySet, WEEKDAYS, needsProtocolSetup } from '../lib/daily'
import { runwayFor, durationWords, sealedCount } from '../lib/stock'

const FREQ_LABELS = {
  daily: 'Daily', nightly: 'Nightly', weekly: 'Weekly',
  '2xweek': '2×/week', '3xweek': '3×/week', '5on2off': '5 on / 2 off',
}

function daysWords(peptide) {
  const days = scheduledWeekdaySet(peptide)
  if (days.size === 7) return 'every day'
  return [...days].map((d) => WEEKDAYS[d]).join(', ')
}

/**
 * What am I actually on.
 *
 * One screen, one row per compound, no editing. With the Library gone this is
 * the answer to the question the Library was really being used for — and
 * keeping it read-only is what stops it drifting from Build/rebuild, which is
 * the single place any of it changes.
 */
export default function ProtocolTab({ goTo }) {
  const peptides = useStore((s) => s.peptides)
  const supplements = useStore((s) => s.supplements)
  const vials = useStore((s) => s.vials)
  const openVials = useStore((s) => s.openVials)
  const titration = useStore((s) => s.titration)
  const doseLogs = useStore((s) => s.doseLogs)
  const leadDays = useStore((s) => s.settings.restockLeadDays)
  const t = todayStr()
  const [sheetId, setSheetId] = useState(null)

  const rows = useMemo(() => peptides.map((p) => {
    const rung = currentRung(p, titration[p.id])
    const cyc = cycleInfo(p, t)
    const runway = runwayFor(p, titration[p.id], openVials[p.id], vials, doseLogs, t, leadDays)
    return {
      p,
      dose: rung.dose,
      rung,
      cyc,
      runway,
      unlinked: !!openVials[p.id]?.unlinked,
      sealed: sealedCount(vials, p.id),
      needsSetup: needsProtocolSetup(p),
    }
  }).sort((a, b) => a.p.name.localeCompare(b.p.name)),
  [peptides, titration, openVials, vials, doseLogs, t, leadDays])

  const exportIt = () => {
    const lines = [
      `My protocol — ${prettyDate(t)}`,
      '',
      ...rows.map((r) => {
        const bits = [
          r.needsSetup ? 'no dose set' : formatDose(r.dose, r.p.ladder?.unit),
          FREQ_LABELS[r.p.frequency] || r.p.frequency,
          daysWords(r.p),
          r.p.slot || 'AM',
          isNasal(r.p) ? 'Nasal' : (r.p.route || 'SubQ'),
          r.cyc.ongoing ? 'ongoing' : `cycle day ${r.cyc.cycleDay} (${r.cyc.isOn ? 'on' : 'off'})`,
          r.unlinked ? 'not in stock' : `${r.sealed} sealed`,
        ]
        return `${r.p.name} — ${bits.join(' · ')}`
      }),
      ...(supplements.length ? ['', 'Supplements', ...supplements.map((s) => `${s.name}${s.dose ? ` — ${s.dose}` : ''} · ${s.slot}`)] : []),
      '',
      'Personal tracking record, not medical advice.',
    ]
    const text = lines.join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `my-protocol-${t}.txt`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="space-y-3" data-testid="protocol-overview">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black tracking-tight">My protocol</h1>
          <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
            Everything I'm currently taking, at a glance.
          </p>
        </div>
        <span className="chip shrink-0 !py-2" style={{ color: 'var(--good)' }}>
          {rows.length} compound{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex gap-2">
        <button onClick={() => goTo?.('wizard')} data-testid="protocol-build"
          className="btn-primary flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-xs font-black">
          <Wand2 size={14} /> Build / rebuild
        </button>
        <button onClick={exportIt} data-testid="protocol-export"
          className="flex items-center justify-center gap-2 rounded-full px-4 py-3 text-xs font-black"
          style={{ background: 'var(--surface-sunk)', color: 'var(--info)' }}>
          <Share2 size={13} /> Export
        </button>
      </div>

      {rows.length === 0 && (
        <div className="card p-5 text-center" style={{ color: 'var(--text-2)' }}>
          <p className="text-sm font-bold">Nothing in my protocol yet.</p>
          <button onClick={() => goTo?.('wizard')}
            className="btn-primary mt-3 flex w-full items-center justify-center gap-2 rounded-full py-3 text-xs font-black">
            <Plus size={14} /> Build it
          </button>
        </div>
      )}

      <div className="space-y-2" data-testid="protocol-rows">
        {rows.map((r, i) => (
          <motion.button key={r.p.id}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => setSheetId(r.p.id)}
            data-testid="protocol-row"
            className="card flex w-full items-start gap-3 p-3 text-left">
            <div className="mt-1 flex shrink-0 items-center justify-center" style={{ color: 'var(--text-3)' }}>
              {isNasal(r.p) ? <Wind size={16} /> : <Syringe size={16} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold leading-tight">{r.p.name}</p>
              <p className="truncate text-xs font-semibold leading-tight" style={{ color: 'var(--text-2)' }}>
                {r.needsSetup
                  ? 'no dose set yet'
                  : `${formatDose(r.dose, r.p.ladder?.unit)} · ${FREQ_LABELS[r.p.frequency] || r.p.frequency} · ${r.p.slot || 'AM'}`}
              </p>
              <p className="truncate text-xs font-medium leading-tight" style={{ color: 'var(--text-2)' }}>
                {daysWords(r.p)} · {isNasal(r.p) ? 'Nasal' : (r.p.route || 'SubQ')}
                {' · '}
                {r.cyc.ongoing ? 'ongoing' : `cycle day ${r.cyc.cycleDay} ${r.cyc.isOn ? 'on' : 'off'}`}
              </p>
              <p className="mt-1 flex items-center gap-1 truncate text-xs font-bold leading-tight"
                style={{ color: r.unlinked ? 'var(--warn)' : r.runway?.low ? 'var(--warn)' : 'var(--text-2)' }}>
                {r.unlinked
                  ? <><AlertTriangle size={10} /> not in stock — still scheduled</>
                  : <><Package size={10} /> {r.runway && isFinite(r.runway.days) ? `${durationWords(r.runway.days)} left` : `${r.sealed} sealed`}</>}
              </p>
            </div>
            <ChevronRight size={16} className="mt-1 shrink-0" style={{ color: 'var(--text-2)' }} />
          </motion.button>
        ))}
      </div>

      {supplements.length > 0 && (
        <>
          <p className="px-1 pt-2 text-xs font-black uppercase tracking-wide" style={{ color: 'var(--warn)' }}>
            Supplements
          </p>
          <button onClick={() => goTo?.('supplements')}
            className="card flex w-full items-center gap-3 p-3 text-left">
            <div className="flex shrink-0 items-center justify-center" style={{ color: 'var(--text-3)' }}>
              <Pill size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold leading-tight">{supplements.length} taken by mouth</p>
              <p className="truncate text-xs font-semibold leading-tight" style={{ color: 'var(--text-2)' }}>
                {supplements.slice(0, 3).map((s) => s.name).join(', ')}{supplements.length > 3 ? '…' : ''}
              </p>
            </div>
            <ChevronRight size={16} className="shrink-0" style={{ color: 'var(--text-2)' }} />
          </button>
        </>
      )}

      <p className="px-1 pb-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
        This screen shows; it never edits. Tap any compound for its reference data, your own history and
        your notes — dose and schedule are changed in Build / rebuild, so there is only ever one version
        of the truth.
      </p>

      <CompoundSheet open={!!sheetId} compoundId={sheetId} onClose={() => setSheetId(null)} goTo={goTo} />
    </div>
  )
}
