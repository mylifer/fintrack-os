/* ── PDF'ten konumlu metin ───────────────────────────────────────────────────
   Banka ekstreleri tablo biçimindedir ama PDF'te tablo yoktur: her hücre
   sayfada (x, y) konumuna yazılmış bir metin parçasıdır. Hangi tutarın "Bonus",
   hangisinin "Tutar" sütununda olduğu ancak konumdan anlaşılır. Bu modül
   pdf.js ile parçaları okur ve aynı satırdakileri (y) birleştirir; banka
   ayrıştırıcıları (garanti-card.ts …) yalnız bu SAF yapıyı görür — testler
   PDF'siz, elle kurulmuş satırlarla çalışır.

   PDF tarayıcıda okunur, hiçbir sunucuya gönderilmez. */

export interface PdfItem {
  /** Sol kenar (pt) */
  x: number
  /** Sağ kenar (pt) — sağa yaslı tutar sütunları buna göre ayrılır */
  right: number
  /** Taban çizgisi (pt, aşağıdan yukarı) */
  y: number
  str: string
}

export interface PdfLine {
  y: number
  /** Soldan sağa */
  items: PdfItem[]
  /** Parçalar tek boşlukla birleştirilmiş, fazla boşluklar tekilleştirilmiş */
  text: string
}

export interface PdfPage {
  /** Yukarıdan aşağıya */
  lines: PdfLine[]
}

/** Aynı satırda sayılacak en büyük taban çizgisi farkı (pt). */
const LINE_TOLERANCE = 2

/** Parçaları satırlara toplar: y'si birbirine LINE_TOLERANCE'tan yakın olanlar
 *  bir satırdır. Satırlar yukarıdan aşağıya, parçalar soldan sağa sıralanır. */
export function groupLines(items: readonly PdfItem[]): PdfLine[] {
  const sorted = items.filter(i => i.str.trim() !== '').slice().sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: PdfLine[] = []
  for (const it of sorted) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(last.y - it.y) <= LINE_TOLERANCE) last.items.push(it)
    else lines.push({ y: it.y, items: [it], text: '' })
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x)
    l.text = l.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim()
  }
  return lines
}

interface TextItemLike { str?: string; transform?: number[]; width?: number }

/** pdf.js metin parçalarını PdfItem'a çevirir (transform[4]=x, [5]=y). */
export function toPdfItems(raw: readonly TextItemLike[]): PdfItem[] {
  const out: PdfItem[] = []
  for (const r of raw) {
    if (typeof r.str !== 'string' || !r.transform) continue
    const x = r.transform[4]
    out.push({ x, right: x + (r.width ?? 0), y: r.transform[5], str: r.str })
  }
  return out
}

/** Tarayıcıda PDF baytlarından sayfa sayfa satırlar. pdf.js yalnız burada,
 *  dinamik olarak yüklenir (sayfa açılışını ağırlaştırmasın). Her okuma kendi
 *  worker'ını açar ve sonunda kapatır. */
export async function readPdfPages(bytes: ArrayBuffer): Promise<PdfPage[]> {
  const pdfjs = await import('pdfjs-dist')
  const port = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' })
  const worker = new pdfjs.PDFWorker({ port: port as unknown as null })
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), worker })
  try {
    let doc
    try {
      doc = await task.promise
    } catch (err) {
      const name = (err as { name?: string })?.name
      if (name === 'PasswordException') throw new Error('PDF şifreli. Bankanın şifresiz ekstresini yükleyin.')
      throw new Error('PDF açılamadı (bozuk olabilir).')
    }
    const pages: PdfPage[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      pages.push({ lines: groupLines(toPdfItems(content.items as TextItemLike[])) })
    }
    return pages
  } finally {
    await task.destroy().catch(() => {})
    worker.destroy()
    port.terminate()
  }
}
