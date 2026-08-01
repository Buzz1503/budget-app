import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { MapPin, Check } from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import Modal from './ui/Modal'
import BodyMap from './BodyMap'
import { SITE_BY_ID, suggestSite, daysSince, sitesForRoute } from '../lib/sites'
import { formatDose, formatUnits, isPremixed } from '../lib/calc'

// Opens when the user taps Log — pre-highlights the longest-rested site, lets
// them accept or tap another, then logs the dose with that siteId. An IM
// peptide rotates through the IM map, not the SubQ one.
export default function SitePicker({ open, onClose, peptide, dose, unit, units }) {
  const doseLogs = useStore((s) => s.doseLogs)
  const logDose = useStore((s) => s.logDose)
  const t = todayStr()

  const route = peptide?.route === 'IM' ? 'IM' : 'SubQ'
  const sites = useMemo(() => sitesForRoute(route), [route])
  const suggestion = useMemo(() => suggestSite(doseLogs, t, route), [doseLogs, t, route])
  const [picked, setPicked] = useState(null)
  // a site picked for an IM peptide isn't on the SubQ map (and vice versa), so
  // the selection can't survive a switch between peptides
  useEffect(() => { setPicked(null) }, [peptide?.id])
  const chosen = picked || suggestion
  const chosenSite = SITE_BY_ID[chosen]
  const rested = daysSince(chosen, doseLogs, t)

  const confirm = () => {
    logDose(peptide.id, chosen)
    setPicked(null)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Log ${peptide?.name || ''}`}>
      {peptide && (
        <div className="space-y-3">
          <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface2)' }}>
            <p className="text-2xl font-black tracking-tight">
              {formatDose(dose, unit)}
              <span className="ml-2 text-base font-bold" style={{ color: 'var(--lime)' }}>{formatUnits(units)}</span>
            </p>
          </div>

          {route === 'IM' && (
            <div className="rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--amber) 14%, transparent)' }}>
              <p className="text-[11px] font-bold" style={{ color: 'var(--amber)' }}>
                Intramuscular{isPremixed(peptide) ? ' · oil solution' : ''} — not the SubQ insulin-syringe routine
              </p>
              <p className="mt-0.5 text-[11px] font-medium" style={{ color: 'var(--muted)' }}>
                ~23–25 g, 1–1.5" into muscle. Oil draws and pushes slowly — take your time.
              </p>
            </div>
          )}

          <div>
            <p className="mb-1 flex items-center gap-1.5 text-xs font-bold">
              <MapPin size={13} style={{ color: 'var(--lime)' }} /> Pick {route === 'IM' ? 'an IM' : 'an injection'} site
            </p>
            <BodyMap doseLogs={doseLogs} today={t} selected={picked} suggestion={suggestion} onPick={setPicked} sites={sites} />
          </div>

          {/* suggestion / selection readout */}
          <div className="rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--lime) 12%, transparent)' }}>
            {!picked ? (
              <p className="text-xs font-bold" style={{ color: 'var(--lime)' }}>
                Suggested: {chosenSite?.label}
                {rested == null ? ' — never used, fully rested' : ` — ${rested}d rested`}
              </p>
            ) : (
              <p className="text-xs font-bold" style={{ color: 'var(--text)' }}>
                Selected: {chosenSite?.label}
                {rested == null ? ' — never used' : ` — ${rested}d since last used`}
              </p>
            )}
          </div>

          <motion.button whileTap={{ scale: 0.97 }} onClick={confirm}
            className="btn-primary flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-black">
            <Check size={18} strokeWidth={3} /> Log here — {chosenSite?.label}
          </motion.button>
        </div>
      )}
    </Modal>
  )
}
