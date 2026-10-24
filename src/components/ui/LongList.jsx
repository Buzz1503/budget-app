import { Fragment, useEffect, useRef, useState } from 'react'

/** How many rows to show next: one more step, never past the end. */
export const nextCount = (total, shown, step) => Math.min(total, shown + step)

/**
 * A long list that stays light: rows are added a step at a time as the end
 * comes into view, and each step's rows skip layout and paint while off
 * screen (content-visibility), so hundreds of entries scroll like ten.
 */
export default function LongList({ items, renderItem, keyOf, step = 40, rowHeight = 64, className, testid, as: Tag = 'div' }) {
  const [shown, setShown] = useState(() => Math.min(items.length, step))
  const sentinel = useRef(null)
  useEffect(() => { setShown((n) => Math.max(Math.min(items.length, step), Math.min(n, items.length))) }, [items.length, step])
  useEffect(() => {
    const el = sentinel.current
    if (!el || shown >= items.length || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown((n) => nextCount(items.length, n, step))
    }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [shown, items.length, step])
  const chunks = []
  for (let i = 0; i < shown; i += step) chunks.push(items.slice(i, Math.min(shown, i + step)).map((it, j) => [it, i + j]))
  return (
    <Tag className={className} data-testid={testid} data-shown={shown} data-total={items.length}>
      {chunks.map((chunk, c) => (
        <Fragment key={c}>
          {c === 0 ? chunk.map(([it, i]) => <Fragment key={keyOf(it, i)}>{renderItem(it, i)}</Fragment>) : (
            <div style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${chunk.length * rowHeight}px` }}>
              {chunk.map(([it, i]) => <Fragment key={keyOf(it, i)}>{renderItem(it, i)}</Fragment>)}
            </div>
          )}
        </Fragment>
      ))}
      {shown < items.length && (
        <button ref={sentinel} type="button" onClick={() => setShown((n) => nextCount(items.length, n, step))}
          className="w-full px-4 py-3 text-sm font-bold" style={{ color: 'var(--text-2)' }} data-testid={testid ? `${testid}-more` : undefined}>
          Show {Math.min(step, items.length - shown)} more
        </button>
      )}
    </Tag>
  )
}
