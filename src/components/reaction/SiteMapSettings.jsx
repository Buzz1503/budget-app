import { useEffect, useRef, useState } from 'react'
import { Upload, RotateCcw, Move, Check } from 'lucide-react'
import useStore from '../../store/useStore'
import Modal from '../ui/Modal'
import { putBlob, deleteBlob } from '../../lib/blobStore'
import { importPhoto } from '../../lib/photoImport'
import { DEFAULT_CHECK_TIME } from '../../lib/reactionTracker'
import SiteMap from './SiteMap'

/**
 * Settings &gt; Site map.
 *
 * The photograph is imported here and nowhere else, and it never leaves the
 * phone: it is written straight to IndexedDB, it is not in the repository, not
 * in the build, and not in a backup unless the switch below is turned on by
 * hand.
 */
export default function SiteMapSettings() {
  const siteMap = useStore((s) => s.siteMap)
  const settings = useStore((s) => s.reactionSettings)
  const setMapPhoto = useStore((s) => s.setMapPhoto)
  const clearMapPhoto = useStore((s) => s.clearMapPhoto)
  const setInclude = useStore((s) => s.setIncludeMapPhotoInBackup)
  const updateSettings = useStore((s) => s.updateReactionSettings)
  const resetAllPins = useStore((s) => s.resetAllPins)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const fileRef = useRef(null)

  const has = !!siteMap?.photoKey

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const out = await importPhoto(file)
      if (!out.ok) { setError(out.error || 'That photo could not be read.'); return }
      const key = `sitemap-${Date.now()}`
      await putBlob(key, out.blob)
      const old = siteMap?.photoKey
      setMapPhoto(key)
      if (old && old !== key) { try { await deleteBlob(old) } catch { /* the old one is already gone */ } }
      // Replacing the photo keeps every pin, so the first thing worth doing is
      // checking they still land on skin — which is this, opened for you.
      setAdjustOpen(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card space-y-3 p-4" data-testid="site-map-settings">
      <div>
        <div className="text-sm font-black">Site map</div>
        <p className="t-caption" style={{ color: 'var(--text-2)' }}>
          One full-body photo, front on the left and back on the right. It is stored on this
          phone only and is never uploaded.
        </p>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="map-photo-input"
        onChange={onFile}
      />
      <button
        data-testid="import-map-photo"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-black disabled:opacity-50"
        style={{ background: 'var(--surface-sunk)' }}
      >
        <Upload size={15} /> {busy ? 'Reading photo…' : has ? 'Replace map photo' : 'Import map photo'}
      </button>
      {error && <div className="t-caption" style={{ color: 'var(--danger)' }}>{error}</div>}

      {has && (
        <>
          <button
            data-testid="adjust-pins"
            onClick={() => setAdjustOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-black"
            style={{ background: 'var(--surface-sunk)' }}
          >
            <Move size={15} /> Adjust pins
          </button>
          <button
            data-testid="remove-map-photo"
            onClick={async () => { const k = siteMap.photoKey; clearMapPhoto(); try { await deleteBlob(k) } catch { /* already gone */ } }}
            className="t-caption underline"
            style={{ color: 'var(--text-3)' }}
          >
            Remove the photo from this phone
          </button>
        </>
      )}

      <label className="flex items-center justify-between gap-3 pt-1">
        <span className="min-w-0 flex-1">
          <span className="text-sm font-semibold">Include map photo in backup</span>
          <span className="t-caption block" style={{ color: 'var(--text-2)' }}>
            Off by default — a backup file with this on contains a full-body photograph.
          </span>
        </span>
        <input
          type="checkbox"
          data-testid="include-map-in-backup"
          checked={!!siteMap?.includePhotoInBackup}
          onChange={(e) => setInclude(e.target.checked)}
          className="h-6 w-6 shrink-0"
        />
      </label>

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">Evening check time</span>
        <input
          type="time"
          data-testid="check-time"
          value={settings?.checkTime || DEFAULT_CHECK_TIME}
          onChange={(e) => updateSettings({ checkTime: e.target.value })}
          className="input w-32 text-center"
        />
      </div>

      <button
        data-testid="reset-all-pins"
        onClick={resetAllPins}
        className="t-caption flex items-center gap-1.5 underline"
        style={{ color: 'var(--text-3)' }}
      >
        <RotateCcw size={12} /> Reset every pin to its default position
      </button>

      <AdjustPins open={adjustOpen} onClose={() => setAdjustOpen(false)} />
    </div>
  )
}

/** Long-press a pin and drag it. A position that breaks a rule is not saved. */
function AdjustPins({ open, onClose }) {
  const siteMap = useStore((s) => s.siteMap)
  const resetPin = useStore((s) => s.resetPin)
  const resetAllPins = useStore((s) => s.resetAllPins)
  const [selected, setSelected] = useState(null)
  const [warning, setWarning] = useState(null)

  useEffect(() => { if (!open) { setSelected(null); setWarning(null) } }, [open])

  const moved = Object.keys(siteMap?.pinOverrides || {})

  return (
    <Modal open={open} onClose={onClose} title="Adjust pins">
      <div className="space-y-3">
        <p className="t-caption" style={{ color: 'var(--text-2)' }}>
          Press and hold a pin, then drag it onto the fat you actually inject. Sites need
          44 px between them, 5 cm from the navel, and have to stay inside the view.
        </p>
        <SiteMap
          adjust
          selectedId={selected?.id || null}
          onSelect={(p) => setSelected(p)}
          onAdjustWarning={setWarning}
        />
        {selected && (
          <div className="rounded-[var(--r-sm)] p-3" style={{ background: 'var(--surface-sunk)' }}>
            <div className="text-sm font-black">{selected.label}</div>
            <button
              data-testid="reset-one-pin"
              onClick={() => resetPin(selected.id)}
              className="chip mt-2"
              disabled={!moved.includes(selected.id)}
            >
              Reset this pin
            </button>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="t-caption" style={{ color: 'var(--text-3)' }}>
            {moved.length ? `${moved.length} pin${moved.length === 1 ? '' : 's'} moved` : 'Every pin is where it started'}
          </span>
          <button className="chip" onClick={resetAllPins} disabled={!moved.length} data-testid="adjust-reset-all">Reset all</button>
        </div>
        <button className="btn-primary w-full py-3" onClick={onClose} data-testid="adjust-done">
          <Check size={15} className="mr-1 inline" /> Done
        </button>
      </div>
    </Modal>
  )
}

export { AdjustPins }
