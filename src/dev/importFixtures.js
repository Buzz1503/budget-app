// Dev only: files for the design review of More › Data › Import. Built from the
// synthetic fixtures (src/body/import/fixtures.ts), never from a real report.

import { PdfDoc } from '../lib/pdf/pdfDoc'
import { EVOLT_26_OCT_PAGE1, EVOLT_26_OCT_NUTRITION, WITHINGS_REPORT_TEXT } from '../body/import/fixtures'

/** Fixture text as a PDF, each run of text its own text item at its column. */
export function fixturePdf(pages) {
  const doc = new PdfDoc({ title: 'fixture' })
  pages.forEach((text, pi) => {
    if (pi) doc.addPage()
    text.split('\n').forEach((line, li) => {
      // each run of text between wide gaps, placed where its column starts
      for (const m of line.matchAll(/\S+(?: \S+)*/g)) doc.text(30 + m.index * (108 / 28), 40 + li * 16, m[0], { size: 7.5 })
    })
  })
  return doc.output()
}

const CSV = 'Date,"Weight (kg)","Fat mass (kg)","Bone mass (kg)","Muscle mass (kg)","Hydration (kg)",Comments\n'
  + Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.UTC(2024, 3, 1 + i * 3))
    const w = (97.4 - i * 0.08).toFixed(1)
    return `"${d.toISOString().slice(0, 10)} 07:1${i % 10}:00",${w},${(Number(w) * 0.31).toFixed(1)},3.3,62.${i % 9},46.${i % 7},`
  }).join('\n')

/** Drop a mix of files on the Import screen: new, already imported, needs a check, not recognised. */
export async function dropImportFixtures() {
  const input = document.querySelector('[data-testid="import-input"]')
  if (!input) return
  const pdf = (name, pages) => new File([fixturePdf(pages)], name, { type: 'application/pdf' })
  const off = EVOLT_26_OCT_PAGE1.replace('170 cm 92.5 kg 36 Male', '170 cm 95.5 kg 36 Male')
  const files = [
    pdf('Evolt 26 Oct 2026.pdf', [EVOLT_26_OCT_PAGE1, EVOLT_26_OCT_NUTRITION]),
    pdf('Evolt 26 Oct 2026 (copy).pdf', [EVOLT_26_OCT_PAGE1, EVOLT_26_OCT_NUTRITION]),
    pdf('Evolt scan, misread.pdf', [off.replace('26-10-2026', '19-10-2026'), EVOLT_26_OCT_NUTRITION]),
    pdf('Withings Health report.pdf', [WITHINGS_REPORT_TEXT]),
    new File([CSV], 'weight.csv', { type: 'text/csv' }),
    pdf('Car insurance.pdf', ['Policy schedule\nRenewal 2027']),
  ]
  const dt = new DataTransfer()
  for (const f of files) dt.items.add(f)
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}
