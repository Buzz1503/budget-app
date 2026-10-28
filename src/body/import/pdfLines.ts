// Text lines rebuilt from a PDF's positioned text items.
//
// pdf.js hands back text in whatever order the PDF was written, which is not
// reading order. Items are grouped into lines by their y position (within a
// tolerance), sorted left to right by x and joined with spaces. Each line keeps
// where every piece of text sits across the page, so a value can be matched to
// the label above it by position rather than by the order it came out in.

export interface PdfItem {
  str: string
  x: number
  /** pdf.js y: up the page, so a larger y is higher */
  y: number
  /** width in the same units, when known */
  w?: number
  page?: number
}

export interface LineSpan { start: number; end: number; x0: number; x1: number }

export interface PdfLine {
  page: number
  y: number
  text: string
  /** where each item's text sits in `text` and across the page */
  spans: LineSpan[]
}

/** A width guess for an item that came without one, about half the font size per character. */
const guessWidth = (s: string) => s.length * 5

export function rebuildLines(items: PdfItem[], tol = 2.5): PdfLine[] {
  const usable = items.filter((it) => it && typeof it.str === 'string' && it.str.trim() !== '' && Number.isFinite(it.x) && Number.isFinite(it.y))
  const byPage = new Map<number, PdfItem[]>()
  for (const it of usable) {
    const p = it.page ?? 1
    if (!byPage.has(p)) byPage.set(p, [])
    byPage.get(p)!.push(it)
  }
  const out: PdfLine[] = []
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    // top of the page first
    const sorted = byPage.get(page)!.slice().sort((a, b) => b.y - a.y || a.x - b.x)
    const groups: { y: number; items: PdfItem[] }[] = []
    for (const it of sorted) {
      const g = groups[groups.length - 1]
      if (g && Math.abs(g.y - it.y) <= tol) {
        g.items.push(it)
        g.y = g.items.reduce((s, x) => s + x.y, 0) / g.items.length
      } else groups.push({ y: it.y, items: [it] })
    }
    for (const g of groups) out.push(joinLine(page, g.y, g.items))
  }
  return out
}

function joinLine(page: number, y: number, items: PdfItem[]): PdfLine {
  const row = items.slice().sort((a, b) => a.x - b.x)
  let text = ''
  const spans: LineSpan[] = []
  for (const it of row) {
    const s = it.str.replace(/\s+/g, ' ').trim()
    if (!s) continue
    if (text) text += ' '
    const start = text.length
    text += s
    spans.push({ start, end: text.length, x0: it.x, x1: it.x + (it.w && it.w > 0 ? it.w : guessWidth(s)) })
  }
  return { page, y, text, spans }
}

/** The x position of a character in a line's text. */
export function xAt(line: PdfLine, offset: number): number {
  if (!line.spans.length) return 0
  for (const s of line.spans) {
    if (offset >= s.start && offset <= s.end) {
      const f = s.end > s.start ? (offset - s.start) / (s.end - s.start) : 0
      return s.x0 + f * (s.x1 - s.x0)
    }
  }
  // in a joining space: between the spans either side
  const after = line.spans.find((s) => s.start > offset)
  return after ? after.x0 : line.spans[line.spans.length - 1].x1
}

/** The centre x of a stretch of a line's text. */
export const xMid = (line: PdfLine, start: number, end: number) => (xAt(line, start) + xAt(line, end)) / 2

/** Plain lines, for a line-by-line fixture. Items are spaced so positions follow the text. */
export function linesFromText(text: string, page = 1): PdfLine[] {
  return text.split('\n').map((t, i) => ({ page, y: 800 - i * 12, text: t, spans: t ? [{ start: 0, end: t.length, x0: 0, x1: t.length * 5 }] : [] }))
}
