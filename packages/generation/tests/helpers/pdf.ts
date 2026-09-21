import { PDFDocument, StandardFonts } from 'pdf-lib'

/** Render page texts into a real (text-layer) PDF, one page per entry. Test helper only. */
export async function makePdf(pages: string[], options: { blank?: boolean } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (const text of pages) {
    const page = pdf.addPage([595, 842])
    if (options.blank) continue
    let y = 800
    for (const paragraph of text.split('\n')) {
      for (const line of wrap(paragraph, 90)) {
        page.drawText(line, { x: 40, y, size: 10, font })
        y -= 14
        if (y < 40) break
      }
    }
  }
  return pdf.save()
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const word of text.split(/\s+/)) {
    if (current && current.length + word.length + 1 > width) {
      lines.push(current)
      current = word
    } else current = current ? `${current} ${word}` : word
  }
  lines.push(current)
  return lines
}
