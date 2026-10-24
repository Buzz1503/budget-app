// A small PDF writer for the doctor reports, made on the device: A4 pages,
// Helvetica and Helvetica-Bold (built into every PDF reader, so nothing is
// embedded), text, lines and simple line charts. Pure: it returns bytes.

export const A4 = { w: 595.28, h: 841.89 }

// Helvetica advance widths (per 1000 em) for ASCII 32 to 126, from the standard AFM.
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584]

// the few characters outside ASCII the reports use, as WinAnsi bytes
const WIN = { '·': 0xb7, '°': 0xb0, '’': 0x92, '‘': 0x91, '“': 0x93, '”': 0x94, '×': 0xd7, 'µ': 0xb5, '≥': null, '≤': null }
const SUB = { '≥': '>=', '≤': '<=', '–': '-', '—': '-', '›': '>' }

/** Text as WinAnsi codes; anything else becomes a plain stand-in. */
export function winAnsi(str) {
  const out = []
  for (const ch of String(str)) {
    if (SUB[ch]) { for (const c of SUB[ch]) out.push(c.charCodeAt(0)); continue }
    const code = ch.charCodeAt(0)
    if (code >= 32 && code <= 126) out.push(code)
    else if (WIN[ch]) out.push(WIN[ch])
    else out.push(63) // ?
  }
  return out
}

/** The width of a string in points. */
export function textWidth(str, size, bold = false) {
  const table = bold ? W_BOLD : W_REG
  return winAnsi(str).reduce((s, c) => s + (c >= 32 && c <= 126 ? table[c - 32] : 556), 0) * size / 1000
}

/** Words into lines no wider than `width`. */
export function wrap(str, width, size, bold = false) {
  const lines = []
  for (const para of String(str).split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (line && textWidth(next, size, bold) > width) { lines.push(line); line = word } else line = next
    }
    lines.push(line)
  }
  return lines
}

const esc = (codes) => codes.map((c) => (c === 40 || c === 41 || c === 92 ? `\\${String.fromCharCode(c)}` : c > 126 ? `\\${c.toString(8).padStart(3, '0')}` : String.fromCharCode(c))).join('')
const n = (v) => (Math.round(v * 100) / 100).toString()
const rgb = (hex = '#000000') => {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => n(parseInt(h.slice(i, i + 2), 16) / 255)).join(' ')
}

export class PdfDoc {
  constructor({ title = 'Report' } = {}) {
    this.title = title
    this.pages = []
    this.addPage()
  }

  addPage() {
    this.ops = []
    this.pages.push(this.ops)
    return this
  }

  /** Text with its baseline `y` points from the top of the page. */
  text(x, y, str, { size = 10, bold = false, color = '#000000' } = {}) {
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${n(size)} Tf ${rgb(color)} rg ${n(x)} ${n(A4.h - y)} Td (${esc(winAnsi(str))}) Tj ET`)
    return this
  }

  line(x1, y1, x2, y2, { width = 0.5, color = '#000000' } = {}) {
    this.ops.push(`${n(width)} w ${rgb(color)} RG ${n(x1)} ${n(A4.h - y1)} m ${n(x2)} ${n(A4.h - y2)} l S`)
    return this
  }

  polyline(points, { width = 1, color = '#000000' } = {}) {
    if (points.length < 2) return this
    const [first, ...rest] = points
    this.ops.push(`${n(width)} w ${rgb(color)} RG ${n(first[0])} ${n(A4.h - first[1])} m ${rest.map(([x, y]) => `${n(x)} ${n(A4.h - y)} l`).join(' ')} S`)
    return this
  }

  dot(x, y, r = 1.5, { color = '#000000' } = {}) {
    this.ops.push(`${rgb(color)} rg ${n(x - r)} ${n(A4.h - y - r)} ${n(2 * r)} ${n(2 * r)} re f`)
    return this
  }

  /** The finished file. */
  output() {
    const objs = []
    const add = (s) => { objs.push(s); return objs.length }
    const catalog = add('')
    const pagesId = add('')
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
    const kids = []
    for (const ops of this.pages) {
      const body = ops.join('\n')
      const content = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`)
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(A4.w)} ${n(A4.h)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`))
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
    const info = add(`<< /Title (${esc(winAnsi(this.title))}) /Producer (Pepito+) >>`)
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
    const offsets = []
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
    const xref = out.length
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    const bytes = new Uint8Array(out.length)
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff
    return bytes
  }
}

/** Bytes as base64, for the native share sheet. */
export function toBase64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
