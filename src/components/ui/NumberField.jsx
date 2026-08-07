import { useEffect, useRef, useState } from 'react'

/**
 * A numeric input that behaves the way people expect one to.
 *
 * The old pattern was `value={n}` + `onChange={parseFloat(e.target.value) || 0}`.
 * That looks fine until you try to clear the field: the empty string parses to
 * 0, the input immediately re-renders as "0", and your next keystroke lands
 * after it — "0" then "1" then "0" gives you "010". Every padded number in the
 * app came from that one line.
 *
 * So the raw text is kept locally while the field is being edited, and only
 * parsed on the way out. Empty stays empty, "1." stays typeable, and the
 * canonical number is written back on blur.
 */
export default function NumberField({
  value,
  onChange,
  onCommit,
  min = 0,
  max,
  step = 'any',
  allowEmpty = false,
  emptyValue = 0,
  integer = false,
  className = '',
  ...rest
}) {
  const [text, setText] = useState(() => format(value))
  const focused = useRef(false)

  // Track external changes, but never yank the text out from under the caret.
  useEffect(() => {
    if (focused.current) return
    setText(format(value))
  }, [value])

  const clamp = (n) => {
    let out = n
    if (min != null && out < min) out = min
    if (max != null && out > max) out = max
    return integer ? Math.round(out) : out
  }

  const handle = (raw) => {
    // allow an empty box, a lone minus, and a trailing decimal point mid-typing
    setText(raw)
    if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
      if (allowEmpty) onChange(undefined)
      return
    }
    const n = Number(raw)
    if (Number.isNaN(n)) return
    onChange(clamp(n))
  }

  const commit = () => {
    focused.current = false
    if (text === '' || text === '-' || text === '.' || text === '-.') {
      if (allowEmpty) { onChange(undefined); setText(''); onCommit?.(undefined); return }
      onChange(emptyValue)
      setText(format(emptyValue))
      onCommit?.(emptyValue)
      return
    }
    const n = clamp(Number(text))
    const safe = Number.isNaN(n) ? emptyValue : n
    onChange(safe)
    setText(format(safe))   // "007" → "7", "1." → "1"
    onCommit?.(safe)
  }

  return (
    <input
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      // A text input with a numeric keypad, not type="number": number inputs
      // reject their own intermediate states and swallow the caret on iOS.
      pattern={integer ? '[0-9]*' : '[0-9]*[.,]?[0-9]*'}
      className={`input ${className}`}
      value={text}
      step={step}
      onFocus={(e) => { focused.current = true; rest.onFocus?.(e) }}
      onChange={(e) => handle(e.target.value.replace(',', '.'))}
      onBlur={(e) => { commit(); rest.onBlur?.(e) }}
      {...rest}
    />
  )
}

/** Canonical text for a number: no padding, no trailing ".0", empty for null. */
export function format(n) {
  if (n == null || n === '') return ''
  const num = typeof n === 'number' ? n : Number(n)
  if (Number.isNaN(num)) return ''
  // Number#toString already drops leading zeros and a trailing ".0"; the round
  // keeps float noise (0.30000000000000004) out of the box.
  return String(Math.round(num * 1e6) / 1e6)
}
