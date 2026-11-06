import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import Modal from '../ui/Modal'
import AlignedPhoto, { PhotoFrame } from './AlignedPhoto'
import { comparePair } from '../../lib/photoAlign'

const chip = 'absolute top-2 rounded-full bg-black/60 px-2.5 py-1 text-xs font-bold text-white'
export const photoDate = (d) => format(parseISO(d), 'd MMM yyyy')

/** A list of one pose's photos to choose from, newest first. */
export function PhotoPicker({ open, title, photos, selected, onPick, onClose }) {
  const list = useMemo(() => [...photos].sort((a, b) => b.date.localeCompare(a.date)), [photos])
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="grid grid-cols-3 gap-2" data-testid="photo-picker">
        {list.map((p) => (
          <button key={p.id} onClick={() => { onPick(p); onClose() }} data-testid={`pick-${p.id}`} aria-pressed={p.id === selected}
            className="overflow-hidden rounded-[14px] text-left" style={{ outline: p.id === selected ? '2px solid var(--accent)' : 'none', outlineOffset: 2 }}>
            <PhotoFrame maxWidth={999}><AlignedPhoto photo={p} thumb /></PhotoFrame>
            <span className="mt-1 block text-center text-xs font-semibold tabular-nums" style={{ color: 'var(--text-2)' }}>{photoDate(p.date)}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}

/**
 * Before and after with a slider. Both photos are drawn the same way, in the
 * same frame, each moved by its own Adjust settings, so the slider lines up.
 * Tap a date chip to choose any photo of the pose for that side.
 */
export default function PhotoCompare({ photos, maxWidth = 300 }) {
  const [chosen, setChosen] = useState({ a: null, b: null })
  const [picking, setPicking] = useState(null)
  const [pos, setPos] = useState(50)
  const pair = comparePair(photos, chosen)
  if (!pair) return null
  const { a, b } = pair
  return (
    <div data-testid="photo-compare">
      <PhotoFrame maxWidth={maxWidth} testid="compare-frame">
        <AlignedPhoto photo={b} alt="after" testid="compare-after" />
        <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
          <AlignedPhoto photo={a} alt="before" testid="compare-before" />
        </div>
        <div className="pointer-events-none absolute inset-y-0" style={{ left: `${pos}%`, width: 2, marginLeft: -1, background: 'var(--accent)' }} />
        <button className={`${chip} left-2`} onClick={() => setPicking('a')} data-testid="compare-chip-a">{photoDate(a.date)}</button>
        <button className={`${chip} right-2`} onClick={() => setPicking('b')} data-testid="compare-chip-b">{photoDate(b.date)}</button>
      </PhotoFrame>
      <input type="range" min="0" max="100" value={pos} onChange={(e) => setPos(+e.target.value)} aria-label="Before and after"
        className="mt-3 w-full" style={{ accentColor: 'var(--accent)' }} data-testid="compare-slider" />
      <p className="text-center text-xs font-medium" style={{ color: 'var(--text-2)' }}>Drag to compare. Tap a date to choose another photo.</p>
      <PhotoPicker open={!!picking} title={picking === 'a' ? 'Before' : 'After'} photos={photos} selected={picking === 'a' ? a.id : b.id}
        onPick={(p) => setChosen((c) => ({ ...c, [picking]: p.id }))} onClose={() => setPicking(null)} />
    </div>
  )
}
