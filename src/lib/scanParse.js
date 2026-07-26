// Client-side DEXA / InBody PDF text extraction → pre-filled fields for the
// user to CONFIRM. Never auto-commits. pdf.js is lazy-loaded on first use so it
// stays out of the initial bundle. Formats vary wildly; this is best-effort.

let pdfjsPromise = null
async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then(async (pdfjs) => {
      // worker as a module URL (Vite resolves this to a hashed asset)
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    })
  }
  return pdfjsPromise
}

export async function extractPdfText(file) {
  const pdfjs = await getPdfjs()
  const buf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buf }).promise
  let text = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    text += content.items.map((it) => it.str).join(' ') + '\n'
  }
  return text
}

// Pull likely body-comp values out of raw text. Returns a partial measurement.
export function parseScanText(text) {
  const t = text.replace(/\s+/g, ' ')
  const out = {}
  const num = (re) => {
    const m = t.match(re)
    return m ? parseFloat(m[1]) : null
  }
  const set = (k, v, lo, hi) => { if (v != null && v >= lo && v <= hi) out[k] = v }

  set('weight', num(/(?:weight|body weight)[^\d]{0,12}(\d{2,3}(?:\.\d)?)\s*(?:kg)?/i), 30, 300)
  set('bodyFat', num(/(?:body fat|fat %|pbf|percent body fat|body fat percentage)[^\d]{0,12}(\d{1,2}(?:\.\d)?)\s*%?/i), 3, 60)
  set('muscleMass', num(/(?:skeletal muscle mass|muscle mass|smm|lean body mass|lean mass)[^\d]{0,12}(\d{2,3}(?:\.\d)?)/i), 10, 120)
  set('visceralFat', num(/(?:visceral fat(?: (?:area|level|rating))?|vfa)[^\d]{0,12}(\d{1,3}(?:\.\d)?)/i), 1, 300)
  set('waist', num(/(?:waist(?:[- ]hip)?)[^\d]{0,12}(\d{2,3}(?:\.\d)?)\s*(?:cm)?/i), 40, 200)
  return out
}
