// A finished PDF to the person: the share sheet on the iPhone (Mail,
// Messages, AirDrop, Save to Files; a copy stays in Documents/Reports), a
// download in the browser. Nothing is uploaded anywhere.
import { toBase64 } from './pdfDoc'

export async function deliverPdf(name, bytes) {
  if (__NATIVE__) {
    const { shareReport } = await import('../../native/backupRuntime')
    return shareReport(name, toBase64(bytes))
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return true
}

/** "Pepito-sleep-report-30-days-2026-10-24.pdf" */
export const reportName = (kind, today) => `Pepito-${kind}-${today}.pdf`
